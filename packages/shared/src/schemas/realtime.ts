import { z } from 'zod';
import { runStatusSchema } from './runs';
import { roomSummarySchema } from './rooms';

/** Socket.IO event names. */
export const SOCKET_EVENTS = {
  ROOM_JOIN: 'room:join',
  RUN_UPDATE: 'run:update',
  ROOM_PRESENCE: 'room:presence',
  ROOM_UPDATED: 'room:updated',
} as const;

export const roomJoinPayloadSchema = z.object({ roomId: z.string().min(1) });
export type RoomJoinPayload = z.infer<typeof roomJoinPayloadSchema>;

/**
 * Published by the worker on the Redis `run:results` channel and forwarded
 * (without roomId) to the Socket.IO room as `run:update`.
 */
export const runUpdateEventSchema = z.object({
  runId: z.string(),
  roomId: z.string(),
  userId: z.string(),
  userName: z.string(),
  status: runStatusSchema,
  stdout: z.string().optional(),
  stderr: z.string().optional(),
  exitCode: z.number().int().optional(),
  durationMs: z.number().int().optional(),
});
export type RunUpdateEvent = z.infer<typeof runUpdateEventSchema>;

export const presenceUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
});
export type PresenceUser = z.infer<typeof presenceUserSchema>;

export const roomPresencePayloadSchema = z.object({ users: z.array(presenceUserSchema) });
export type RoomPresencePayload = z.infer<typeof roomPresencePayloadSchema>;

export const roomUpdatedPayloadSchema = roomSummarySchema.pick({ id: true, name: true, language: true });
export type RoomUpdatedPayload = z.infer<typeof roomUpdatedPayloadSchema>;

export interface ServerToClientEvents {
  'run:update': (payload: RunUpdateEvent) => void;
  'room:presence': (payload: RoomPresencePayload) => void;
  'room:updated': (payload: RoomUpdatedPayload) => void;
}

export type RoomJoinAck = { ok: true } | { ok: false; error: string };

export interface ClientToServerEvents {
  'room:join': (payload: RoomJoinPayload, ack?: (result: RoomJoinAck) => void) => void;
}
