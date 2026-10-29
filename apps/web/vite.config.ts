import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const api = process.env.DISMODO_API_URL ?? 'http://localhost:4100';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // In development the API runs separately; in production it serves this build itself.
    proxy: { '/v1': api, '/health': api, '/llms.txt': api, '/llms-full.txt': api, '^/docs/[^/]+\.md$': api },
  },
  build: { outDir: 'dist', sourcemap: true },
});
