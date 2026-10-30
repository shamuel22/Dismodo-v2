import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** Builds the embeddable <dismodo-session> element as one self-contained script. */
export default defineConfig({
  plugins: [react()],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: 'dist/embed',
    emptyOutDir: true,
    lib: { entry: 'src/embed.tsx', formats: ['es'], fileName: () => 'dismodo-session.js' },
  },
});
