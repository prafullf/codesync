import { defineConfig } from '@playwright/test';

/**
 * E2E against a running stack: `docker compose up -d && pnpm dev` first.
 * (API, worker and Docker sandboxes are all involved, so we don't boot them here.)
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
    viewport: { width: 1400, height: 820 },
  },
  // No device preset: keep the host's real user agent so Monaco's Ctrl-vs-Cmd
  // detection matches the ControlOrMeta keys Playwright sends.
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
