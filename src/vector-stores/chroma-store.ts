/**
 * Chroma (https://github.com/chroma-core/chroma) adapter for
 * {@link VectorStore}. Talks directly to Chroma's REST API
 * (`/api/v1/collections`, `/api/v1/collections/{name}/add`, `/query`,
 * `/delete`) rather than pulling the `chromadb` npm package.
 */

import {
  type VectorMatch,
  type VectorPoint,
  type VectorSearchRequest,
  type VectorSearchResponse,
  type VectorStore,
  type VectorStoreOp,
} from './vector-store.js';

export interface ChromaStoreOptions {
  readonly baseUrl?: string;
  readonly token?: string;
  readonly tenant?: string;
  readonly database?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

export class ChromaStore implements VectorStore {
  readonly backend = 'chroma' as const;
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly collectionIds = new Map<string, string>();

  constructor(options: ChromaStoreOptions = {}) {
    this.baseUrl = trimSlash(options.baseUrl ?? 'http://localhost:8000');
    this.token = options.token;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async ensureCollection(name: string, _dim: number): Promise<VectorStoreOp> {
    if (!name) return { ok: false, error: 'collection name is required' };
    const res = await this.request<{ id?: string; name?: string }>(`/api/v1/collections`, {
      method: 'POST',
      body: JSON.stringify({ name, get_or_create: true }),
    });
    if (!res.ok || !res.data) return { ok: false, error: res.error };
    if (typeof res.data.id === 'string') this.collectionIds.set(name, res.data.id);
    return { ok: true };
  }

  async upsert(collection: string, points: readonly VectorPoint[]): Promise<VectorStoreOp> {
    if (points.length === 0) return { ok: true };
    const id = await this.resolveCollectionId(collection);
    if (!id) return { ok: false, error: `chroma collection "${collection}" is not initialised` };
    const body = {
      ids: points.map((p) => p.id),
      embeddings: points.map((p) => [...p.vector]),
      metadatas: points.map((p) => p.payload ?? {}),
      documents: points.map((p) => stringFromPayload(p.payload)),
    };
    const res = await this.request(`/api/v1/collections/${id}/upsert`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return res.ok ? { ok: true } : { ok: false, error: res.error };
  }

  async search(collection: string, request: VectorSearchRequest): Promise<VectorSearchResponse> {
    const id = await this.resolveCollectionId(collection);
    if (!id) return { ok: false, matches: [], error: `chroma collection "${collection}" is not initialised` };
    const body: Record<string, unknown> = {
      query_embeddings: [request.vector],
      n_results: request.limit ?? 10,
    };
    if (request.filter) body.where = request.filter;
    const res = await this.request<{
      ids?: string[][];
      distances?: number[][];
      metadatas?: Array<Array<Record<string, unknown> | null>>;
      documents?: string[][];
    }>(`/api/v1/collections/${id}/query`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!res.ok || !res.data) return { ok: false, matches: [], error: res.error };
    const matches = decodeChromaQuery(res.data);
    return { ok: true, matches };
  }

  async deleteByIds(collection: string, ids: readonly string[]): Promise<VectorStoreOp> {
    if (ids.length === 0) return { ok: true };
    const cid = await this.resolveCollectionId(collection);
    if (!cid) return { ok: false, error: `chroma collection "${collection}" is not initialised` };
    const res = await this.request(`/api/v1/collections/${cid}/delete`, {
      method: 'POST',
      body: JSON.stringify({ ids: [...ids] }),
    });
    return res.ok ? { ok: true } : { ok: false, error: res.error };
  }

  private async resolveCollectionId(collection: string): Promise<string | null> {
    const cached = this.collectionIds.get(collection);
    if (cached) return cached;
    const res = await this.request<{ id?: string }>(
      `/api/v1/collections/${encodeURIComponent(collection)}`,
      { method: 'GET' },
    );
    if (res.ok && res.data && typeof res.data.id === 'string') {
      this.collectionIds.set(collection, res.data.id);
      return res.data.id;
    }
    return null;
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
    if (this.token) headers.authorization = `Bearer ${this.token}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(url, { ...init, headers, signal: controller.signal });
      if (!res.ok) {
        const text = await safeText(res);
        return { ok: false, error: `chroma ${res.status}: ${text.slice(0, 240)}` };
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

export function decodeChromaQuery(raw: {
  ids?: string[][];
  distances?: number[][];
  metadatas?: Array<Array<Record<string, unknown> | null>>;
  documents?: string[][];
}): VectorMatch[] {
  const ids = raw.ids?.[0] ?? [];
  const distances = raw.distances?.[0] ?? [];
  const metadatas = raw.metadatas?.[0] ?? [];
  const documents = raw.documents?.[0] ?? [];
  const out: VectorMatch[] = [];
  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i];
    if (typeof id !== 'string') continue;
    const distance = typeof distances[i] === 'number' ? distances[i] : 0;
    const payload = metadatas[i] ?? undefined;
    const document = documents[i];
    out.push({
      id,
      score: 1 - distance,
      payload:
        payload && typeof payload === 'object'
          ? { ...payload, ...(document ? { document } : {}) }
          : document
            ? { document }
            : undefined,
    });
  }
  return out;
}

function stringFromPayload(payload?: Record<string, unknown>): string {
  if (!payload) return '';
  if (typeof payload.document === 'string') return payload.document;
  if (typeof payload.text === 'string') return payload.text as string;
  return '';
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
