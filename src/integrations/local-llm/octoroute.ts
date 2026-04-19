import { OpenAIProvider } from '../../api/openai-provider.js';
import type { AIProvider } from '../../api/provider-interface.js';
import { loadEnv } from '../../config/env-loader.js';
import { logger } from '../../utils/logger.js';

/**
 * Preset that routes model calls to a local OpenAI-compatible endpoint such
 * as {@link https://github.com/slb350/octoroute octoroute}, Ollama's native
 * OpenAI bridge, LM Studio, or llama.cpp's `llama-server`.
 *
 * octoroute listens on an OpenAI-compatible `/v1/chat/completions` endpoint
 * and load-balances across multiple local runtimes; we simply point our
 * existing {@link OpenAIProvider} at it. This file also implements a best
 * effort `/health` probe used by the router to temporarily drop the backend
 * when the local process is down.
 */

export interface OctorouteOptions {
  url?: string;
  apiKey?: string;
  model?: string;
}

export interface OctorouteHealth {
  ok: boolean;
  url: string | null;
  latencyMs: number | null;
  error?: string;
}

export function buildOctorouteProvider(opts: OctorouteOptions = {}): AIProvider | null {
  const env = loadEnv();
  const url = opts.url ?? env.OCTOROUTE_URL;
  if (!url) return null;
  const apiKey = opts.apiKey ?? env.OCTOROUTE_API_KEY ?? 'local';
  logger.info('octoroute.provider.ready', { url });
  return new OpenAIProvider({
    apiKey,
    baseURL: url.replace(/\/+$/, ''),
    label: 'octoroute',
  });
}

export function resolveOctorouteModel(opts: OctorouteOptions = {}): string {
  const env = loadEnv();
  return opts.model ?? env.OCTOROUTE_MODEL;
}

export async function probeOctorouteHealth(
  url: string | undefined = loadEnv().OCTOROUTE_URL,
  timeoutMs = 1_500,
): Promise<OctorouteHealth> {
  if (!url) return { ok: false, url: null, latencyMs: null, error: 'OCTOROUTE_URL not set' };
  const normalized = url.replace(/\/+$/, '');
  const healthEndpoints = [`${normalized}/health`, `${normalized}/v1/models`];
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    for (const endpoint of healthEndpoints) {
      try {
        const res = await fetch(endpoint, { signal: controller.signal });
        if (res.ok) {
          return { ok: true, url: endpoint, latencyMs: Date.now() - started };
        }
      } catch {
        /* try next */
      }
    }
    return {
      ok: false,
      url: normalized,
      latencyMs: Date.now() - started,
      error: 'no healthy endpoint',
    };
  } finally {
    clearTimeout(timer);
  }
}
