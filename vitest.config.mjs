import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';

const sharedPackage = fileURLToPath(new URL('./shared', import.meta.url));

export default defineConfig({
  plugins: [react({ jsxRuntime: 'classic' })],
  resolve: {
    alias: {
      '@wee/shared': sharedPackage,
    },
  },
  test: {
    environment: 'node',
    // Rigid-body suites are CPU intensive; avoid oversubscribing shared CI.
    maxWorkers: 4,
    include: ['test/**/*.test.ts', 'server/*.test.js'],
  },
});
