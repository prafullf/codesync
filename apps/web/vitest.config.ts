import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Playwright specs in e2e/ are run by `pnpm e2e`, not vitest.
  test: { include: ['src/**/*.test.ts'] },
});
