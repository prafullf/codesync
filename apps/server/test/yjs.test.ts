import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { YDOC_TEXT_KEY } from '@codesync/shared';
import { createRoom, createTestApp, resetDb, signup, type TestContext } from './helpers';

let ctx: TestContext;
const providers: WebsocketProvider[] = [];

beforeEach(async () => {
  ctx ??= await createTestApp({ listen: true, env: { DOC_SAVE_DEBOUNCE_MS: '100' } });
  await resetDb(ctx.prisma);
});
afterAll(async () => {
  providers.forEach((p) => p.destroy());
  await ctx?.app.close();
});

/** ws subclass that sends the auth cookie, like a browser would. */
function wsWithCookie(cookie: string) {
  return class extends WebSocket {
    constructor(url: string, protocols?: string | string[]) {
      super(url, protocols, { headers: { cookie } });
    }
  };
}

function connect(roomId: string, cookie: string, baseUrl = ctx.baseUrl) {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(`ws://${baseUrl}/yjs`, roomId, doc, {
    WebSocketPolyfill: wsWithCookie(cookie) as unknown as typeof globalThis.WebSocket,
    disableBc: true,
    connect: true,
  });
  providers.push(provider);
  return { doc, provider, text: doc.getText(YDOC_TEXT_KEY) };
}

function synced(provider: WebsocketProvider): Promise<void> {
  return new Promise((resolve) => {
    if (provider.synced) return resolve();
    provider.once('sync', (isSynced: boolean) => isSynced && resolve());
  });
}

async function waitFor(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** Raw upgrade attempt, resolving with the HTTP status the server answered. */
function upgradeStatus(roomId: string, cookie?: string): Promise<number> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://${ctx.baseUrl}/yjs/${roomId}`, { headers: cookie ? { cookie } : {} });
    ws.on('open', () => {
      ws.close();
      resolve(101);
    });
    ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
    ws.on('error', () => undefined);
  });
}

describe('yjs websocket server', () => {
  it('seeds a new room with starter code', async () => {
    const { cookie } = await signup(ctx);
    const roomId = await createRoom(ctx, cookie, 'PYTHON');
    const a = connect(roomId, cookie);
    await synced(a.provider);
    expect(a.text.toString()).toContain('print(');
  });

  it('syncs edits between two clients in real time', async () => {
    const owner = await signup(ctx, 'A');
    const guest = await signup(ctx, 'B');
    const roomId = await createRoom(ctx, owner.cookie);
    await ctx.app.inject({ method: 'POST', url: `/api/rooms/${roomId}/join`, headers: { cookie: guest.cookie } });

    const a = connect(roomId, owner.cookie);
    const b = connect(roomId, guest.cookie);
    await Promise.all([synced(a.provider), synced(b.provider)]);

    const started = performance.now();
    a.text.insert(0, '# from A\n');
    await waitFor(() => b.text.toString().startsWith('# from A'));
    expect(performance.now() - started).toBeLessThan(200);

    b.text.insert(b.text.length, '# from B\n');
    await waitFor(() => a.text.toString().endsWith('# from B\n'));
    expect(a.text.toString()).toBe(b.text.toString());
  });

  it('shares awareness (cursors/presence) between clients', async () => {
    const owner = await signup(ctx);
    const roomId = await createRoom(ctx, owner.cookie);
    const a = connect(roomId, owner.cookie);
    const b = connect(roomId, owner.cookie);
    await Promise.all([synced(a.provider), synced(b.provider)]);
    a.provider.awareness.setLocalStateField('user', { name: 'A', color: '#fff' });
    await waitFor(() =>
      [...b.provider.awareness.getStates().values()].some((s) => (s.user as { name?: string })?.name === 'A'),
    );
  });

  it('drops document updates from VIEWERs', async () => {
    const owner = await signup(ctx);
    const viewer = await signup(ctx);
    const roomId = await createRoom(ctx, owner.cookie);
    await ctx.prisma.roomMember.create({ data: { roomId, userId: viewer.id, role: 'VIEWER' } });

    const o = connect(roomId, owner.cookie);
    const v = connect(roomId, viewer.cookie);
    await Promise.all([synced(o.provider), synced(v.provider)]);
    const before = o.text.toString();

    v.text.insert(0, 'HACKED ');
    o.text.insert(o.text.length, '# owner edit\n');
    // The viewer still receives edits...
    await waitFor(() => v.text.toString().includes('# owner edit'));
    await new Promise((r) => setTimeout(r, 200));
    // ...but the owner never sees the viewer's.
    expect(o.text.toString()).toBe(`${before}# owner edit\n`);
  });

  it('rejects unauthenticated and non-member connections', async () => {
    const owner = await signup(ctx);
    const stranger = await signup(ctx);
    const roomId = await createRoom(ctx, owner.cookie);
    expect(await upgradeStatus(roomId)).toBe(401);
    expect(await upgradeStatus(roomId, stranger.cookie)).toBe(403);
    expect(await upgradeStatus(roomId, owner.cookie)).toBe(101);
  });

  it('persists to Postgres so a server restart does not lose code', async () => {
    const owner = await signup(ctx);
    const roomId = await createRoom(ctx, owner.cookie);
    const a = connect(roomId, owner.cookie);
    await synced(a.provider);
    a.text.delete(0, a.text.length);
    a.text.insert(0, 'print("survives restart")\n');
    await new Promise((r) => setTimeout(r, 50));
    a.provider.destroy(); // last client leaves -> immediate flush

    let snapshot = null;
    for (let i = 0; i < 50 && !snapshot; i++) {
      snapshot = await ctx.prisma.docSnapshot.findUnique({ where: { roomId } });
      if (!snapshot) await new Promise((r) => setTimeout(r, 50));
    }
    expect(snapshot).not.toBeNull();

    // A brand-new server instance loads the snapshot.
    const restarted = await createTestApp({ listen: true });
    try {
      const b = connect(roomId, owner.cookie, restarted.baseUrl);
      await synced(b.provider);
      expect(b.text.toString()).toBe('print("survives restart")\n');
      b.provider.destroy();
    } finally {
      await restarted.app.close();
    }
  });
});
