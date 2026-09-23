import type { FastifyInstance } from 'fastify';
import { createRoomBodySchema, idParamSchema, updateRoomBodySchema } from '@codesync/shared';
import { z } from 'zod';
import { parse } from '../../lib/validate';
import { currentUser } from '../../plugins/authenticate';
import type { RouteDeps } from '../../app';

const roomParams = z.object({ roomId: idParamSchema });

export async function roomRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  const { roomService, requireAuth } = deps;
  app.addHook('preHandler', requireAuth);

  app.post('/api/rooms', async (request, reply) => {
    const body = parse(createRoomBodySchema, request.body);
    const room = await roomService.create(currentUser(request).id, body);
    return reply.status(201).send({ room });
  });

  app.get('/api/rooms', async (request) => {
    return { rooms: await roomService.listMine(currentUser(request).id) };
  });

  app.get('/api/rooms/:roomId', async (request) => {
    const { roomId } = parse(roomParams, request.params);
    return { room: await roomService.getDetails(currentUser(request).id, roomId) };
  });

  app.post('/api/rooms/:roomId/join', async (request) => {
    const { roomId } = parse(roomParams, request.params);
    return { room: await roomService.join(currentUser(request).id, roomId) };
  });

  app.patch('/api/rooms/:roomId', async (request) => {
    const { roomId } = parse(roomParams, request.params);
    const body = parse(updateRoomBodySchema, request.body);
    return { room: await roomService.update(currentUser(request).id, roomId, body) };
  });
}
