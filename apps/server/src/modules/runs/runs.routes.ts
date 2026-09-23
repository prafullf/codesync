import type { FastifyInstance } from 'fastify';
import { createRunBodySchema, idParamSchema, runHistoryQuerySchema } from '@codesync/shared';
import { z } from 'zod';
import { parse } from '../../lib/validate';
import { currentUser } from '../../plugins/authenticate';
import type { RouteDeps } from '../../app';

const roomParams = z.object({ roomId: idParamSchema });
const runParams = z.object({ runId: idParamSchema });

export async function runRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  const { runService, requireAuth, rateLimit, env } = deps;
  app.addHook('preHandler', requireAuth);

  const runLimiter = rateLimit({
    name: 'runs',
    limit: env.RUN_RATE_LIMIT_PER_MIN,
    windowMs: 60_000,
    key: (request) => currentUser(request).id,
  });

  app.post('/api/rooms/:roomId/runs', { preHandler: runLimiter }, async (request, reply) => {
    const { roomId } = parse(roomParams, request.params);
    const body = parse(createRunBodySchema, request.body);
    const result = await runService.create(currentUser(request).id, roomId, body);
    return reply.status(202).send(result);
  });

  app.get('/api/rooms/:roomId/runs', async (request) => {
    const { roomId } = parse(roomParams, request.params);
    const { limit } = parse(runHistoryQuerySchema, request.query);
    return { runs: await runService.list(currentUser(request).id, roomId, limit) };
  });

  app.get('/api/runs/:runId', async (request) => {
    const { runId } = parse(runParams, request.params);
    return { run: await runService.get(currentUser(request).id, runId) };
  });
}
