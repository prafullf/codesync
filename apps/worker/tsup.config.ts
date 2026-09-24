import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  clean: true,
  sourcemap: true,
  noExternal: ['@codesync/shared', '@codesync/db'],
  external: ['@prisma/client', '.prisma/client'],
});
