import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Redis } from 'ioredis';
import { createRedis } from '../src/lib/redis';
import { registerErrorHandler } from '../src/plugins/error-handler';
import rateLimitPlugin from '../src/plugins/rate-limit/plugin';
import {
  MemoryRateLimitStore,
  RedisRateLimitStore,
  type RateLimitStore,
} from '../src/plugins/rate-limit/store';

describe('MemoryRateLimitStore (sliding window)', () => {
  it('allows up to the limit, then denies', async () => {
    const now = 0;
    const store = new MemoryRateLimitStore(() => now);
    for (let i = 0; i < 3; i++) expect((await store.hit('k', 3, 1000)).allowed).toBe(true);
    const denied = await store.hit('k', 3, 1000);
    expect(denied).toEqual({ allowed: false, remaining: 0, retryAfterMs: 1000 });
  });

  it('slides: a slot frees exactly when the oldest request leaves the window', async () => {
    let now = 0;
    const store = new MemoryRateLimitStore(() => now);
    await store.hit('k', 2, 1000); // t=0
    now = 600;
    await store.hit('k', 2, 1000); // t=600
    now = 999;
    expect((await store.hit('k', 2, 1000)).allowed).toBe(false);
    now = 1001; // t=0 request has expired, t=600 still counts
    expect((await store.hit('k', 2, 1000)).allowed).toBe(true);
    expect((await store.hit('k', 2, 1000)).allowed).toBe(false);
  });

  it('no fixed-window boundary burst: 2x limit across a boundary is still denied', async () => {
    let now = 900;
    const store = new MemoryRateLimitStore(() => now);
    for (let i = 0; i < 3; i++) await store.hit('k', 3, 1000);
    now = 1100; // a fixed window would have reset here
    expect((await store.hit('k', 3, 1000)).allowed).toBe(false);
  });

  it('denied requests do not extend the lockout', async () => {
    let now = 0;
    const store = new MemoryRateLimitStore(() => now);
    await store.hit('k', 1, 1000);
    for (now = 100; now < 1000; now += 100) await store.hit('k', 1, 1000);
    now = 1001;
    expect((await store.hit('k', 1, 1000)).allowed).toBe(true);
  });

  it('keys are independent', async () => {
    const store = new MemoryRateLimitStore(() => 0);
    await store.hit('a', 1, 1000);
    expect((await store.hit('b', 1, 1000)).allowed).toBe(true);
  });
});

describe('RedisRateLimitStore', () => {
  let redis: Redis;
  beforeAll(() => {
    redis = createRedis(process.env.REDIS_URL ?? 'redis://localhost:6379/1');
  });
  afterAll(async () => {
    await redis.quit();
  });

  it('enforces the limit atomically under concurrency', async () => {
    const store = new RedisRateLimitStore(redis, `test:${Date.now()}:`);
    const results = await Promise.all(Array.from({ length: 25 }, () => store.hit('user', 10, 60_000)));
    expect(results.filter((r) => r.allowed)).toHaveLength(10);
    const denied = results.find((r) => !r.allowed);
    expect(denied?.retryAfterMs).toBeGreaterThan(59_000);
  });

  it('frees slots after the window passes', async () => {
    const store = new RedisRateLimitStore(redis, `test:${Date.now()}:`);
    expect((await store.hit('u', 1, 200)).allowed).toBe(true);
    expect((await store.hit('u', 1, 200)).allowed).toBe(false);
    await new Promise((r) => setTimeout(r, 250));
    expect((await store.hit('u', 1, 200)).allowed).toBe(true);
  });
});

describe('rate limit plugin', () => {
  async function appWith(store: RateLimitStore) {
    const app = Fastify();
    registerErrorHandler(app);
    await app.register(rateLimitPlugin, { store });
    app.get('/limited', {
      preHandler: app.rateLimit({ name: 't', limit: 2, windowMs: 60_000, key: (r) => r.ip }),
      handler: async () => ({ ok: true }),
    });
    return app;
  }

  it('returns 429 + Retry-After + standard error body', async () => {
    const app = await appWith(new MemoryRateLimitStore());
    await app.inject('/limited');
    const second = await app.inject('/limited');
    expect(second.headers['x-ratelimit-remaining']).toBe('0');
    const res = await app.inject('/limited');
    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toBe('60');
    expect(res.json().error.code).toBe('RATE_LIMITED');
  });

  it('fails open when the store is down', async () => {
    const broken: RateLimitStore = { hit: () => Promise.reject(new Error('redis down')) };
    const app = await appWith(broken);
    expect((await app.inject('/limited')).statusCode).toBe(200);
  });
});
