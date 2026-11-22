/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 3000,
    // `pnpm dev` can talk to a deployed API: set PURR_API_PROXY, e.g. https://purr.sandbox.nakomis.com
    ...(process.env.PURR_API_PROXY && {
      proxy: { '/api': { target: process.env.PURR_API_PROXY, changeOrigin: true } },
    }),
  },
  test: {
    globals: true,
    environment: 'jsdom',
    // Claude Code sessions cap workers so parallel agents don't swamp the Mac; unset keeps the default.
    ...(process.env.TEST_MAX_WORKERS && { maxWorkers: Number(process.env.TEST_MAX_WORKERS) }),
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**', 'src/main.tsx', 'src/vite-env.d.ts'],
      thresholds: { lines: 70 },
    },
  },
});
