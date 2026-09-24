import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API = process.env.VITE_DEV_API_TARGET ?? 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Same-origin in dev: cookies just work and there is no CORS.
    proxy: {
      '/api': API,
      '/health': API,
      '/yjs': { target: API.replace(/^http/, 'ws'), ws: true },
      '/socket.io': { target: API, ws: true },
    },
  },
  build: {
    chunkSizeWarningLimit: 4000, // Monaco is big by nature
  },
});
