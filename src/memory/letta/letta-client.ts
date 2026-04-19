/**
 * Thin HTTP client for Letta (https://github.com/letta-ai/letta) — the
 * stateful-memory service formerly known as MemGPT. We target the public
 * REST API (`/v1/agents/{id}/messages`, `/v1/agents/{id}/memory`,
 * `/v1/agents/{id}/archival-memory`) rather than vendoring the Python SDK.
 *
 * The client is intentionally minimal: it speaks the endpoints the
 * {@link LettaMemory} adapter needs, uses an injected `fetchImpl` so tests
 * never touch the network, and soft-fails by returning `{ errors: [...] }`
 * rather than throwing when the service is unreachable.
 */

export interface LettaMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant' | 'system' | 'tool';
  readonly text: string;
  readonly createdAt?: string;
}

export interface LettaArchivalRecord {
  readonly id: string;
  readonly text: string;
  readonly metadata?: Record<string, unknown>;
  readonly createdAt?: string;
  readonly score?: number;
}

export interface LettaCoreMemory {
  readonly human: string;
  readonly persona: string;
}

export interface LettaClientOptions {
  /** Base URL of the Letta server (e.g. `https://app.letta.com` or a self-hosted deployment). */
  readonly baseUrl?: string;
  /** API token for `Authorization: Bearer`. */
  readonly token?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

export interface LettaAppendMessageResult {
  readonly ok: boolean;
  readonly message?: LettaMessage;
  readonly error?: string;
}

export interface LettaArchivalSearchResult {
  readonly ok: boolean;
  readonly records: LettaArchivalRecord[];
  readonly error?: string;
}

export interface LettaAppendArchivalResult {
  readonly ok: boolean;
  readonly record?: LettaArchivalRecord;
  readonly error?: string;
}

export class LettaClient {
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: LettaClientOptions = {}) {
    this.baseUrl = trimSlash(options.baseUrl ?? 'https://app.letta.com');
    this.token = options.token;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async appendMessage(agentId: string, text: string, role: LettaMessage['role'] = 'user'): Promise<LettaAppendMessageResult> {
    if (!agentId) return { ok: false, error: 'agentId is required' };
    const body = { messages: [{ role, text }] };
    const res = await this.request<{ messages?: Array<Partial<LettaMessage>> }>(
      `/v1/agents/${encodeURIComponent(agentId)}/messages`,
      { method: 'POST', body: JSON.stringify(body) },
    );
    if (!res.ok || !res.data) return { ok: false, error: res.error };
    const raw = res.data.messages?.[0];
    if (!raw || typeof raw.id !== 'string') return { ok: true };
    return {
      ok: true,
      message: {
        id: raw.id,
        role: (raw.role ?? role) as LettaMessage['role'],
        text: typeof raw.text === 'string' ? raw.text : text,
        createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : undefined,
      },
    };
  }

  async appendArchival(agentId: string, text: string, metadata?: Record<string, unknown>): Promise<LettaAppendArchivalResult> {
    if (!agentId) return { ok: false, error: 'agentId is required' };
    const res = await this.request<{ id?: string; text?: string; metadata?: Record<string, unknown>; created_at?: string }>(
      `/v1/agents/${encodeURIComponent(agentId)}/archival-memory`,
      { method: 'POST', body: JSON.stringify({ text, metadata }) },
    );
    if (!res.ok || !res.data) return { ok: false, error: res.error };
    return {
      ok: true,
      record: {
        id: typeof res.data.id === 'string' ? res.data.id : `letta-${Date.now().toString(36)}`,
        text: typeof res.data.text === 'string' ? res.data.text : text,
        metadata: (res.data.metadata as Record<string, unknown> | undefined) ?? metadata,
        createdAt: typeof res.data.created_at === 'string' ? res.data.created_at : undefined,
      },
    };
  }

  async searchArchival(agentId: string, query: string, limit = 10): Promise<LettaArchivalSearchResult> {
    if (!agentId) return { ok: false, records: [], error: 'agentId is required' };
    const params = new URLSearchParams({ query, limit: String(limit) });
    const res = await this.request<{ results?: Array<Record<string, unknown>> }>(
      `/v1/agents/${encodeURIComponent(agentId)}/archival-memory/search?${params.toString()}`,
      { method: 'GET' },
    );
    if (!res.ok || !res.data) return { ok: false, records: [], error: res.error };
    const rows = res.data.results ?? [];
    return { ok: true, records: rows.map(parseArchivalRow) };
  }

  async getCoreMemory(agentId: string): Promise<{ ok: boolean; memory?: LettaCoreMemory; error?: string }> {
    if (!agentId) return { ok: false, error: 'agentId is required' };
    const res = await this.request<{ human?: string; persona?: string }>(
      `/v1/agents/${encodeURIComponent(agentId)}/memory`,
      { method: 'GET' },
    );
    if (!res.ok || !res.data) return { ok: false, error: res.error };
    return {
      ok: true,
      memory: {
        human: typeof res.data.human === 'string' ? res.data.human : '',
        persona: typeof res.data.persona === 'string' ? res.data.persona : '',
      },
    };
  }

  private async request<T>(path: string, init: RequestInit): Promise<{ ok: boolean; data?: T; error?: string }> {
    const url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json',
      ...(init.headers as Record<string, string> | undefined),
    };
    if (this.token) headers.authorization = `Bearer ${this.token}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(url, { ...init, headers, signal: controller.signal });
      if (!res.ok) {
        const bodyText = await safeText(res);
        return { ok: false, error: `letta ${res.status}: ${bodyText.slice(0, 240)}` };
      }
      const data = (await res.json()) as T;
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      clearTimeout(timer);
    }
  }
}

export function parseArchivalRow(raw: Record<string, unknown>): LettaArchivalRecord {
  return {
    id: typeof raw.id === 'string' ? raw.id : `letta-${Date.now().toString(36)}`,
    text: typeof raw.text === 'string' ? raw.text : typeof raw.content === 'string' ? (raw.content as string) : '',
    metadata: (raw.metadata as Record<string, unknown> | undefined) ?? undefined,
    createdAt: typeof raw.created_at === 'string' ? (raw.created_at as string) : undefined,
    score: typeof raw.score === 'number' ? raw.score : undefined,
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
