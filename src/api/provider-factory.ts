import { loadEnv } from '../config/env-loader.js';
import { AnthropicProvider } from './anthropic-provider.js';
import { OpenAIProvider } from './openai-provider.js';
import type { AIProvider } from './provider-interface.js';

/**
 * Select and build the AI provider using the current environment.
 *
 * Supports three modes:
 *  - `anthropic`: native Claude API
 *  - `openai`: native OpenAI API
 *  - `custom`: any OpenAI-compatible endpoint (doge-code feature)
 */
export function buildProvider(): AIProvider {
  const env = loadEnv();
  switch (env.DOGE_PROVIDER) {
    case 'anthropic': {
      const key = env.ANTHROPIC_API_KEY;
      if (!key) throw new Error('ANTHROPIC_API_KEY is required when DOGE_PROVIDER=anthropic');
      return new AnthropicProvider({ apiKey: key, baseURL: env.ANTHROPIC_BASE_URL });
    }
    case 'openai': {
      const key = env.OPENAI_API_KEY;
      if (!key) throw new Error('OPENAI_API_KEY is required when DOGE_PROVIDER=openai');
      return new OpenAIProvider({ apiKey: key, baseURL: env.OPENAI_BASE_URL, label: 'openai' });
    }
    case 'custom': {
      const key = env.DOGE_CUSTOM_API_KEY;
      const base = env.DOGE_CUSTOM_BASE_URL;
      if (!key || !base) {
        throw new Error(
          'DOGE_CUSTOM_API_KEY and DOGE_CUSTOM_BASE_URL are required when DOGE_PROVIDER=custom',
        );
      }
      return new OpenAIProvider({ apiKey: key, baseURL: base, label: 'custom' });
    }
  }
}

export function resolveDefaultModel(): string {
  const env = loadEnv();
  if (env.DOGE_PROVIDER === 'custom' && env.DOGE_CUSTOM_MODEL) return env.DOGE_CUSTOM_MODEL;
  return env.DOGE_MODEL;
}
