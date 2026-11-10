import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/** Serves the API from the dev and preview servers, mirroring the Vercel rewrites. */
function api(): Plugin {
  const load = () => import('./server/node-adapter').then((m) => m.nodeMiddleware);
  return {
    name: 'bloeisel-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => void load().then((mw) => mw(req, res, next)));
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => void load().then((mw) => mw(req, res, next)));
    },
  };
}

export default defineConfig({
  plugins: [react(), api()],
  server: { host: true, port: 5173 },
  test: { include: ['tests/**/*.test.ts'], environment: 'node', testTimeout: 20000, fileParallelism: false },
});
