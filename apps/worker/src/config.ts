import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(2),
  DOCKER_SOCKET_PATH: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined)),
  SANDBOX_IMAGE_PREFIX: z.string().min(1).default('codesync-sandbox'),
});

export type WorkerEnv = z.infer<typeof envSchema>;

export function loadWorkerEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid worker configuration:\n${details}`);
  }
  return result.data;
}
