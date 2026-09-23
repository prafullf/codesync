import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  WEB_ORIGIN: z.string().url(),
  COOKIE_SECURE: booleanString,
  RUN_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(10),
  AUTH_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(5),
  MAX_QUEUE_LENGTH: z.coerce.number().int().positive().default(500),
  /** How often a changed Yjs document is written to Postgres. */
  DOC_SAVE_DEBOUNCE_MS: z.coerce.number().int().positive().default(5_000),
});

export type Env = z.infer<typeof envSchema>;

/** Parse and validate env vars once at startup. Throws (fail fast) on bad config. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  return result.data;
}
