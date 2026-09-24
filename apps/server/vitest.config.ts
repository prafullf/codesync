import { defineConfig } from 'vitest/config';

const testEnv = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL:
    process.env.TEST_DATABASE_URL ?? 'postgresql://codesync:codesync@localhost:5432/codesync_test',
  REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/1',
  JWT_SECRET: 'test-secret-test-secret-test-secret-123',
  WEB_ORIGIN: 'http://localhost:5173',
  COOKIE_SECURE: 'false',
  RUN_RATE_LIMIT_PER_MIN: '10',
  AUTH_RATE_LIMIT_PER_MIN: '5',
  MAX_QUEUE_LENGTH: '500',
};
// globalSetup (migrations) runs in this process, so it needs the env too.
Object.assign(process.env, testEnv);

export default defineConfig({
  test: {
    // Integration tests share one Postgres/Redis, so run files one at a time.
    fileParallelism: false,
    globalSetup: ['./test/global-setup.ts'],
    env: testEnv,
    testTimeout: 15_000,
    hookTimeout: 30_000,
  },
});
