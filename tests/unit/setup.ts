import { vi } from 'vitest';

// Mock console methods to reduce noise in tests
global.console = {
  ...console,
  log: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

// Mock environment variables
process.env.NODE_ENV = 'test';
process.env.DOGE_HOME = '/tmp/test-doge';
process.env.DOGE_WORKSPACE = '/tmp/test-workspace';
process.env.DOGE_CONTEXT_TOKEN_BUDGET = '100000';
process.env.DOGE_MAX_ITERATIONS = '10';
process.env.DOGE_LOG_LEVEL = 'silent';
