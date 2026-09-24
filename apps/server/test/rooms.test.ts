import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createRoom, createTestApp, resetDb, signup, type TestContext } from './helpers';

let ctx: TestContext;

beforeEach(async () => {
  ctx ??= await createTestApp();
  await resetDb(ctx.prisma);
});
afterAll(async () => {
  await ctx?.app.close();
});

describe('rooms', () => {
  it('creates a room with the caller as OWNER and lists it', async () => {
    const { cookie } = await signup(ctx);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/rooms',
      headers: { cookie },
      payload: { name: 'Interview prep', language: 'CPP' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().room).toMatchObject({ name: 'Interview prep', language: 'CPP', role: 'OWNER' });

    const list = await ctx.app.inject({ method: 'GET', url: '/api/rooms', headers: { cookie } });
    expect(list.json().rooms).toHaveLength(1);
  });

  it('requires auth', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/rooms' });
    expect(res.statusCode).toBe(401);
  });

  it('non-members get 403, unknown rooms 404', async () => {
    const owner = await signup(ctx);
    const stranger = await signup(ctx);
    const roomId = await createRoom(ctx, owner.cookie);

    const forbidden = await ctx.app.inject({
      method: 'GET',
      url: `/api/rooms/${roomId}`,
      headers: { cookie: stranger.cookie },
    });
    expect(forbidden.statusCode).toBe(403);

    const missing = await ctx.app.inject({
      method: 'GET',
      url: '/api/rooms/does-not-exist',
      headers: { cookie: owner.cookie },
    });
    expect(missing.statusCode).toBe(404);
  });

  it('joining via link makes you an EDITOR (idempotent)', async () => {
    const owner = await signup(ctx, 'Owner');
    const guest = await signup(ctx, 'Guest');
    const roomId = await createRoom(ctx, owner.cookie);

    for (let i = 0; i < 2; i++) {
      const res = await ctx.app.inject({
        method: 'POST',
        url: `/api/rooms/${roomId}/join`,
        headers: { cookie: guest.cookie },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().room.role).toBe('EDITOR');
      expect(res.json().room.members).toHaveLength(2);
    }
  });

  it('concurrent joins by the same user do not fail (race-safe)', async () => {
    const owner = await signup(ctx);
    const guest = await signup(ctx);
    const roomId = await createRoom(ctx, owner.cookie);
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        ctx.app.inject({ method: 'POST', url: `/api/rooms/${roomId}/join`, headers: { cookie: guest.cookie } }),
      ),
    );
    expect(results.map((r) => r.statusCode)).toEqual([200, 200, 200, 200, 200]);
  });

  it('owner joining their own room stays OWNER', async () => {
    const owner = await signup(ctx);
    const roomId = await createRoom(ctx, owner.cookie);
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/rooms/${roomId}/join`,
      headers: { cookie: owner.cookie },
    });
    expect(res.json().room.role).toBe('OWNER');
  });

  it('only the owner can rename or change language', async () => {
    const owner = await signup(ctx);
    const editor = await signup(ctx);
    const roomId = await createRoom(ctx, owner.cookie);
    await ctx.app.inject({ method: 'POST', url: `/api/rooms/${roomId}/join`, headers: { cookie: editor.cookie } });

    const denied = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/rooms/${roomId}`,
      headers: { cookie: editor.cookie },
      payload: { language: 'JAVASCRIPT' },
    });
    expect(denied.statusCode).toBe(403);

    const ok = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/rooms/${roomId}`,
      headers: { cookie: owner.cookie },
      payload: { name: 'Renamed', language: 'JAVASCRIPT' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().room).toMatchObject({ name: 'Renamed', language: 'JAVASCRIPT' });
  });

  it('rejects an empty PATCH body', async () => {
    const owner = await signup(ctx);
    const roomId = await createRoom(ctx, owner.cookie);
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/rooms/${roomId}`,
      headers: { cookie: owner.cookie },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});
