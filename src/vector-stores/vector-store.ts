/**
 * Unified `VectorStore` interface so the agent can swap between Qdrant,
 * Chroma, LanceDB, or any future backend without touching call sites.
 *
 * Inspired by the lowest-common-denominator operations shared by all three
 * upstream projects: upsert a list of vectors with an optional payload,
 * run nearest-neighbour search with a filter, and delete by id.
 */

export interface VectorPoint {
  readonly id: string;
  readonly vector: readonly number[];
  readonly payload?: Record<string, unknown>;
}

export interface VectorMatch {
  readonly id: string;
  readonly score: number;
  readonly payload?: Record<string, unknown>;
  readonly vector?: readonly number[];
}

export interface VectorSearchRequest {
  readonly vector: readonly number[];
  readonly limit?: number;
  readonly filter?: Record<string, unknown>;
}

export interface VectorStoreOp {
  readonly ok: boolean;
  readonly error?: string;
}

export interface VectorSearchResponse {
  readonly ok: boolean;
  readonly matches: VectorMatch[];
  readonly error?: string;
}

export interface VectorStore {
  readonly backend: 'qdrant' | 'chroma' | 'lancedb';
  ensureCollection(name: string, dim: number): Promise<VectorStoreOp>;
  upsert(collection: string, points: readonly VectorPoint[]): Promise<VectorStoreOp>;
  search(collection: string, request: VectorSearchRequest): Promise<VectorSearchResponse>;
  deleteByIds(collection: string, ids: readonly string[]): Promise<VectorStoreOp>;
  close?(): Promise<void>;
}

/** Normalise an unknown upstream row into a typed match. */
export function parseVectorMatch(raw: unknown, fallbackIndex = 0): VectorMatch {
  if (!raw || typeof raw !== 'object') {
    return { id: `match-${fallbackIndex}`, score: 0 };
  }
  const row = raw as Record<string, unknown>;
  const id =
    typeof row.id === 'string'
      ? row.id
      : typeof row.id === 'number'
        ? String(row.id)
        : `match-${fallbackIndex}`;
  const score = typeof row.score === 'number' ? row.score : typeof row.distance === 'number' ? 1 - (row.distance as number) : 0;
  const payload =
    (row.payload as Record<string, unknown> | undefined) ??
    (row.metadata as Record<string, unknown> | undefined) ??
    undefined;
  const vector = Array.isArray(row.vector) ? (row.vector as number[]) : undefined;
  return { id, score, payload, vector };
}
