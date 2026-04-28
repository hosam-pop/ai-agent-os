/**
 * Thin HTTP client for Zep (https://github.com/getzep/zep) long-term memory.
 *
 * We target Zep Cloud's public REST endpoints (`/api/v2/memory`,
 * `/api/v2/sessions/{id}/memory`, `/api/v2/graph/search`) which are the
 * same endpoints the self-hosted Zep server exposes. As with the Letta
 * client, this module is deliberately minimal, soft-fails on HTTP errors,
 * and accepts an injected `fetchImpl` for offline tests.
 */

export interface ZepMessageInput {
  readonly role: 'user' | 'assistant' | 'system' | 'tool';
  readonly content: string;
  readonly roleType?: string;
}

export interface ZepMemoryRecord {
  readonly id: string;
  readonly sessionId: string;
  readonly text: string;
  readonly score?: number;
  readonly metadata?: Record<string, unknown>;
  readonly createdAt?: string;
}

export interface ZepClientOptions {
  readonly baseUrl?: string;
  readonly token?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

export interface ZepAddResult {
  readonly ok: boolean;
  readonly error?: string;
}

export interface ZepSearchResult {
  readonly ok: boolean;
  readonly records: ZepMemoryRecord[];
  readonly error?: string;
}

export class ZepClient {
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ZepClientOptions = {}) {
    this.baseUrl = trimSlash(options.baseUrl ?? 'https://api.getzep.com');
    this.token = options.token;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async addMemory(sessionId: string, messages: readonly ZepMessageInput[]): Promise<ZepAddResult> {
    if (!sessionId) return { ok: false, error: 'sessionId is required' };
    if (messages.length === 0) return { ok: true };
    const res = await this.request(
      `/api/v2/sessions/${encodeURIComponent(sessionId)}/memory`,
      { method: 'POST', body: JSON.stringify({ messages: messages.map(serialiseMessage) }) },
    );
    return res.ok ? { ok: true } : { ok: false, error: res.error };
  }

  async searchMemory(sessionId: string, query: string, limit = 10): Promise<ZepSearchResult> {
    if (!sessionId) return { ok: false, records: [], error: 'sessionId is required' };
    const res = await this.request<{ results?: Array<Record<string, unknown>> }>(
      `/api/v2/sessions/${encodeURIComponent(sessionId)}/memory/search`,
      { method: 'POST', body: JSON.stringify({ text: query, limit }) },
    );
    if (!res.ok || !res.data) return { ok: false, records: [], error: res.error };
    const rows = res.data.results ?? [];
    return { ok: true, records: rows.map((r) => parseZepRow(sessionId, r)) };
  }

  async getMemory(sessionId: string): Promise<ZepSearchResult> {
    if (!sessionId) return { ok: false, records: [], error: 'sessionId is required' };
    const res = await this.request<{ messages?: Array<Record<string, unknown>> }>(
      `/api/v2/sessions/${encodeURIComponent(sessionId)}/memory`,
      { method: 'GET' },
    );
    if (!res.ok || !res.data) return { ok: false, records: [], error: res.error };
    const rows = res.data.messages ?? [];
    return { ok: true, records: rows.map((r) => parseZepRow(sessionId, r)) };
  }

  private async request<T = unknown>(
    path: string,
    init: RequestInit,
  ): Promise<{ ok: boolean; data?: T; error?: string }> {
    const url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json',
      ...(init.headers as Record<string, string> | undefined),
    };
    if (this.token) headers.authorization = `Api-Key ${this.token}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(url, { ...init, headers, signal: controller.signal });
      if (!res.ok) {
        const body = await safeText(res);
        return { ok: false, error: `zep ${res.status}: ${body.slice(0, 240)}` };
      }
      const data = (await res.json().catch(() => ({}))) as T;
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      clearTimeout(timer);
    }
  }
}

function serialiseMessage(message: ZepMessageInput): Record<string, unknown> {
  return {
    role: message.role,
    role_type: message.roleType ?? message.role,
    content: message.content,
  };
}

export function parseZepRow(sessionId: string, raw: Record<string, unknown>): ZepMemoryRecord {
  const text =
    typeof raw.content === 'string'
      ? (raw.content as string)
      : typeof raw.message === 'string'
        ? (raw.message as string)
        : '';
  const metadata = (raw.metadata as Record<string, unknown> | undefined) ?? undefined;
  return {
    id: typeof raw.uuid === 'string' ? (raw.uuid as string) : typeof raw.id === 'string' ? (raw.id as string) : `zep-${Date.now().toString(36)}`,
    sessionId,
    text,
    score: typeof raw.score === 'number' ? raw.score : undefined,
    metadata,
    createdAt: typeof raw.created_at === 'string' ? (raw.created_at as string) : undefined,
  };
}

function trimSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}
