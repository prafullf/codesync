import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { LIMITS } from '@codesync/shared';
import { MemoryRateLimitStore } from '../src/plugins/rate-limit/store';
import { createRoom, createTestApp, resetDb, signup, type TestContext } from './helpers';

let ctx: TestContext;

beforeEach(async () => {
  ctx ??= await createTestApp();
  await resetDb(ctx.prisma);
  ctx.queue.enqueued.length = 0;
  ctx.queue.backlogSize = 0;
});
afterAll(async () => {
  await ctx?.app.close();
});

const runUrl = (roomId: string) => `/api/rooms/${roomId}/runs`;

describe('POST /api/rooms/:roomId/runs', () => {
  it('creates a QUEUED run, enqueues it and returns 202 { runId }', async () => {
    const { cookie } = await signup(ctx);
    const roomId = await createRoom(ctx, cookie);
    const res = await ctx.app.inject({
      method: 'POST',
      url: runUrl(roomId),
      headers: { cookie },
      payload: { language: 'PYTHON', code: 'print(1)' },
    });
    expect(res.statusCode).toBe(202);
    const { runId } = res.json<{ runId: string }>();
    expect(ctx.queue.enqueued).toEqual([runId]);
    const run = await ctx.prisma.run.findUniqueOrThrow({ where: { id: runId } });
    expect(run.status).toBe('QUEUED');
  });

  it('returns 413 when code exceeds 50 KB (bytes, not characters)', async () => {
    const { cookie } = await signup(ctx);
    const roomId = await createRoom(ctx, cookie);
    // 'é' is 2 bytes in UTF-8: fewer than 50K characters but more than 50 KB.
    const code = 'é'.repeat(LIMITS.MAX_CODE_BYTES / 2 + 1);
    const res = await ctx.app.inject({
      method: 'POST',
      url: runUrl(roomId),
      headers: { cookie },
      payload: { language: 'PYTHON', code },
    });
    expect(res.statusCode).toBe(413);
    expect(ctx.queue.enqueued).toHaveLength(0);
  });

  it('returns 503 when the queue is over MAX_QUEUE_LENGTH', async () => {
    const { cookie } = await signup(ctx);
    const roomId = await createRoom(ctx, cookie);
    ctx.queue.backlogSize = 500;
    const res = await ctx.app.inject({
      method: 'POST',
      url: runUrl(roomId),
      headers: { cookie },
      payload: { language: 'PYTHON', code: 'print(1)' },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('QUEUE_FULL');
  });

  it('viewers and non-members cannot run code', async () => {
    const owner = await signup(ctx);
    const viewer = await signup(ctx);
    const stranger = await signup(ctx);
    const roomId = await createRoom(ctx, owner.cookie);
    await ctx.prisma.roomMember.create({ data: { roomId, userId: viewer.id, role: 'VIEWER' } });

    for (const cookie of [viewer.cookie, stranger.cookie]) {
      const res = await ctx.app.inject({
        method: 'POST',
        url: runUrl(roomId),
        headers: { cookie },
        payload: { language: 'PYTHON', code: 'print(1)' },
      });
      expect(res.statusCode).toBe(403);
    }
  });

  it('the 11th run in a minute returns 429 with Retry-After', async () => {
    const limited = await createTestApp({
      rateLimitStore: new MemoryRateLimitStore(),
      env: { RUN_RATE_LIMIT_PER_MIN: '10' },
    });
    try {
      const { cookie } = await signup(limited);
      const roomId = await createRoom(limited, cookie);
      const run = () =>
        limited.app.inject({
          method: 'POST',
          url: runUrl(roomId),
          headers: { cookie },
          payload: { language: 'PYTHON', code: 'print(1)' },
        });
      for (let i = 0; i < 10; i++) expect((await run()).statusCode).toBe(202);
      const blocked = await run();
      expect(blocked.statusCode).toBe(429);
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThanOrEqual(1);
      expect(Number(blocked.headers['retry-after'])).toBeLessThanOrEqual(60);
    } finally {
      await limited.app.close();
    }
  });
});

describe('run history', () => {
  it('lists newest first with a limit, and fetches a single run', async () => {
    const { cookie } = await signup(ctx, 'Runner');
    const roomId = await createRoom(ctx, cookie);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await ctx.app.inject({
        method: 'POST',
        url: runUrl(roomId),
        headers: { cookie },
        payload: { language: 'PYTHON', code: `print(${i})` },
      });
      ids.push(res.json<{ runId: string }>().runId);
    }
    const list = await ctx.app.inject({
      method: 'GET',
      url: `${runUrl(roomId)}?limit=2`,
      headers: { cookie },
    });
    expect(list.statusCode).toBe(200);
    const runs = list.json<{ runs: { id: string; userName: string }[] }>().runs;
    expect(runs.map((r) => r.id)).toEqual([ids[2], ids[1]]);
    expect(runs[0]?.userName).toBe('Runner');

    const single = await ctx.app.inject({ method: 'GET', url: `/api/runs/${ids[0]}`, headers: { cookie } });
    expect(single.json().run).toMatchObject({ id: ids[0], status: 'QUEUED', code: 'print(0)' });
  });

  it('non-members cannot read runs', async () => {
    const owner = await signup(ctx);
    const stranger = await signup(ctx);
    const roomId = await createRoom(ctx, owner.cookie);
    const res = await ctx.app.inject({
      method: 'POST',
      url: runUrl(roomId),
      headers: { cookie: owner.cookie },
      payload: { language: 'PYTHON', code: 'print(1)' },
    });
    const { runId } = res.json<{ runId: string }>();
    const single = await ctx.app.inject({
      method: 'GET',
      url: `/api/runs/${runId}`,
      headers: { cookie: stranger.cookie },
    });
    expect(single.statusCode).toBe(403);
  });
});

describe('health', () => {
  it('/health and /ready report ok', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    const ready = await ctx.app.inject({ method: 'GET', url: '/ready' });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toEqual({ status: 'ready', checks: { db: 'ok', redis: 'ok' } });
  });

  it('echoes a request id on every response', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': 'abc-123' },
    });
    expect(res.headers['x-request-id']).toBe('abc-123');
  });
});
