import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { cookieFrom, createTestApp, resetDb, uniqueEmail, type TestContext } from './helpers';

let ctx: TestContext;

beforeEach(async () => {
  ctx ??= await createTestApp();
  await resetDb(ctx.prisma);
});
afterAll(async () => {
  await ctx?.app.close();
});

describe('POST /api/auth/signup', () => {
  it('creates a user and sets an httpOnly cookie', async () => {
    const email = uniqueEmail();
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: { email, name: 'Asha', password: 'password123' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().user).toMatchObject({ email, name: 'Asha' });
    expect(res.json().user.passwordHash).toBeUndefined();
    const setCookie = String(res.headers['set-cookie']);
    expect(setCookie).toContain('codesync_token=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
  });

  it('stores a bcrypt hash, never the plain password', async () => {
    const email = uniqueEmail();
    await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: { email, name: 'A', password: 'password123' },
    });
    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.passwordHash).not.toBe('password123');
    expect(user.passwordHash).toMatch(/^\$2[aby]\$/);
  });

  it('rejects duplicate emails with 409', async () => {
    const payload = { email: uniqueEmail(), name: 'A', password: 'password123' };
    await ctx.app.inject({ method: 'POST', url: '/api/auth/signup', payload });
    const res = await ctx.app.inject({ method: 'POST', url: '/api/auth/signup', payload });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: { code: 'CONFLICT', message: expect.any(String) } });
  });

  it('validates input with the shared schema', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: { email: 'not-an-email', name: '', password: 'short' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/auth/login', () => {
  it('logs in with correct credentials (email is case-insensitive)', async () => {
    const email = uniqueEmail();
    await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: { email, name: 'A', password: 'password123' },
    });
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: email.toUpperCase(), password: 'password123' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['set-cookie']).toBeDefined();
  });

  it('returns the same 401 for wrong password and unknown email', async () => {
    const email = uniqueEmail();
    await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: { email, name: 'A', password: 'password123' },
    });
    const wrong = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password: 'nope-nope' },
    });
    const unknown = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: uniqueEmail(), password: 'nope-nope' },
    });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json()).toEqual(unknown.json());
  });
});

describe('GET /api/auth/me and logout', () => {
  it('returns the current user for a valid cookie', async () => {
    const signup = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: { email: uniqueEmail(), name: 'Me', password: 'password123' },
    });
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: cookieFrom(signup) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.name).toBe('Me');
  });

  it('rejects missing or tampered tokens', async () => {
    const none = await ctx.app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(none.statusCode).toBe(401);
    const bad = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: 'codesync_token=eyJhbGciOiJIUzI1NiJ9.e30.forged' },
    });
    expect(bad.statusCode).toBe(401);
  });

  it('logout clears the cookie', async () => {
    const signup = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: { email: uniqueEmail(), name: 'A', password: 'password123' },
    });
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie: cookieFrom(signup) },
    });
    expect(res.statusCode).toBe(204);
    expect(String(res.headers['set-cookie'])).toContain('codesync_token=;');
  });
});

describe('auth rate limit', () => {
  it('allows 5 attempts per minute per IP, then 429 with Retry-After', async () => {
    const { MemoryRateLimitStore } = await import('../src/plugins/rate-limit/store');
    const limited = await createTestApp({
      rateLimitStore: new MemoryRateLimitStore(),
      env: { AUTH_RATE_LIMIT_PER_MIN: '5' },
    });
    try {
      const attempt = () =>
        limited.app.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { email: 'x@test.dev', password: 'whatever' },
          remoteAddress: '10.0.0.7',
        });
      for (let i = 0; i < 5; i++) expect((await attempt()).statusCode).toBe(401);
      const blocked = await attempt();
      expect(blocked.statusCode).toBe(429);
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    } finally {
      await limited.app.close();
    }
  });
});
