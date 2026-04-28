/**
 * Qdrant (https://github.com/qdrant/qdrant) adapter for {@link VectorStore}.
 *
 * Targets the REST API directly (`PUT /collections/{name}`, `PUT /collections/
 * {name}/points`, `POST /collections/{name}/points/search`, `POST
 * /collections/{name}/points/delete`) so we do not add the `@qdrant/js-client-
 * rest` dependency to the build graph. Soft-fails on HTTP errors.
 */

import {
  type VectorMatch,
  type VectorPoint,
  type VectorPointId,
  type VectorSearchRequest,
  type VectorSearchResponse,
  type VectorStore,
  type VectorStoreOp,
  parseVectorMatch,
} from './vector-store.js';

export interface QdrantStoreOptions {
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
  readonly distance?: 'Cosine' | 'Dot' | 'Euclid';
}

export class QdrantStore implements VectorStore {
  readonly backend = 'qdrant' as const;
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly distance: 'Cosine' | 'Dot' | 'Euclid';

  constructor(options: QdrantStoreOptions = {}) {
    this.baseUrl = trimSlash(options.baseUrl ?? 'http://localhost:6333');
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.distance = options.distance ?? 'Cosine';
  }

  async ensureCollection(name: string, dim: number): Promise<VectorStoreOp> {
    if (!name) return { ok: false, error: 'collection name is required' };
    // Qdrant's PUT /collections/{name} is create-only and returns 409 on
    // re-creation, so we probe first. This keeps ensureCollection idempotent
    // across repeated invocations and agent restarts.
    const exists = await this.request<{ result?: { exists?: boolean } }>(
      `/collections/${encodeURIComponent(name)}/exists`,
      { method: 'GET' },
    );
    if (exists.ok && exists.data?.result?.exists === true) {
      return { ok: true };
    }
    const res = await this.request(`/collections/${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: JSON.stringify({ vectors: { size: dim, distance: this.distance } }),
    });
    if (res.ok) return { ok: true };
    // Fall back for older Qdrant builds without `/exists` that raced another
    // client: a 409 here still means the collection is present, which is what
    // the caller asked for.
    if (res.error && res.error.startsWith('qdrant 409')) {
      return { ok: true };
    }
    return { ok: false, error: res.error };
  }

  async upsert(collection: string, points: readonly VectorPoint[]): Promise<VectorStoreOp> {
    if (points.length === 0) return { ok: true };
    const body = {
      points: points.map((p) => ({ id: p.id, vector: p.vector, payload: p.payload ?? {} })),
    };
    const res = await this.request(
      `/collections/${encodeURIComponent(collection)}/points?wait=true`,
      { method: 'PUT', body: JSON.stringify(body) },
    );
    return res.ok ? { ok: true } : { ok: false, error: res.error };
  }

  async search(collection: string, request: VectorSearchRequest): Promise<VectorSearchResponse> {
    const body = {
      vector: request.vector,
      limit: request.limit ?? 10,
      with_payload: true,
      filter: request.filter,
    };
    const res = await this.request<{ result?: Array<Record<string, unknown>> }>(
      `/collections/${encodeURIComponent(collection)}/points/search`,
      { method: 'POST', body: JSON.stringify(body) },
    );
    if (!res.ok || !res.data) return { ok: false, matches: [], error: res.error };
    const rows = res.data.result ?? [];
    const matches: VectorMatch[] = rows.map((row, i) => parseVectorMatch(row, i));
    return { ok: true, matches };
  }

  async deleteByIds(
    collection: string,
    ids: readonly VectorPointId[],
  ): Promise<VectorStoreOp> {
    if (ids.length === 0) return { ok: true };
    const res = await this.request(
      `/collections/${encodeURIComponent(collection)}/points/delete?wait=true`,
      { method: 'POST', body: JSON.stringify({ points: [...ids] }) },
    );
    return res.ok ? { ok: true } : { ok: false, error: res.error };
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
    if (this.apiKey) headers['api-key'] = this.apiKey;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(url, { ...init, headers, signal: controller.signal });
      if (!res.ok) {
        const text = await safeText(res);
        return { ok: false, error: `qdrant ${res.status}: ${text.slice(0, 240)}` };
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
