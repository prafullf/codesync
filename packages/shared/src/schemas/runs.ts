import { z } from 'zod';
import { LIMITS, RUN_STATUSES } from '../constants';
import { languageSchema } from './rooms';

export const runStatusSchema = z.enum(RUN_STATUSES);

/**
 * Body for POST /api/rooms/:roomId/runs.
 * The byte-size check (413) happens in the service because Zod's max() counts
 * UTF-16 code units, not bytes.
 */
export const createRunBodySchema = z.object({
  language: languageSchema,
  code: z.string().min(1),
});
export type CreateRunBody = z.infer<typeof createRunBodySchema>;

export const createRunResponseSchema = z.object({ runId: z.string() });
export type CreateRunResponse = z.infer<typeof createRunResponseSchema>;

export const runSchema = z.object({
  id: z.string(),
  roomId: z.string(),
  userId: z.string(),
  userName: z.string(),
  language: languageSchema,
  code: z.string(),
  status: runStatusSchema,
  stdout: z.string().nullable(),
  stderr: z.string().nullable(),
  exitCode: z.number().int().nullable(),
  durationMs: z.number().int().nullable(),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
});
export type Run = z.infer<typeof runSchema>;

export const runResponseSchema = z.object({ run: runSchema });
export const runListResponseSchema = z.object({ runs: z.array(runSchema) });

export const runHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(LIMITS.RUN_HISTORY_MAX).default(LIMITS.RUN_HISTORY_DEFAULT),
});

/** BullMQ job payload. Only the id: the worker loads everything else from Postgres. */
export const runJobDataSchema = z.object({ runId: z.string() });
export type RunJobData = z.infer<typeof runJobDataSchema>;
