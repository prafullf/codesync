import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance, type preHandlerAsyncHookHandler } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import type { Redis } from 'ioredis';
import { createPrismaClient, type PrismaClient } from '@codesync/db';
import type { Env } from './config/env';
import { EventBus } from './lib/event-bus';
import { createRedis } from './lib/redis';
import { registerErrorHandler } from './plugins/error-handler';
import { requireAuth } from './plugins/authenticate';
import rateLimitPlugin, { type RateLimitFactory } from './plugins/rate-limit/plugin';
import { RedisRateLimitStore, type RateLimitStore } from './plugins/rate-limit/store';
import { authRoutes } from './modules/auth/auth.routes';
import { AuthService } from './modules/auth/auth.service';
import { UserRepository } from './modules/auth/user.repository';
import { healthRoutes } from './modules/health/health.routes';
import { roomRoutes } from './modules/rooms/rooms.routes';
import { RoomRepository } from './modules/rooms/rooms.repository';
import { RoomService } from './modules/rooms/rooms.service';
import { BullRunQueue, type RunQueue } from './modules/runs/run.queue';
import { runRoutes } from './modules/runs/runs.routes';
import { RunRepository } from './modules/runs/runs.repository';
import { RunService } from './modules/runs/runs.service';
import { createSocketServer, type AppIo } from './realtime/socket';
import { PrismaDocPersistence } from './realtime/yjs/snapshot.repository';
import { YjsServer } from './realtime/yjs/yjs-server';

/** Everything route modules need, injected (so tests can swap pieces). */
export interface RouteDeps {
  env: Env;
  prisma: PrismaClient;
  redis: Redis;
  authService: AuthService;
  roomService: RoomService;
  runService: RunService;
  requireAuth: preHandlerAsyncHookHandler;
  rateLimit: RateLimitFactory;
}

export interface BuildAppOptions {
  env: Env;
  prisma?: PrismaClient;
  redis?: Redis;
  runQueue?: RunQueue;
  rateLimitStore?: RateLimitStore;
}

export interface AppContext {
  app: FastifyInstance;
  io: AppIo;
  yjs: YjsServer;
  prisma: PrismaClient;
  redis: Redis;
}

export async function buildApp(opts: BuildAppOptions): Promise<AppContext> {
  const { env } = opts;

  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      ...(env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
      redact: ['req.headers.cookie', 'res.headers["set-cookie"]'],
    },
    // Accept an upstream request id (from a proxy) or mint one; it's on every log line.
    requestIdHeader: 'x-request-id',
    genReqId: () => randomUUID(),
    // Headroom above the 50 KB code limit so the service can return a clear 413.
    bodyLimit: 256 * 1024,
    trustProxy: true,
  });

  const prisma = opts.prisma ?? createPrismaClient(env.DATABASE_URL);
  const redis = opts.redis ?? createRedis(env.REDIS_URL);
  // A subscribed connection cannot run other commands (not even the ready check).
  const subscriber = redis.duplicate({ enableReadyCheck: false });
  const runQueue = opts.runQueue ?? new BullRunQueue(redis);
  const events = new EventBus(redis);

  const userRepo = new UserRepository(prisma);
  const roomRepo = new RoomRepository(prisma);
  const runRepo = new RunRepository(prisma);
  const authService = new AuthService(userRepo, env.JWT_SECRET);
  const roomService = new RoomService(roomRepo, events);
  const runService = new RunService(runRepo, roomService, runQueue, events, env.MAX_QUEUE_LENGTH);

  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });
  app.decorateRequest('authUser', null);
  registerErrorHandler(app);
  await app.register(cookie);
  await app.register(cors, { origin: env.WEB_ORIGIN, credentials: true });
  await app.register(rateLimitPlugin, { store: opts.rateLimitStore ?? new RedisRateLimitStore(redis) });

  const deps: RouteDeps = {
    env,
    prisma,
    redis,
    authService,
    roomService,
    runService,
    requireAuth: requireAuth(env.JWT_SECRET),
    rateLimit: app.rateLimit,
  };
  await app.register(healthRoutes, deps);
  await app.register(authRoutes, deps);
  await app.register(roomRoutes, deps);
  await app.register(runRoutes, deps);

  const getRole = (userId: string, roomId: string) => roomService.getRole(userId, roomId);

  const yjs = new YjsServer({
    jwtSecret: env.JWT_SECRET,
    persistence: new PrismaDocPersistence(prisma),
    getRole,
    log: app.log,
    saveDebounceMs: env.DOC_SAVE_DEBOUNCE_MS,
  });
  app.server.on('upgrade', (req, socket, head) => {
    yjs.handleUpgrade(req, socket, head);
  });

  const sockets = createSocketServer({
    httpServer: app.server,
    subscriber,
    jwtSecret: env.JWT_SECRET,
    webOrigin: env.WEB_ORIGIN,
    getRole,
    log: app.log,
  });

  // app.close(): preClose runs before the HTTP server stops, so long-lived
  // sockets are closed (and Yjs docs flushed) instead of holding shutdown open.
  app.addHook('preClose', async () => {
    await sockets.close();
    await yjs.close();
  });
  app.addHook('onClose', async () => {
    await runQueue.close();
    subscriber.disconnect();
    await redis.quit();
    await prisma.$disconnect();
  });

  return { app, io: sockets.io, yjs, prisma, redis };
}
