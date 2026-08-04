import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Self-host nginx root: '/'. GitHub Pages: set VITE_BASE=/ielts-vocab/
  base: process.env.VITE_BASE || '/',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    chunkSizeWarningLimit: 1024,
  },
  server: {
    port: 5173,
    host: '0.0.0.0',
    proxy: {
      // Dev: Vite → local Fastify API
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
      // Dev-only: browser → Vite → Youdao (avoids CORS without API)
      '/youdao-proxy': {
        target: 'https://dict.youdao.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/youdao-proxy/, ''),
      },
    },
  },
});