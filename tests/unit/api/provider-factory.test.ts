import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProviderFactory, buildProvider } from '../../src/api/provider-factory.js';
import type { AIProvider } from '../../src/api/provider-interface.js';

// Mock environment loader
vi.mock('../../src/config/env-loader.js', () => ({
  loadEnv: vi.fn().mockReturnValue({
    DOGE_PROVIDER: 'anthropic',
    DOGE_MODEL: 'claude-3-sonnet-20240620',
    ANTHROPIC_API_KEY: 'test-key',
    OPENAI_API_KEY: '',
  }),
}));

describe('ProviderFactory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create Anthropic provider', () => {
    const factory = new ProviderFactory();
    const provider = factory.createProvider('anthropic');

    expect(provider).toBeDefined();
    expect(provider.name).toBe('anthropic');
  });

  it('should create OpenAI provider', () => {
    const factory = new ProviderFactory();
    const provider = factory.createProvider('openai');

    expect(provider).toBeDefined();
    expect(provider.name).toBe('openai');
  });

  it('should create custom provider', () => {
    const factory = new ProviderFactory();
    const provider = factory.createProvider('custom');

    expect(provider).toBeDefined();
  });

  it('should have complete method', () => {
    const factory = new ProviderFactory();
    const provider = factory.createProvider('anthropic');

    expect(typeof provider.complete).toBe('function');
  });

  it('should build provider from environment', () => {
    const provider = buildProvider();

    expect(provider).toBeDefined();
    expect(provider.name).toBe('anthropic');
  });
});

describe('Provider Interface', () => {
  it('should have correct interface structure', () => {
    const factory = new ProviderFactory();
    const provider = factory.createProvider('anthropic');

    expect(provider).toHaveProperty('name');
    expect(provider).toHaveProperty('complete');
    expect(typeof provider.name).toBe('string');
    expect(typeof provider.complete).toBe('function');
  });

  it('should return provider with name property', () => {
    const factory = new ProviderFactory();

    const anthropicProvider = factory.createProvider('anthropic');
    expect(anthropicProvider.name).toBe('anthropic');

    const openaiProvider = factory.createProvider('openai');
    expect(openaiProvider.name).toBe('openai');
  });
});
