/**
 * Qualixar bridge.
 *
 * The upstream `varunpratap/Qualixar-OS` path in the task brief does
 * not resolve. The real Qualixar project is the organisation at
 * https://github.com/qualixar with the flagship "SLM MCP Hub"
 * (https://github.com/qualixar/slm-mcp-hub) — an MCP gateway that
 * federates multiple MCP servers behind one HTTP endpoint. That is
 * what this adapter speaks to.
 *
 * Integration strategy: pure HTTP. No npm package. Everything is
 * behind `ENABLE_QUALIXAR` and soft-fails when the endpoint is
 * missing.
 */

import { logger } from '../../utils/logger.js';

export interface QualixarOptions {
  readonly endpoint?: string;
  readonly apiKey?: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

export interface QualixarTool {
  readonly name: string;
  readonly server: string;
  readonly description?: string;
}

export interface QualixarInvocationResult {
  readonly ok: boolean;
  readonly output?: unknown;
  readonly error?: string;
}

export class QualixarBridge {
  private readonly opts: QualixarOptions;

  constructor(opts: QualixarOptions = {}) {
    this.opts = opts;
  }

  isConfigured(): boolean {
    return typeof this.opts.endpoint === 'string' && this.opts.endpoint.length > 0;
  }

  async listTools(): Promise<QualixarTool[]> {
    if (!this.isConfigured()) return [];
    try {
      const data = await this.request<{ tools?: QualixarTool[] }>('GET', '/tools');
      return data.tools ?? [];
    } catch (err) {
      logger.warn('qualixar.list.error', { error: stringifyError(err) });
      return [];
    }
  }

  async invoke(name: string, input: unknown): Promise<QualixarInvocationResult> {
    if (!this.isConfigured()) {
      return { ok: false, error: 'qualixar-not-configured' };
    }
    try {
      const data = await this.request<{ output?: unknown; error?: string }>(
        'POST',
        `/tools/${encodeURIComponent(name)}/invoke`,
        input,
      );
      if (data.error) return { ok: false, error: data.error };
      return { ok: true, output: data.output };
    } catch (err) {
      const msg = stringifyError(err);
      logger.warn('qualixar.invoke.error', { name, error: msg });
      return { ok: false, error: msg };
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
    if (!res.ok) throw new Error(`qualixar ${method} ${path} -> HTTP ${res.status}`);
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
