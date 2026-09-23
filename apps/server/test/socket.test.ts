import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { io as ioClient, type Socket } from 'socket.io-client';
import {
  RUN_RESULTS_CHANNEL,
  type ClientToServerEvents,
  type RoomJoinAck,
  type RoomPresencePayload,
  type RunUpdateEvent,
  type ServerToClientEvents,
} from '@codesync/shared';
import { createRoom, createTestApp, resetDb, signup, type TestContext } from './helpers';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let ctx: TestContext;
const sockets: ClientSocket[] = [];

beforeEach(async () => {
  ctx ??= await createTestApp({ listen: true });
  await resetDb(ctx.prisma);
});
afterAll(async () => {
  sockets.forEach((s) => s.disconnect());
  await ctx?.app.close();
});

function connect(cookie?: string): ClientSocket {
  const socket: ClientSocket = ioClient(`http://${ctx.baseUrl}`, {
    transports: ['websocket'],
    extraHeaders: cookie ? { cookie } : {},
    reconnection: false,
  });
  sockets.push(socket);
  return socket;
}

const join = (socket: ClientSocket, roomId: string) =>
  new Promise<RoomJoinAck>((resolve) => socket.emit('room:join', { roomId }, resolve));

describe('socket.io', () => {
  it('rejects connections without a valid cookie', async () => {
    const socket = connect();
    const err = await new Promise<Error>((resolve) => socket.on('connect_error', resolve));
    expect(err.message).toBe('UNAUTHORIZED');
  });

  it('refuses room:join for non-members', async () => {
    const owner = await signup(ctx);
    const stranger = await signup(ctx);
    const roomId = await createRoom(ctx, owner.cookie);
    const ack = await join(connect(stranger.cookie), roomId);
    expect(ack.ok).toBe(false);
  });

  it('broadcasts presence and run updates published on Redis to everyone in the room', async () => {
    const owner = await signup(ctx, 'Owner');
    const guest = await signup(ctx, 'Guest');
    const roomId = await createRoom(ctx, owner.cookie);
    await ctx.app.inject({ method: 'POST', url: `/api/rooms/${roomId}/join`, headers: { cookie: guest.cookie } });

    const a = connect(owner.cookie);
    const b = connect(guest.cookie);
    expect((await join(a, roomId)).ok).toBe(true);

    const presence = new Promise<RoomPresencePayload>((resolve) => {
      a.on('room:presence', (p) => p.users.length === 2 && resolve(p));
    });
    expect((await join(b, roomId)).ok).toBe(true);
    expect((await presence).users.map((u) => u.name).sort()).toEqual(['Guest', 'Owner']);

    const received = Promise.all(
      [a, b].map((s) => new Promise<RunUpdateEvent>((resolve) => s.on('run:update', resolve))),
    );
    const event: RunUpdateEvent = {
      runId: 'r1',
      roomId,
      userId: owner.id,
      userName: 'Owner',
      status: 'SUCCESS',
      stdout: 'hi\n',
      exitCode: 0,
      durationMs: 42,
    };
    // Simulates the worker, which publishes on the same channel.
    await ctx.redis.publish(RUN_RESULTS_CHANNEL, JSON.stringify(event));
    const [ea, eb] = await received;
    expect(ea).toEqual(event);
    expect(eb).toEqual(event);
  });
});
