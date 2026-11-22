import { defineConfig } from 'vitest/config';

// One run across the workspace's TypeScript packages. The web app and infra keep
// their own runners (Vitest with jsdom, and Jest for CDK).
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'packages/*/src/**/*.test.ts',
      'apps/api/src/**/*.test.ts',
      'apps/mcp/src/**/*.test.ts',
      'tools/*/src/**/*.test.ts',
    ],
    passWithNoTests: true,
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: [
        'packages/*/src/**/*.ts',
        'apps/api/src/**/*.ts',
        'apps/mcp/src/**/*.ts',
        'tools/*/src/**/*.ts',
      ],
      exclude: ['**/*.test.ts', '**/index.ts'],
      thresholds: { lines: 70, statements: 70, functions: 70, branches: 70 },
    },
  },
});
