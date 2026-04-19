import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { AIProvider } from '../../api/provider-interface.js';
import { AnthropicProvider } from '../../api/anthropic-provider.js';
import { OpenAIProvider } from '../../api/openai-provider.js';
import { loadEnv } from '../../config/env-loader.js';
import { logger } from '../../utils/logger.js';
import { AIRouter, type RouterBackend, type RouterStrategy } from './ai-router.js';

/**
 * Declarative configuration for {@link AIRouter}.
 *
 * Resolved from (in priority):
 *   1. File at `DOGE_ROUTER_CONFIG` (if set and exists on disk).
 *   2. A JSON blob in `DOGE_ROUTER_CONFIG`.
 *   3. `DOGE_ROUTER_FALLBACK` — implicit single-provider failover built from
 *      existing Anthropic/OpenAI env vars.
 *
 * Example JSON:
 *   {
 *     "strategy": "failover",
 *     "providers": [
 *       { "type": "anthropic", "apiKey": "sk-ant-...", "model": "claude-3-5-sonnet-latest" },
 *       { "type": "openai", "apiKey": "sk-...", "model": "gpt-4o-mini" },
 *       { "type": "custom", "apiKey": "...", "baseUrl": "https://host/v1",
 *         "model": "llama3:70b", "name": "local-llama" }
 *     ]
 *   }
 */

const ProviderSpec = z.object({
  type: z.enum(['anthropic', 'openai', 'custom']),
  apiKey: z.string().optional(),
  baseUrl: z.string().url().optional(),
  model: z.string().optional(),
  name: z.string().optional(),
  weight: z.number().int().nonnegative().optional(),
});

const RouterConfigSchema = z.object({
  strategy: z
    .enum(['failover', 'round-robin', 'weighted', 'least-recent'])
    .optional(),
  maxAttempts: z.number().int().positive().optional(),
  providers: z.array(ProviderSpec).min(1),
});

export type RouterConfig = z.infer<typeof RouterConfigSchema>;

export function loadRouterConfig(): RouterConfig | null {
  const env = loadEnv();
  const raw = env.DOGE_ROUTER_CONFIG;
  if (!raw) return null;

  const resolved = raw.trim();
  const filePath = resolve(process.cwd(), resolved);
  let source: string;
  if (existsSync(filePath)) {
    source = readFileSync(filePath, 'utf8');
  } else if (resolved.startsWith('{')) {
    source = resolved;
  } else {
    logger.warn('router.config.not-found', { value: resolved });
    return null;
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(source);
  } catch (err) {
    logger.error('router.config.invalid-json', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }

  const parsed = RouterConfigSchema.safeParse(parsedJson);
  if (!parsed.success) {
    logger.error('router.config.schema-error', {
      issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    });
    return null;
  }
  return parsed.data;
}

export function buildRouterFromConfig(cfg: RouterConfig): AIRouter {
  const env = loadEnv();
  const backends: RouterBackend[] = cfg.providers.map((p, idx) => {
    const name = p.name ?? `${p.type}-${idx}`;
    const provider = buildProviderFromSpec(p);
    return {
      name,
      provider,
      weight: p.weight ?? 1,
      modelOverride: p.model,
    };
  });
  const strategy: RouterStrategy = cfg.strategy ?? env.DOGE_ROUTER_STRATEGY;
  return new AIRouter(backends, {
    strategy,
    maxAttemptsPerRequest: cfg.maxAttempts ?? backends.length,
  });
}

export function buildProviderFromSpec(p: z.infer<typeof ProviderSpec>): AIProvider {
  const env = loadEnv();
  switch (p.type) {
    case 'anthropic': {
      const apiKey = p.apiKey ?? env.ANTHROPIC_API_KEY;
      if (!apiKey) throw new Error(`Router backend 'anthropic' missing apiKey`);
      return new AnthropicProvider({
        apiKey,
        baseURL: p.baseUrl ?? env.ANTHROPIC_BASE_URL,
      });
    }
    case 'openai': {
      const apiKey = p.apiKey ?? env.OPENAI_API_KEY;
      if (!apiKey) throw new Error(`Router backend 'openai' missing apiKey`);
      return new OpenAIProvider({
        apiKey,
        baseURL: p.baseUrl ?? env.OPENAI_BASE_URL,
        label: p.name ?? 'openai',
      });
    }
    case 'custom': {
      const apiKey = p.apiKey ?? env.DOGE_CUSTOM_API_KEY;
      const baseURL = p.baseUrl ?? env.DOGE_CUSTOM_BASE_URL;
      if (!apiKey || !baseURL) {
        throw new Error(`Router backend 'custom' requires apiKey and baseUrl`);
      }
      return new OpenAIProvider({ apiKey, baseURL, label: p.name ?? 'custom' });
    }
  }
}
