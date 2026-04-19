import { loadEnv } from '../config/env-loader.js';
import { AnthropicProvider } from './anthropic-provider.js';
import { OpenAIProvider } from './openai-provider.js';
import type { AIProvider } from './provider-interface.js';
import { logger } from '../utils/logger.js';
import {
  buildRouterFromConfig,
  loadRouterConfig,
} from '../integrations/router/router-config.js';
import { AIRouter } from '../integrations/router/ai-router.js';
import { buildOctorouteProvider } from '../integrations/local-llm/octoroute.js';
import { setRestartProviderCallback } from '../tools/admin-tool.js';

/**
 * Provider factory.
 *
 * Modes:
 *  - `anthropic`: native Claude API
 *  - `openai`: native OpenAI API
 *  - `custom`: OpenAI-compatible endpoint (doge-code lineage)
 *  - `router`: multi-provider dispatch via {@link AIRouter}
 *  - `octoroute`: local OpenAI-compatible bridge for Ollama/LM Studio/llama.cpp
 *
 * Instances are cached across bootstrap calls so tool invocations share the
 * same keep-alive clients. The Admin tool can call {@link restartProvider} to
 * invalidate the cache after mutating `.env`, which triggers a fresh
 * resolution on next use.
 */

type ResolvedProvider = {
  provider: AIProvider;
  model: string;
};

let cached: ResolvedProvider | null = null;

export function restartProvider(): void {
  cached = null;
  logger.debug('provider.cache.reset');
}

setRestartProviderCallback(restartProvider);

export function buildProvider(): AIProvider {
  return resolveProvider().provider;
}

export function resolveDefaultModel(): string {
  return resolveProvider().model;
}

function resolveProvider(): ResolvedProvider {
  if (cached) return cached;
  const env = loadEnv();
  switch (env.DOGE_PROVIDER) {
    case 'anthropic': {
      const key = env.ANTHROPIC_API_KEY;
      if (!key) throw new Error('ANTHROPIC_API_KEY is required when DOGE_PROVIDER=anthropic');
      cached = {
        provider: new AnthropicProvider({ apiKey: key, baseURL: env.ANTHROPIC_BASE_URL }),
        model: env.DOGE_MODEL,
      };
      return cached;
    }
    case 'openai': {
      const key = env.OPENAI_API_KEY;
      if (!key) throw new Error('OPENAI_API_KEY is required when DOGE_PROVIDER=openai');
      cached = {
        provider: new OpenAIProvider({ apiKey: key, baseURL: env.OPENAI_BASE_URL, label: 'openai' }),
        model: env.DOGE_MODEL,
      };
      return cached;
    }
    case 'custom': {
      const key = env.DOGE_CUSTOM_API_KEY;
      const base = env.DOGE_CUSTOM_BASE_URL;
      if (!key || !base) {
        throw new Error(
          'DOGE_CUSTOM_API_KEY and DOGE_CUSTOM_BASE_URL are required when DOGE_PROVIDER=custom',
        );
      }
      cached = {
        provider: new OpenAIProvider({ apiKey: key, baseURL: base, label: 'custom' }),
        model: env.DOGE_CUSTOM_MODEL ?? env.DOGE_MODEL,
      };
      return cached;
    }
    case 'router': {
      const config = loadRouterConfig();
      if (!config) {
        throw new Error(
          'DOGE_ROUTER_CONFIG (JSON file path or inline JSON) is required when DOGE_PROVIDER=router',
        );
      }
      const router: AIRouter = buildRouterFromConfig(config);
      cached = { provider: router, model: env.DOGE_MODEL };
      logger.info('provider.router.ready', { backends: router.listBackends().length });
      return cached;
    }
    case 'octoroute': {
      const provider = buildOctorouteProvider();
      if (!provider) {
        throw new Error('OCTOROUTE_URL is required when DOGE_PROVIDER=octoroute');
      }
      cached = { provider, model: env.OCTOROUTE_MODEL };
      return cached;
    }
  }
}
