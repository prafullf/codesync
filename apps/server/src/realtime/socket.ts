import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import type { Redis } from 'ioredis';
import type { FastifyBaseLogger } from 'fastify';
import {
  RUN_RESULTS_CHANNEL,
  colorForUser,
  roomJoinPayloadSchema,
  roomUpdatedPayloadSchema,
  runUpdateEventSchema,
  type ClientToServerEvents,
  type PresenceUser,
  type Role,
  type ServerToClientEvents,
} from '@codesync/shared';
import { ROOM_UPDATES_CHANNEL } from '../lib/event-bus';
import { authenticateCookieHeader, type AuthUser } from '../modules/auth/tokens';

interface SocketData {
  user: AuthUser;
  roomId: string | null;
}

type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
export type AppIo = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

export interface SocketDeps {
  httpServer: HttpServer;
  subscriber: Redis;
  jwtSecret: string;
  webOrigin: string;
  getRole: (userId: string, roomId: string) => Promise<Role | null>;
  log: FastifyBaseLogger;
}

const channelFor = (roomId: string) => `room:${roomId}`;

/**
 * Socket.IO carries app events (run status, presence). Document edits go over
 * the separate Yjs WebSocket, which is binary and CRDT-specific.
 */
export function createSocketServer(deps: SocketDeps): { io: AppIo; close: () => Promise<void> } {
  const io: AppIo = new Server(deps.httpServer, {
    cors: { origin: deps.webOrigin, credentials: true },
    // Our own upgrade handler owns /yjs; don't let engine.io kill those sockets.
    destroyUpgrade: false,
  });

  // Presence is per API instance (sockets connected here). See README trade-offs.
  const presence = new Map<string, Map<string, PresenceUser>>();

  const emitPresence = (roomId: string) => {
    const bySocket = presence.get(roomId);
    const unique = new Map<string, PresenceUser>();
    bySocket?.forEach((u) => unique.set(u.id, u));
    io.to(channelFor(roomId)).emit('room:presence', { users: [...unique.values()] });
  };

  const leaveRoom = (socket: AppSocket) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    void socket.leave(channelFor(roomId));
    socket.data.roomId = null;
    const bySocket = presence.get(roomId);
    bySocket?.delete(socket.id);
    if (bySocket?.size === 0) presence.delete(roomId);
    emitPresence(roomId);
  };

  io.use((socket, next) => {
    const user = authenticateCookieHeader(socket.handshake.headers.cookie, deps.jwtSecret);
    if (!user) return next(new Error('UNAUTHORIZED'));
    socket.data.user = user;
    socket.data.roomId = null;
    next();
  });

  io.on('connection', (socket: AppSocket) => {
    socket.on('room:join', async (payload, ack) => {
      const parsed = roomJoinPayloadSchema.safeParse(payload);
      if (!parsed.success) return ack?.({ ok: false, error: 'Invalid payload' });
      const { roomId } = parsed.data;
      try {
        const role = await deps.getRole(socket.data.user.id, roomId);
        if (!role) return ack?.({ ok: false, error: 'Not a member of this room' });

        leaveRoom(socket);
        await socket.join(channelFor(roomId));
        socket.data.roomId = roomId;
        const { id, name } = socket.data.user;
        if (!presence.has(roomId)) presence.set(roomId, new Map());
        presence.get(roomId)?.set(socket.id, { id, name, color: colorForUser(id) });
        emitPresence(roomId);
        ack?.({ ok: true });
      } catch (err) {
        deps.log.error({ err, roomId }, 'room:join failed');
        ack?.({ ok: false, error: 'Internal error' });
      }
    });

    socket.on('disconnect', () => leaveRoom(socket));
  });

  // Fan-out: every API instance subscribes, so a result published by any
  // worker reaches users no matter which instance they are connected to.
  void deps.subscriber.subscribe(RUN_RESULTS_CHANNEL, ROOM_UPDATES_CHANNEL);
  deps.subscriber.on('message', (channel: string, raw: string) => {
    try {
      const data: unknown = JSON.parse(raw);
      if (channel === RUN_RESULTS_CHANNEL) {
        const event = runUpdateEventSchema.parse(data);
        io.to(channelFor(event.roomId)).emit('run:update', event);
      } else if (channel === ROOM_UPDATES_CHANNEL) {
        const event = roomUpdatedPayloadSchema.parse(data);
        io.to(channelFor(event.id)).emit('room:updated', event);
      }
    } catch (err) {
      deps.log.warn({ err, channel }, 'dropping malformed pub/sub message');
    }
  });

  return {
    io,
    close: async () => {
      await deps.subscriber.unsubscribe();
      await new Promise<void>((resolve) => io.close(() => resolve()));
    },
  };
}
