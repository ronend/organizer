import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/',
  build: {
    outDir: 'dist',
  },
  server: {
    // Local dev: forward /api/* to the deployed Lambda Function URL so the
    // SPA can talk to the real backend without CORS. Replace the target
    // with your Lambda Function URL (see README → Local development).
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET || 'http://localhost:3000',
        changeOrigin: true,
        secure: true,
      },
    },
  },
});
