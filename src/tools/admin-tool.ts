import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { Tool, ToolContext, ToolResult } from './registry.js';
import { resetEnvCache, loadEnv } from '../config/env-loader.js';
import { logger } from '../utils/logger.js';

/**
 * In-conversation admin surface.
 *
 * Lets the agent (or user via the agent) flip providers, swap models,
 * toggle feature gates, record new API keys, and inspect current
 * configuration — all without restarting the process. Any state that
 * ends up in `.env` is persisted so that subsequent boots honour it.
 *
 * The tool is marked {@link Tool.dangerous} because it mutates
 * credentials and feature flags; PolicyEngine can be configured to
 * gate access.
 */

type RestartCallback = () => void | Promise<void>;

let restartProviderCallback: RestartCallback | null = null;

export function setRestartProviderCallback(cb: RestartCallback | null): void {
  restartProviderCallback = cb;
}

export const ADMIN_FEATURE_KEYS = [
  'DOGE_FEATURE_BUDDY',
  'DOGE_FEATURE_KAIROS',
  'DOGE_FEATURE_ULTRAPLAN',
  'DOGE_FEATURE_COORDINATOR',
  'DOGE_FEATURE_BRIDGE',
  'DOGE_FEATURE_ADMIN',
  'DOGE_FEATURE_BROWSER',
  'DOGE_FEATURE_MCP',
  'DOGE_FEATURE_MEM0',
  'DOGE_FEATURE_ROUTER',
  'DOGE_FEATURE_SOCIAL',
  'DOGE_FEATURE_OCTOROUTE',
] as const;

export type AdminAction =
  | 'switch_provider'
  | 'set_model'
  | 'toggle_feature'
  | 'add_api_key'
  | 'list_config';

export interface AdminInput {
  action: AdminAction;
  provider?: 'anthropic' | 'openai' | 'custom' | 'router' | 'octoroute';
  model?: string;
  feature?: string;
  value?: boolean | string;
  apiKey?: string;
  baseUrl?: string;
  keyName?: string;
}

const AdminSchema: z.ZodType<AdminInput> = z.object({
  action: z.enum([
    'switch_provider',
    'set_model',
    'toggle_feature',
    'add_api_key',
    'list_config',
  ]),
  provider: z.enum(['anthropic', 'openai', 'custom', 'router', 'octoroute']).optional(),
  model: z.string().min(1).optional(),
  feature: z.string().min(1).optional(),
  value: z.union([z.boolean(), z.string()]).optional(),
  apiKey: z.string().min(1).optional(),
  baseUrl: z.string().min(1).optional(),
  keyName: z.string().min(1).optional(),
});

export class AdminTool implements Tool<AdminInput> {
  readonly name = 'admin';
  readonly description =
    'Control ai-agent-os settings from the conversation: switch provider, set model, toggle features, add API keys, list config.';
  readonly schema: z.ZodType<AdminInput, z.ZodTypeDef, unknown> = AdminSchema;
  readonly jsonSchema = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['switch_provider', 'set_model', 'toggle_feature', 'add_api_key', 'list_config'],
        description: 'Which admin action to perform',
      },
      provider: {
        type: 'string',
        enum: ['anthropic', 'openai', 'custom', 'router', 'octoroute'],
        description: 'Provider selector for switch_provider',
      },
      model: { type: 'string', description: 'Model identifier for set_model' },
      feature: { type: 'string', description: 'Feature flag name (e.g. DOGE_FEATURE_BUDDY)' },
      value: {
        oneOf: [{ type: 'boolean' }, { type: 'string' }],
        description: 'Value for toggle_feature (boolean) or other freeform settings',
      },
      apiKey: { type: 'string', description: 'API key string for add_api_key' },
      baseUrl: { type: 'string', description: 'Base URL to set for a custom/OpenAI-compatible provider' },
      keyName: {
        type: 'string',
        description:
          'Specific env var name for add_api_key (e.g. OPENAI_API_KEY). If omitted, derived from provider.',
      },
    },
    required: ['action'],
    additionalProperties: false,
  } as const;
  readonly dangerous = true;

  async run(input: AdminInput, ctx: ToolContext): Promise<ToolResult> {
    const envPath = resolveEnvPath(ctx.workspace);
    try {
      const before = safeReadEnv(envPath);
      const { next, messages } = await this.applyAction(input, before);
      if (next !== before) {
        writeFileSync(envPath, next, 'utf8');
      }
      await this.refreshRuntime();
      return {
        ok: true,
        output: messages.join('\n'),
        data: { envPath, action: input.action },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('admin.action.error', { action: input.action, error: message });
      return { ok: false, output: '', error: `admin ${input.action} failed: ${message}` };
    }
  }

  private async applyAction(
    input: AdminInput,
    content: string,
  ): Promise<{ next: string; messages: string[] }> {
    switch (input.action) {
      case 'switch_provider': {
        if (!input.provider) throw new Error('provider is required for switch_provider');
        let next = upsertEnvVar(content, 'DOGE_PROVIDER', input.provider);
        const messages = [`DOGE_PROVIDER=${input.provider}`];
        if (input.provider === 'custom' || input.provider === 'octoroute') {
          if (input.baseUrl) {
            const key = input.provider === 'custom' ? 'DOGE_CUSTOM_BASE_URL' : 'OCTOROUTE_URL';
            next = upsertEnvVar(next, key, input.baseUrl);
            messages.push(`${key}=${input.baseUrl}`);
          }
        }
        if (input.apiKey) {
          const key = deriveKeyName(input.provider, input.keyName);
          next = upsertEnvVar(next, key, input.apiKey);
          messages.push(`${key}=<updated>`);
        }
        return { next, messages };
      }
      case 'set_model': {
        if (!input.model) throw new Error('model is required for set_model');
        const next = upsertEnvVar(content, 'DOGE_MODEL', input.model);
        return { next, messages: [`DOGE_MODEL=${input.model}`] };
      }
      case 'toggle_feature': {
        if (!input.feature) throw new Error('feature is required for toggle_feature');
        const flagName = normalizeFeatureKey(input.feature);
        const current = parseEnv(content)[flagName];
        const nextValue =
          typeof input.value === 'boolean'
            ? input.value
            : typeof input.value === 'string'
              ? input.value === 'true' || input.value === '1'
              : !(current === 'true' || current === '1');
        const next = upsertEnvVar(content, flagName, nextValue ? 'true' : 'false');
        return { next, messages: [`${flagName}=${nextValue}`] };
      }
      case 'add_api_key': {
        if (!input.apiKey) throw new Error('apiKey is required for add_api_key');
        const key = input.keyName ?? deriveKeyName(input.provider, input.keyName);
        const next = upsertEnvVar(content, key, input.apiKey);
        return { next, messages: [`${key}=<updated>`] };
      }
      case 'list_config': {
        const parsed = parseEnv(content);
        const redacted = redactSecrets(parsed);
        const lines = Object.entries(redacted).map(([k, v]) => `${k}=${v}`);
        if (lines.length === 0) lines.push('(no .env on disk; process env still applies)');
        return { next: content, messages: lines };
      }
      default: {
        const exhaustive: never = input.action;
        throw new Error(`unknown admin action: ${String(exhaustive)}`);
      }
    }
  }

  private async refreshRuntime(): Promise<void> {
    resetEnvCache();
    try {
      loadEnv({ force: true });
    } catch (err) {
      logger.warn('admin.env.reload.error', { error: String(err) });
    }
    if (restartProviderCallback) {
      try {
        await restartProviderCallback();
      } catch (err) {
        logger.warn('admin.provider.restart.error', { error: String(err) });
      }
    }
  }
}

function resolveEnvPath(workspace: string): string {
  return resolve(workspace, '..', '.env');
}

function safeReadEnv(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

function parseEnv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function upsertEnvVar(content: string, key: string, value: string): string {
  const serialized = /\s|#|"/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
  const line = `${key}=${serialized}`;
  const lines = content.split(/\r?\n/);
  let found = false;
  const rewritten = lines.map((raw) => {
    const trimmed = raw.trim();
    if (trimmed.startsWith('#') || !trimmed.includes('=')) return raw;
    const currentKey = trimmed.slice(0, trimmed.indexOf('=')).trim();
    if (currentKey === key) {
      found = true;
      return line;
    }
    return raw;
  });
  if (!found) {
    if (rewritten.length > 0 && rewritten[rewritten.length - 1] !== '') rewritten.push('');
    rewritten.push(line);
  }
  return rewritten.join('\n');
}

function normalizeFeatureKey(feature: string): string {
  const upper = feature.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  if (upper.startsWith('DOGE_')) return upper;
  if (upper.startsWith('FEATURE_')) return `DOGE_${upper}`;
  return `DOGE_FEATURE_${upper}`;
}

function deriveKeyName(
  provider: AdminInput['provider'],
  explicit: string | undefined,
): string {
  if (explicit) return explicit;
  switch (provider) {
    case 'anthropic':
      return 'ANTHROPIC_API_KEY';
    case 'openai':
      return 'OPENAI_API_KEY';
    case 'custom':
      return 'DOGE_CUSTOM_API_KEY';
    case 'octoroute':
      return 'OCTOROUTE_API_KEY';
    case 'router':
      return 'DOGE_ROUTER_CONFIG';
    default:
      return 'OPENAI_API_KEY';
  }
}

const SECRET_FRAGMENTS = ['KEY', 'TOKEN', 'SECRET', 'PASSWORD'];

function redactSecrets(env: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    const isSecret = SECRET_FRAGMENTS.some((f) => k.toUpperCase().includes(f));
    out[k] = isSecret && v ? `${v.slice(0, 4)}…(${v.length} chars)` : v;
  }
  return out;
}
