import type { WebSocket } from 'ws';
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import type { FastifyBaseLogger } from 'fastify';
import { STARTER_CODE, YDOC_TEXT_KEY } from '@codesync/shared';
import type { DocPersistence } from './snapshot.repository';
import { MESSAGE_AWARENESS, MESSAGE_SYNC } from './protocol';

interface AwarenessChange {
  added: number[];
  updated: number[];
  removed: number[];
}

/**
 * One in-memory Y.Doc per active room, shared by every socket in that room.
 * The doc is the source of truth while anyone is connected; Postgres holds a
 * snapshot (throttled writes + a final write when the last client leaves).
 */
export class RoomDoc {
  readonly doc = new Y.Doc();
  readonly awareness = new awarenessProtocol.Awareness(this.doc);
  /** socket -> awareness client ids that socket controls (to clean up cursors on disconnect). */
  readonly conns = new Map<WebSocket, Set<number>>();
  destroyed = false;

  private dirty = false;
  private saveTimer: NodeJS.Timeout | null = null;
  private saving: Promise<void> = Promise.resolve();

  private constructor(
    readonly roomId: string,
    private readonly persistence: DocPersistence,
    private readonly log: FastifyBaseLogger,
    private readonly saveDebounceMs: number,
  ) {
    // The server has no cursor of its own.
    this.awareness.setLocalState(null);
  }

  static async load(
    roomId: string,
    persistence: DocPersistence,
    log: FastifyBaseLogger,
    saveDebounceMs: number,
  ): Promise<RoomDoc | null> {
    const stored = await persistence.load(roomId);
    if (!stored) return null;
    const room = new RoomDoc(roomId, persistence, log, saveDebounceMs);
    if (stored.state) {
      Y.applyUpdate(room.doc, stored.state);
    } else {
      // Brand-new room: seed on the server (one writer, so no duplicate starter code).
      room.doc.getText(YDOC_TEXT_KEY).insert(0, STARTER_CODE[stored.language]);
      room.dirty = true;
    }
    // Attach listeners only after the initial state is in.
    room.doc.on('update', room.onDocUpdate);
    room.awareness.on('update', room.onAwarenessUpdate);
    return room;
  }

  private onDocUpdate = (update: Uint8Array): void => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    this.broadcast(encoding.toUint8Array(encoder));
    this.scheduleSave();
  };

  private onAwarenessUpdate = ({ added, updated, removed }: AwarenessChange, origin: unknown): void => {
    const changed = [...added, ...updated, ...removed];
    const ids = this.conns.get(origin as WebSocket);
    if (ids) {
      added.forEach((id) => ids.add(id));
      removed.forEach((id) => ids.delete(id));
    }
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed));
    this.broadcast(encoding.toUint8Array(encoder));
  };

  broadcast(message: Uint8Array): void {
    for (const ws of this.conns.keys()) send(ws, message);
  }

  /** Throttle: at most one DB write per `saveDebounceMs` while edits keep coming. */
  private scheduleSave(): void {
    this.dirty = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.flush();
    }, this.saveDebounceMs);
  }

  /** Write the snapshot now if anything changed. Serialised so writes never interleave. */
  flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.saving = this.saving.then(async () => {
      if (!this.dirty) return;
      this.dirty = false;
      try {
        await this.persistence.save(this.roomId, Y.encodeStateAsUpdate(this.doc));
      } catch (err) {
        this.dirty = true;
        this.log.error({ err, roomId: this.roomId }, 'failed to persist yjs snapshot');
      }
    });
    return this.saving;
  }

  destroy(): void {
    this.destroyed = true;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.awareness.destroy();
    this.doc.destroy();
  }
}

export function send(ws: WebSocket, message: Uint8Array): void {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(message, (err) => {
    if (err) ws.terminate();
  });
}
