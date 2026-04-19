/**
 * Vigil (https://github.com/deadbits/vigil-llm) is a defensive scanner for
 * LLM prompt injection, jailbreaks, and PII leakage. It exposes a local HTTP
 * API — we never ship Vigil, we only talk to a service the operator runs.
 *
 * This module provides a pure parser for Vigil's scan response alongside a
 * thin HTTP client. Runners soft-fail (return a summary with an `errors`
 * array) whenever the service is unreachable or misconfigured, in keeping
 * with the rest of `src/security/`.
 */

export type VigilVerdict = 'clean' | 'suspicious' | 'malicious';

export interface VigilMatch {
  /** Which scanner flagged it (e.g. 'transformer', 'yara', 'similarity'). */
  readonly scanner: string;
  /** Rule / model / canary identifier, when available. */
  readonly rule?: string;
  /** Confidence score 0..1 if the scanner reports one. */
  readonly score?: number;
  /** Short human-readable description of the finding. */
  readonly message: string;
  /** Optional metadata from the upstream scanner. */
  readonly metadata?: Record<string, unknown>;
}

export interface VigilScanSummary {
  readonly verdict: VigilVerdict;
  readonly matches: VigilMatch[];
  readonly total: number;
  readonly byScanner: Record<string, number>;
  readonly latencyMs?: number;
  readonly errors: string[];
}

export interface VigilClientOptions {
  /** Base URL of the running Vigil service (default `http://localhost:5000`). */
  baseUrl?: string;
  /** Optional bearer token if the deployment enforces one. */
  token?: string;
  /** Millisecond request timeout (default 15_000). */
  timeoutMs?: number;
  /** Override for tests / custom clients. */
  fetchImpl?: typeof fetch;
}

export interface VigilScanRequest {
  /** Input text to scan (user prompt, tool output, etc.). */
  readonly prompt: string;
  /** Which scanners to enable; Vigil defaults apply when omitted. */
  readonly scanners?: string[];
}

/**
 * Parse a Vigil `/analyze/prompt` response into a normalised summary. Pure
 * function: never throws, never touches the network, tolerates partial
 * shapes and unexpected keys.
 */
export function parseVigilResponse(raw: unknown): VigilScanSummary {
  if (!raw || typeof raw !== 'object') {
    return emptySummary(['vigil returned a non-object response']);
  }

  const body = raw as Record<string, unknown>;
  const errors: string[] = [];

  const rawResults = body.results;
  const matches: VigilMatch[] = [];

  if (Array.isArray(rawResults)) {
    for (const entry of rawResults) {
      if (!entry || typeof entry !== 'object') continue;
      const e = entry as Record<string, unknown>;
      const scanner = typeof e.scanner === 'string' ? e.scanner : typeof e.type === 'string' ? e.type : 'unknown';
      matches.push({
        scanner,
        rule: typeof e.rule === 'string' ? e.rule : typeof e.matchString === 'string' ? e.matchString : undefined,
        score: typeof e.score === 'number' ? e.score : undefined,
        message:
          typeof e.message === 'string'
            ? e.message
            : typeof e.description === 'string'
              ? e.description
              : `match from ${scanner}`,
        metadata:
          typeof e.metadata === 'object' && e.metadata !== null ? (e.metadata as Record<string, unknown>) : undefined,
      });
    }
  } else if (rawResults && typeof rawResults === 'object') {
    // Older Vigil builds key results by scanner name instead of an array.
    for (const [scanner, payload] of Object.entries(rawResults as Record<string, unknown>)) {
      if (!payload || typeof payload !== 'object') continue;
      const p = payload as Record<string, unknown>;
      const nested = Array.isArray(p.matches) ? p.matches : [];
      for (const m of nested) {
        if (!m || typeof m !== 'object') continue;
        const mm = m as Record<string, unknown>;
        matches.push({
          scanner,
          rule: typeof mm.rule === 'string' ? mm.rule : undefined,
          score: typeof mm.score === 'number' ? mm.score : undefined,
          message:
            typeof mm.message === 'string'
              ? mm.message
              : typeof mm.description === 'string'
                ? mm.description
                : `${scanner} match`,
          metadata: typeof mm.metadata === 'object' && mm.metadata !== null
            ? (mm.metadata as Record<string, unknown>)
            : undefined,
        });
      }
    }
  }

  const apiErrors = body.errors;
  if (Array.isArray(apiErrors)) {
    for (const e of apiErrors) {
      if (typeof e === 'string') errors.push(e);
      else if (e && typeof e === 'object' && 'message' in e && typeof (e as { message: unknown }).message === 'string') {
        errors.push(String((e as { message: string }).message));
      }
    }
  }

  const verdict = deriveVerdict(body, matches);
  const latency = typeof body.latency === 'number' ? body.latency : undefined;

  const byScanner: Record<string, number> = {};
  for (const m of matches) {
    byScanner[m.scanner] = (byScanner[m.scanner] ?? 0) + 1;
  }

  return {
    verdict,
    matches,
    total: matches.length,
    byScanner,
    latencyMs: latency,
    errors,
  };
}

function deriveVerdict(body: Record<string, unknown>, matches: VigilMatch[]): VigilVerdict {
  const raw = typeof body.verdict === 'string' ? body.verdict.toLowerCase() : undefined;
  if (raw === 'malicious' || raw === 'block' || raw === 'flagged') return 'malicious';
  if (raw === 'suspicious' || raw === 'warn') return 'suspicious';
  if (raw === 'clean' || raw === 'ok' || raw === 'pass') return 'clean';
  if (matches.length === 0) return 'clean';
  const hi = matches.some((m) => (m.score ?? 0) >= 0.85);
  return hi ? 'malicious' : 'suspicious';
}

function emptySummary(errors: string[]): VigilScanSummary {
  return { verdict: 'clean', matches: [], total: 0, byScanner: {}, errors };
}

export class VigilClient {
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: VigilClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? 'http://localhost:5000').replace(/\/$/, '');
    this.token = opts.token;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  }

  async scan(req: VigilScanRequest): Promise<VigilScanSummary> {
    if (!req.prompt || typeof req.prompt !== 'string') {
      return emptySummary(['vigil: prompt is required']);
    }
    if (typeof this.fetchImpl !== 'function') {
      return emptySummary(['vigil: global fetch is unavailable (Node 18+ required)']);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/analyze/prompt`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        },
        body: JSON.stringify({ prompt: req.prompt, scanners: req.scanners }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const text = await safeText(response);
        return emptySummary([`vigil: HTTP ${response.status} ${response.statusText} ${text}`.trim()]);
      }
      const json = (await response.json()) as unknown;
      return parseVigilResponse(json);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return emptySummary([`vigil: ${message}`]);
    } finally {
      clearTimeout(timer);
    }
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    const t = await response.text();
    return t.length > 200 ? `${t.slice(0, 200)}…` : t;
  } catch {
    return '';
  }
}
