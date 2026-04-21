/**
 * OpenFang bridge.
 *
 * Upstream: https://github.com/RightNow-AI/openfang — an Agent Operating
 * System written in Rust that ships a single 32 MB binary exposing an
 * HTTP API on http://localhost:4200 and speaks MCP on stdio / HTTP.
 *
 * This file is a thin bridge, not an SDK. OpenFang has no npm package,
 * so we talk to it over HTTP and keep everything behind
 * `ENABLE_OPENFANG`. When the flag is off, nothing loads — tests and
 * production deployments that do not run OpenFang pay zero cost.
 *
 * The adapter deliberately mirrors the shape of our existing
 * `CodeqlMcpAdapter` / `VigilAdapter` so reviewers only need to learn
 * one style of HTTP integration in this repo.
 */

import { logger } from '../../utils/logger.js';

export interface OpenFangOptions {
  /**
   * Base URL of the running OpenFang binary. Typically
   * `http://localhost:4200` after `openfang start`.
   */
  readonly endpoint?: string;
  readonly apiKey?: string;
  readonly fetchImpl?: typeof fetch;
  /**
   * Stdio command to launch OpenFang's MCP server. Reserved for future
   * MCP-over-stdio support; not used by the HTTP path.
   */
  readonly mcpStdio?: string;
  readonly timeoutMs?: number;
}

export interface OpenFangHand {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly schedule?: string;
}

export interface OpenFangRunResult {
  readonly ok: boolean;
  readonly runId?: string;
  readonly output?: unknown;
  readonly error?: string;
}

export class OpenFangBridge {
  private readonly opts: OpenFangOptions;

  constructor(opts: OpenFangOptions = {}) {
    this.opts = opts;
  }

  isConfigured(): boolean {
    return typeof this.opts.endpoint === 'string' && this.opts.endpoint.length > 0;
  }

  /** List the "Hands" (named autonomous capability packages) the binary exposes. */
  async listHands(): Promise<OpenFangHand[]> {
    if (!this.isConfigured()) return [];
    try {
      const data = await this.request<{ hands?: OpenFangHand[] }>('GET', '/api/hands');
      return data.hands ?? [];
    } catch (err) {
      logger.warn('openfang.list.error', { error: stringifyError(err) });
      return [];
    }
  }

  /** Trigger a named Hand and stream back the terminal result. */
  async runHand(handId: string, input: unknown): Promise<OpenFangRunResult> {
    if (!this.isConfigured()) {
      return { ok: false, error: 'openfang-not-configured' };
    }
    try {
      const data = await this.request<{ run_id?: string; output?: unknown; error?: string }>(
        'POST',
        `/api/hands/${encodeURIComponent(handId)}/run`,
        input,
      );
      if (data.error) return { ok: false, error: data.error, runId: data.run_id };
      return { ok: true, runId: data.run_id, output: data.output };
    } catch (err) {
      const msg = stringifyError(err);
      logger.warn('openfang.run.error', { handId, error: msg });
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
    if (!res.ok) throw new Error(`openfang ${method} ${path} -> HTTP ${res.status}`);
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
