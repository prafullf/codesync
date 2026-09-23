import type { AddressInfo } from 'node:net';
import { createPrismaClient, type PrismaClient } from '@codesync/db';
import type { LightMyRequestResponse } from 'fastify';
import { buildApp, type AppContext } from '../src/app';
import { loadEnv } from '../src/config/env';
import { createRedis } from '../src/lib/redis';
import type { RunQueue } from '../src/modules/runs/run.queue';
import { MemoryRateLimitStore, type RateLimitStore } from '../src/plugins/rate-limit/store';

/** In-memory queue so API tests don't need a worker. */
export class FakeRunQueue implements RunQueue {
  readonly enqueued: string[] = [];
  backlogSize = 0;
  async enqueue(runId: string) {
    this.enqueued.push(runId);
  }
  async backlog() {
    return this.backlogSize;
  }
  async close() {}
}

export interface TestContext extends AppContext {
  queue: FakeRunQueue;
  baseUrl: string;
}

export async function createTestApp(
  opts: { rateLimitStore?: RateLimitStore; listen?: boolean; env?: Record<string, string> } = {},
): Promise<TestContext> {
  // Generous limits by default so tests don't trip over each other; limiter tests override.
  const env = loadEnv({
    ...process.env,
    AUTH_RATE_LIMIT_PER_MIN: '10000',
    RUN_RATE_LIMIT_PER_MIN: '10000',
    ...opts.env,
  });
  const redis = createRedis(env.REDIS_URL);
  const queue = new FakeRunQueue();
  const ctx = await buildApp({
    env,
    redis,
    runQueue: queue,
    rateLimitStore: opts.rateLimitStore ?? new MemoryRateLimitStore(),
  });
  let baseUrl = '';
  if (opts.listen) {
    await ctx.app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = ctx.app.server.address() as AddressInfo;
    baseUrl = `127.0.0.1:${port}`;
  } else {
    await ctx.app.ready();
  }
  return { ...ctx, queue, baseUrl };
}

export async function resetDb(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Run", "DocSnapshot", "RoomMember", "Room", "User" RESTART IDENTITY CASCADE',
  );
}

export function testPrisma(): PrismaClient {
  return createPrismaClient(process.env.DATABASE_URL);
}

let counter = 0;
export function uniqueEmail(): string {
  return `user${Date.now()}_${++counter}@test.dev`;
}

export function cookieFrom(res: LightMyRequestResponse): string {
  const raw = res.headers['set-cookie'];
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (!first) throw new Error('no set-cookie header');
  return first.split(';')[0] ?? '';
}

/** Sign up a fresh user and return their auth cookie. */
export async function signup(ctx: AppContext, name = 'Test User'): Promise<{ cookie: string; id: string }> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/auth/signup',
    payload: { email: uniqueEmail(), name, password: 'password123' },
  });
  if (res.statusCode !== 201) throw new Error(`signup failed: ${res.body}`);
  return { cookie: cookieFrom(res), id: res.json<{ user: { id: string } }>().user.id };
}

export async function createRoom(ctx: AppContext, cookie: string, language = 'PYTHON'): Promise<string> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/rooms',
    headers: { cookie },
    payload: { name: 'Test room', language },
  });
  if (res.statusCode !== 201) throw new Error(`create room failed: ${res.body}`);
  return res.json<{ room: { id: string } }>().room.id;
}
