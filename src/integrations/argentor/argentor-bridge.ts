/**
 * Argentor bridge.
 *
 * Upstream: https://github.com/fboiero/Argentor — a Rust multi-agent
 * compliance / security framework that exposes an MCP interface. No npm
 * package; we integrate via HTTP (preferred) or stdio MCP (future).
 *
 * The bridge mirrors the style of `OpenFangBridge` so both integrations
 * are easy to enable / disable / reason about.
 */

import { logger } from '../../utils/logger.js';

export interface ArgentorOptions {
  readonly endpoint?: string;
  readonly apiKey?: string;
  readonly mcpStdio?: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

export interface ArgentorPolicyCheck {
  readonly allowed: boolean;
  readonly rationale: string;
  readonly riskScore?: number;
  readonly violations?: readonly string[];
}

export class ArgentorBridge {
  private readonly opts: ArgentorOptions;

  constructor(opts: ArgentorOptions = {}) {
    this.opts = opts;
  }

  isConfigured(): boolean {
    return typeof this.opts.endpoint === 'string' && this.opts.endpoint.length > 0;
  }

  /**
   * Ask Argentor whether an intended action is allowed under the
   * configured policy set. Returns `allowed: true` as a soft-fail when
   * the bridge is not configured, so callers can always call through.
   */
  async checkPolicy(action: string, context: Record<string, unknown>): Promise<ArgentorPolicyCheck> {
    if (!this.isConfigured()) {
      return { allowed: true, rationale: 'argentor-not-configured' };
    }
    try {
      const data = await this.request<{
        allowed?: boolean;
        rationale?: string;
        risk_score?: number;
        violations?: string[];
      }>('POST', '/policy/check', { action, context });
      return {
        allowed: data.allowed ?? false,
        rationale: data.rationale ?? 'argentor-no-rationale',
        riskScore: data.risk_score,
        violations: data.violations,
      };
    } catch (err) {
      const msg = stringifyError(err);
      logger.warn('argentor.check.error', { action, error: msg });
      return { allowed: false, rationale: msg };
    }
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const endpoint = (this.opts.endpoint ?? '').replace(/\/$/, '');
    const f = this.opts.fetchImpl ?? fetch;
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.opts.apiKey) headers['authorization'] = `Bearer ${this.opts.apiKey}`;
    const res = await f(`${endpoint}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: timeoutSignal(this.opts.timeoutMs ?? 30_000),
    });
    if (!res.ok) throw new Error(`argentor ${method} ${path} -> HTTP ${res.status}`);
    return (await res.json()) as T;
  }
}

function timeoutSignal(ms: number): AbortSignal | undefined {
  if (typeof AbortSignal === 'undefined' || typeof (AbortSignal as unknown as { timeout?: unknown }).timeout !== 'function') {
    return undefined;
  }
  return (AbortSignal as unknown as { timeout: (ms: number) => AbortSignal }).timeout(ms);
}

function stringifyError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
