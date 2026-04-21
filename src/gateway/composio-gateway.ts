/**
 * ComposioGateway — thin wrapper over the `@composio/core` SDK.
 *
 * Goal: provide a single, uniform surface the agent can use to (a) list
 * third-party tools available in the user's Composio workspace, (b) execute
 * a Composio tool on behalf of a specific user without the LLM ever seeing
 * the underlying API key, and (c) answer a "discovery" question for a
 * new `ToolDiscoveryNode` that lives in `StateGraph`.
 *
 * The SDK is loaded via dynamic import so that a missing
 * `COMPOSIO_API_KEY` / missing package simply disables the gateway instead
 * of crashing at startup. Nothing in `ai-agent-os` is required to use
 * Composio — this class is additive.
 */

import { logger } from '../utils/logger.js';

export interface ComposioGatewayOptions {
  /** Composio API key. When absent the gateway runs in "stub" mode. */
  readonly apiKey?: string;
  /** Base URL override (for self-hosted Composio deployments). */
  readonly baseUrl?: string;
  /** Default Composio userId used when the agent call does not supply one. */
  readonly defaultUserId?: string;
  /**
   * Optional loader for `@composio/core`. Tests inject a stub so the
   * gateway can be exercised without hitting the real SDK.
   */
  readonly loader?: () => Promise<unknown>;
}

export interface ComposioToolInfo {
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly toolkit?: string;
}

export interface ComposioExecuteResult {
  readonly ok: boolean;
  readonly output: string;
  readonly data?: unknown;
  readonly error?: string;
}

export interface BetterToolSuggestion {
  readonly candidate: ComposioToolInfo;
  readonly reason: string;
  readonly score: number;
}

type ComposioClient = {
  tools?: {
    list?: (params?: unknown) => Promise<unknown>;
    execute?: (slug: string, params: unknown) => Promise<unknown>;
  };
};

export class ComposioGateway {
  private readonly opts: ComposioGatewayOptions;
  private clientPromise: Promise<ComposioClient | null> | null = null;

  constructor(opts: ComposioGatewayOptions = {}) {
    this.opts = opts;
  }

  /** True when the gateway has enough configuration to make real calls. */
  isConfigured(): boolean {
    return typeof this.opts.apiKey === 'string' && this.opts.apiKey.length > 0;
  }

  async listTools(filter?: { toolkit?: string; query?: string }): Promise<ComposioToolInfo[]> {
    const client = await this.client();
    if (!client || !client.tools?.list) return [];
    try {
      const raw = await client.tools.list(filter ?? {});
      return normalizeToolList(raw);
    } catch (err) {
      logger.warn('composio.list.error', { error: stringifyError(err) });
      return [];
    }
  }

  /**
   * Execute a Composio tool on behalf of `userId`. Returns a normalized
   * result so the agent loop never has to branch on SDK versions.
   */
  async executeTool(
    userId: string | undefined,
    toolSlug: string,
    input: unknown,
  ): Promise<ComposioExecuteResult> {
    const client = await this.client();
    if (!client || !client.tools?.execute) {
      return { ok: false, output: '', error: 'composio-not-configured' };
    }
    const resolvedUserId = userId ?? this.opts.defaultUserId ?? 'default';
    try {
      const raw = await client.tools.execute(toolSlug, {
        arguments: input,
        userId: resolvedUserId,
      });
      return normalizeExecuteResult(raw);
    } catch (err) {
      const message = stringifyError(err);
      logger.warn('composio.execute.error', { toolSlug, error: message });
      return { ok: false, output: '', error: message };
    }
  }

  /**
   * `ToolDiscoveryNode` asks: "for intent X, is there a Composio tool we
   * should use instead of the pre-planned local tool?". Matching is purely
   * lexical — the real "intent awareness" lives in the planner.
   */
  async suggestBetterTool(
    intent: string,
    plannedToolName: string,
  ): Promise<BetterToolSuggestion | null> {
    const tokens = tokenize(intent).concat(tokenize(plannedToolName));
    if (tokens.length === 0) return null;
    const candidates = await this.listTools();
    let best: BetterToolSuggestion | null = null;
    for (const candidate of candidates) {
      const score = scoreCandidate(candidate, tokens);
      if (score <= 0) continue;
      if (!best || score > best.score) {
        best = { candidate, score, reason: `matches ${score} intent keyword(s)` };
      }
    }
    return best;
  }

  private async client(): Promise<ComposioClient | null> {
    if (!this.isConfigured()) return null;
    if (!this.clientPromise) {
      this.clientPromise = this.buildClient();
    }
    return this.clientPromise;
  }

  private async buildClient(): Promise<ComposioClient | null> {
    const loader = this.opts.loader ?? (() => import('@composio/core'));
    try {
      const mod = (await loader()) as { Composio?: new (opts: unknown) => ComposioClient };
      const Ctor = mod.Composio;
      if (typeof Ctor !== 'function') return null;
      return new Ctor({ apiKey: this.opts.apiKey, baseUrl: this.opts.baseUrl });
    } catch (err) {
      logger.warn('composio.loader.error', { error: stringifyError(err) });
      return null;
    }
  }
}

function stringifyError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((t) => t.length >= 3);
}

function scoreCandidate(candidate: ComposioToolInfo, tokens: string[]): number {
  const haystack = `${candidate.slug} ${candidate.name} ${candidate.description}`.toLowerCase();
  return tokens.reduce((acc, token) => (haystack.includes(token) ? acc + 1 : acc), 0);
}

function normalizeToolList(raw: unknown): ComposioToolInfo[] {
  const items: ComposioToolInfo[] = [];
  const candidates = Array.isArray(raw)
    ? raw
    : isRecord(raw) && Array.isArray(raw['items'])
      ? (raw['items'] as unknown[])
      : [];
  for (const entry of candidates) {
    if (!isRecord(entry)) continue;
    const slug = firstString(entry, ['slug', 'name', 'tool_slug']);
    if (!slug) continue;
    items.push({
      slug,
      name: firstString(entry, ['display_name', 'name']) ?? slug,
      description: firstString(entry, ['description', 'summary']) ?? '',
      toolkit: firstString(entry, ['toolkit', 'app']),
    });
  }
  return items;
}

function normalizeExecuteResult(raw: unknown): ComposioExecuteResult {
  if (!isRecord(raw)) {
    return { ok: false, output: '', error: 'composio-bad-response' };
  }
  const ok = raw['successful'] === true || raw['successful'] === undefined;
  const dataField = raw['data'];
  const outputString =
    firstString(raw, ['output', 'message']) ?? (dataField !== undefined ? JSON.stringify(dataField) : '');
  const error = firstString(raw, ['error', 'error_message']);
  return {
    ok,
    output: outputString,
    data: dataField,
    error,
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function firstString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}
