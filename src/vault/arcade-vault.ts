/**
 * ArcadeVault — credential vault + tool executor built on `@arcadeai/arcadejs`.
 *
 * Design goals:
 *  - The LLM never sees raw API keys. It only sees `{ ok, output }`.
 *  - Every tool invocation is scoped to a `userId`, so Arcade can inject
 *    per-user OAuth credentials.
 *  - The vault is fully optional: when `ARCADE_API_KEY` is absent, all
 *    methods short-circuit with a structured "not configured" error
 *    instead of throwing.
 *
 * The Arcade SDK is loaded via dynamic import, mirroring the pattern used
 * by `ComposioGateway`.
 */

import { logger } from '../utils/logger.js';

export interface ArcadeVaultOptions {
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly defaultUserId?: string;
  readonly loader?: () => Promise<unknown>;
  /**
   * Subset of tool names this vault should exclusively handle. When the
   * registry is asked to invoke one of these it will route the call
   * through {@link ArcadeVault.executeTool} instead of a local tool
   * implementation. Leave empty to keep the vault in "optional helper"
   * mode.
   */
  readonly claimedTools?: readonly string[];
}

export interface ArcadeExecuteResult {
  readonly ok: boolean;
  readonly output: string;
  readonly data?: unknown;
  readonly error?: string;
}

type ArcadeClient = {
  tools?: {
    execute?: (params: unknown) => Promise<unknown>;
    authorize?: (params: unknown) => Promise<unknown>;
  };
};

export class ArcadeVault {
  private readonly opts: ArcadeVaultOptions;
  private clientPromise: Promise<ArcadeClient | null> | null = null;

  constructor(opts: ArcadeVaultOptions = {}) {
    this.opts = opts;
  }

  isConfigured(): boolean {
    return typeof this.opts.apiKey === 'string' && this.opts.apiKey.length > 0;
  }

  /**
   * RegistryPolicy contract: returns true when the registry should skip
   * its local {@link Tool.run} and route the call through this vault.
   */
  handles(toolName: string): boolean {
    return (this.opts.claimedTools ?? []).includes(toolName);
  }

  /**
   * Execute an Arcade-registered tool on behalf of `userId`. The vault
   * sanitizes logs so API keys never leak into our structured log stream.
   */
  async executeTool(userId: string | undefined, toolName: string, input: unknown): Promise<ArcadeExecuteResult> {
    const client = await this.client();
    if (!client || !client.tools?.execute) {
      return { ok: false, output: '', error: 'arcade-not-configured' };
    }
    const resolvedUserId = userId ?? this.opts.defaultUserId ?? 'default';
    try {
      const raw = await client.tools.execute({
        tool_name: toolName,
        input: input ?? {},
        user_id: resolvedUserId,
      });
      logger.info('arcade.execute.ok', { toolName, userId: resolvedUserId });
      return normalizeExecuteResult(raw);
    } catch (err) {
      const redacted = redactSecrets(stringifyError(err));
      logger.warn('arcade.execute.error', { toolName, error: redacted });
      return { ok: false, output: '', error: redacted };
    }
  }

  /**
   * Request an OAuth / API-key authorization URL for `userId`. Useful when
   * the agent needs to prompt the human to connect a new service mid-run.
   */
  async authorize(userId: string | undefined, toolName: string): Promise<string | null> {
    const client = await this.client();
    if (!client || !client.tools?.authorize) return null;
    const resolvedUserId = userId ?? this.opts.defaultUserId ?? 'default';
    try {
      const raw = await client.tools.authorize({ tool_name: toolName, user_id: resolvedUserId });
      if (isRecord(raw) && typeof raw['url'] === 'string') return raw['url'];
      return null;
    } catch (err) {
      logger.warn('arcade.authorize.error', { toolName, error: redactSecrets(stringifyError(err)) });
      return null;
    }
  }

  private async client(): Promise<ArcadeClient | null> {
    if (!this.isConfigured()) return null;
    if (!this.clientPromise) {
      this.clientPromise = this.buildClient();
    }
    return this.clientPromise;
  }

  private async buildClient(): Promise<ArcadeClient | null> {
    const loader = this.opts.loader ?? (() => import('@arcadeai/arcadejs'));
    try {
      const mod = (await loader()) as { Arcade?: new (opts: unknown) => ArcadeClient };
      const Ctor = mod.Arcade;
      if (typeof Ctor !== 'function') return null;
      return new Ctor({ apiKey: this.opts.apiKey, baseURL: this.opts.baseUrl });
    } catch (err) {
      logger.warn('arcade.loader.error', { error: stringifyError(err) });
      return null;
    }
  }
}

function normalizeExecuteResult(raw: unknown): ArcadeExecuteResult {
  if (!isRecord(raw)) return { ok: false, output: '', error: 'arcade-bad-response' };
  const output =
    typeof raw['output'] === 'string'
      ? raw['output']
      : raw['output'] !== undefined
        ? JSON.stringify(raw['output'])
        : raw['value'] !== undefined
          ? JSON.stringify(raw['value'])
          : '';
  const status = raw['status'];
  const errorStatus = raw['error'];
  const ok = status === 'completed' || status === 'success' || (errorStatus === undefined && output !== '');
  return {
    ok,
    output: redactSecrets(output),
    data: raw['output'] ?? raw['value'],
    error: typeof errorStatus === 'string' ? errorStatus : undefined,
  };
}

/**
 * Best-effort scrubbing of anything that looks like an API key or bearer
 * token. The vault is an authority on "never leak credentials", so we
 * apply the filter both to happy-path outputs and to error strings.
 */
export function redactSecrets(value: string): string {
  return value
    .replace(/(api[_-]?key\s*[:=]\s*)['"]?[A-Za-z0-9_\-]{12,}['"]?/gi, '$1***')
    .replace(/(bearer\s+)[A-Za-z0-9._\-]{12,}/gi, '$1***')
    .replace(/(authorization[:=]\s*)[^\s,}]{12,}/gi, '$1***')
    .replace(/sk-[A-Za-z0-9]{12,}/g, 'sk-***')
    .replace(/kv_[A-Za-z0-9]{12,}/g, 'kv_***');
}

function stringifyError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}
