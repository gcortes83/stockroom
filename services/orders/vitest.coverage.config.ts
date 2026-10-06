import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts'],
    testTimeout: 120_000,
    hookTimeout: 180_000,
    pool: 'forks',
    coverage: {
      provider: 'v8',
      include: ['src/**/domain/**/*.ts', 'src/**/application/**/*.ts'],
      reporter: ['text', 'text-summary', 'html'],
      thresholds: { lines: 80 },
    },
  },
});
