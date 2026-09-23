import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket, type RawData } from 'ws';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import type { FastifyBaseLogger } from 'fastify';
import type { Role } from '@codesync/shared';
import { authenticateCookieHeader, type AuthUser } from '../../modules/auth/tokens';
import type { DocPersistence } from './snapshot.repository';
import { MESSAGE_AWARENESS, MESSAGE_SYNC } from './protocol';
import { RoomDoc, send } from './room-doc';

const PING_INTERVAL_MS = 30_000;
const PATH_RE = /^\/yjs\/([A-Za-z0-9_-]{1,64})(?:\?.*)?$/;

export interface YjsServerDeps {
  jwtSecret: string;
  persistence: DocPersistence;
  getRole: (userId: string, roomId: string) => Promise<Role | null>;
  log: FastifyBaseLogger;
  saveDebounceMs: number;
}

/**
 * A y-websocket compatible server (same wire protocol as the reference
 * implementation) with what the reference server lacks: cookie auth on
 * upgrade, room membership checks, read-only viewers and Postgres persistence.
 */
export class YjsServer {
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: 5 * 1024 * 1024 });
  private readonly docs = new Map<string, Promise<RoomDoc | null>>();

  constructor(private readonly deps: YjsServerDeps) {}

  /** Returns false when the URL is not ours, so other upgrade handlers (Socket.IO) can take it. */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    const match = PATH_RE.exec(req.url ?? '');
    if (!match?.[1]) return false;
    const roomId = match[1];

    void (async () => {
      try {
        const user = authenticateCookieHeader(req.headers.cookie, this.deps.jwtSecret);
        if (!user) return reject(socket, 401, 'Unauthorized');
        const role = await this.deps.getRole(user.id, roomId);
        if (!role) return reject(socket, 403, 'Forbidden');
        const roomDoc = await this.getDoc(roomId);
        if (!roomDoc) return reject(socket, 404, 'Not Found');
        this.wss.handleUpgrade(req, socket, head, (ws) => this.setupConnection(ws, roomDoc, user, role));
      } catch (err) {
        this.deps.log.error({ err, roomId }, 'yjs upgrade failed');
        reject(socket, 500, 'Internal Server Error');
      }
    })();
    return true;
  }

  private getDoc(roomId: string): Promise<RoomDoc | null> {
    let entry = this.docs.get(roomId);
    if (!entry) {
      // Store the promise (not the doc) so concurrent first connections share one load.
      entry = RoomDoc.load(roomId, this.deps.persistence, this.deps.log, this.deps.saveDebounceMs);
      this.docs.set(roomId, entry);
      entry.then(
        (doc) => doc === null && this.docs.delete(roomId),
        () => this.docs.delete(roomId),
      );
    }
    return entry;
  }

  private setupConnection(ws: WebSocket, room: RoomDoc, user: AuthUser, role: Role): void {
    if (room.destroyed) {
      // Lost a race with the last client leaving; the client will simply reconnect.
      ws.close(1013, 'Try again');
      return;
    }
    const readOnly = role === 'VIEWER';
    room.conns.set(ws, new Set());
    this.deps.log.debug({ roomId: room.roomId, userId: user.id, role }, 'yjs client connected');

    ws.on('message', (data: RawData) => this.onMessage(ws, room, toUint8Array(data), readOnly));

    let alive = true;
    ws.on('pong', () => (alive = true));
    const ping = setInterval(() => {
      if (!alive) return ws.terminate();
      alive = false;
      ws.ping();
    }, PING_INTERVAL_MS);

    ws.on('close', () => {
      clearInterval(ping);
      void this.onClose(ws, room);
    });

    // Start the sync handshake: tell the client what we have.
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, room.doc);
    send(ws, encoding.toUint8Array(encoder));

    const states = room.awareness.getStates();
    if (states.size > 0) {
      const aw = encoding.createEncoder();
      encoding.writeVarUint(aw, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(
        aw,
        awarenessProtocol.encodeAwarenessUpdate(room.awareness, [...states.keys()]),
      );
      send(ws, encoding.toUint8Array(aw));
    }
  }

  private onMessage(ws: WebSocket, room: RoomDoc, message: Uint8Array, readOnly: boolean): void {
    try {
      const decoder = decoding.createDecoder(message);
      const encoder = encoding.createEncoder();
      const type = decoding.readVarUint(decoder);

      if (type === MESSAGE_SYNC) {
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        if (readOnly) {
          // Viewers may *ask* for the document (step 1) but their updates are dropped.
          const syncType = decoding.readVarUint(decoder);
          if (syncType === syncProtocol.messageYjsSyncStep1) {
            syncProtocol.readSyncStep1(decoder, encoder, room.doc);
          }
        } else {
          syncProtocol.readSyncMessage(decoder, encoder, room.doc, ws);
        }
        if (encoding.length(encoder) > 1) send(ws, encoding.toUint8Array(encoder));
      } else if (type === MESSAGE_AWARENESS) {
        // Cursors/presence are allowed for everyone, including viewers.
        awarenessProtocol.applyAwarenessUpdate(room.awareness, decoding.readVarUint8Array(decoder), ws);
      }
    } catch (err) {
      this.deps.log.warn({ err, roomId: room.roomId }, 'malformed yjs message; closing socket');
      ws.close(1003, 'Malformed message');
    }
  }

  private async onClose(ws: WebSocket, room: RoomDoc): Promise<void> {
    const ids = room.conns.get(ws);
    room.conns.delete(ws);
    if (ids && ids.size > 0) {
      awarenessProtocol.removeAwarenessStates(room.awareness, [...ids], null);
    }
    if (room.conns.size > 0) return;

    // Last client left: persist immediately, then free memory.
    await room.flush();
    const entry = this.docs.get(room.roomId);
    if (room.conns.size === 0 && entry && (await entry) === room) {
      this.docs.delete(room.roomId);
      room.destroy();
    }
  }

  /** Number of rooms with a live document (for logs/metrics). */
  get activeRooms(): number {
    return this.docs.size;
  }

  /** Graceful shutdown: close sockets and flush every document to Postgres. */
  async close(): Promise<void> {
    const rooms = (await Promise.all(this.docs.values())).filter((r): r is RoomDoc => r !== null);
    for (const client of this.wss.clients) client.close(1001, 'Server shutting down');
    await Promise.all(rooms.map((r) => r.flush()));
    rooms.forEach((r) => r.destroy());
    this.docs.clear();
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
  }
}

function reject(socket: Duplex, status: number, message: string): void {
  if (!socket.writable) return;
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

function toUint8Array(data: RawData): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}
