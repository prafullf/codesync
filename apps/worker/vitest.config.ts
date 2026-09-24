import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Docker-backed tests start real containers; give them room.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
