import type { FastifyInstance } from 'fastify';
import type { RouteDeps } from '../../app';

export async function healthRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  /** Liveness: the process is up and the event loop is responsive. */
  app.get('/health', async () => ({ status: 'ok' }));

  /** Readiness: dependencies are reachable, so a load balancer may send traffic. */
  app.get('/ready', async (_request, reply) => {
    const checks = await Promise.allSettled([deps.prisma.$queryRaw`SELECT 1`, deps.redis.ping()]);
    const [db, redis] = checks.map((c) => (c.status === 'fulfilled' ? 'ok' : 'down'));
    const ok = db === 'ok' && redis === 'ok';
    return reply.status(ok ? 200 : 503).send({ status: ok ? 'ready' : 'not_ready', checks: { db, redis } });
  });
}
