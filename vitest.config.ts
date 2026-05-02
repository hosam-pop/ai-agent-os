import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules/**',
        'tests/**',
        'dist/**',
        '**/*.config.*',
        '**/*.d.ts',
        '**/*.md',
      ],
      reportsDirectory: 'coverage/unit',
    },
    testTimeout: 10000,
    hookTimeout: 10000,
    passWithNoTests: true,
    setupFiles: ['tests/unit/setup.ts'],
  },
});
