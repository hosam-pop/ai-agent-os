/**
 * Unified `vector_store` tool. One agent-facing tool, three backends
 * (Qdrant / Chroma / LanceDB) selected at call time by `backend`. Every
 * upstream failure flows through the same `{ ok: false, error }` contract
 * so the agent doesn't have to know which backend it is talking to.
 */

import { z } from 'zod';
import type { Tool, ToolContext, ToolResult } from '../tools/registry.js';
import { loadEnv } from '../config/env-loader.js';
import { ChromaStore } from './chroma-store.js';
import { LanceDBStore } from './lancedb-store.js';
import { QdrantStore } from './qdrant-store.js';
import type { VectorPoint, VectorStore } from './vector-store.js';

export type VectorBackend = 'qdrant' | 'chroma' | 'lancedb';
export type VectorAction = 'ensure' | 'upsert' | 'search' | 'delete';

export interface VectorStoreInput {
  readonly backend?: VectorBackend;
  readonly action: VectorAction;
  readonly collection: string;
  readonly dim?: number;
  readonly points?: readonly VectorPoint[];
  readonly vector?: readonly number[];
  readonly limit?: number;
  readonly filter?: Record<string, unknown>;
  readonly ids?: readonly string[];
}

const VectorPointSchema: z.ZodType<VectorPoint> = z.object({
  id: z.string().min(1),
  vector: z.array(z.number()).min(1),
  payload: z.record(z.unknown()).optional(),
});

const VectorStoreSchema: z.ZodType<VectorStoreInput> = z.object({
  backend: z.enum(['qdrant', 'chroma', 'lancedb']).optional(),
  action: z.enum(['ensure', 'upsert', 'search', 'delete']),
  collection: z.string().min(1),
  dim: z.number().int().positive().optional(),
  points: z.array(VectorPointSchema).optional(),
  vector: z.array(z.number()).min(1).optional(),
  limit: z.number().int().positive().max(1000).optional(),
  filter: z.record(z.unknown()).optional(),
  ids: z.array(z.string().min(1)).optional(),
});

export class VectorStoreTool implements Tool<VectorStoreInput> {
  readonly name = 'vector_store';
  readonly description =
    'Interact with a vector database (Qdrant, Chroma, or LanceDB) through a common interface. Actions: ensure (create collection), upsert (add/update vectors), search (nearest neighbours), delete (by ids).';
  readonly schema: z.ZodType<VectorStoreInput, z.ZodTypeDef, unknown> = VectorStoreSchema;
  readonly jsonSchema = {
    type: 'object',
    properties: {
      backend: { type: 'string', enum: ['qdrant', 'chroma', 'lancedb'] },
      action: { type: 'string', enum: ['ensure', 'upsert', 'search', 'delete'] },
      collection: { type: 'string' },
      dim: { type: 'number' },
      points: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            vector: { type: 'array', items: { type: 'number' } },
            payload: { type: 'object', additionalProperties: true },
          },
          required: ['id', 'vector'],
        },
      },
      vector: { type: 'array', items: { type: 'number' } },
      limit: { type: 'number' },
      filter: { type: 'object', additionalProperties: true },
      ids: { type: 'array', items: { type: 'string' } },
    },
    required: ['action', 'collection'],
    additionalProperties: false,
  } as const;
  readonly dangerous = false;

  constructor(private readonly stores: Partial<Record<VectorBackend, VectorStore>> = {}) {}

  async run(input: VectorStoreInput, _ctx: ToolContext): Promise<ToolResult> {
    const backend = input.backend ?? resolveDefaultBackend();
    const store = this.stores[backend] ?? this.buildDefaultStore(backend);
    if (!store) {
      return { ok: false, output: '', error: `vector store backend "${backend}" is not configured` };
    }
    try {
      switch (input.action) {
        case 'ensure': {
          if (!input.dim) return { ok: false, output: '', error: 'dim is required for ensure' };
          const res = await store.ensureCollection(input.collection, input.dim);
          return res.ok
            ? { ok: true, output: `collection "${input.collection}" ready on ${backend}` }
            : { ok: false, output: '', error: res.error };
        }
        case 'upsert': {
          const points = input.points ?? [];
          const res = await store.upsert(input.collection, points);
          return res.ok
            ? { ok: true, output: `upserted ${points.length} point(s) into ${backend}/${input.collection}` }
            : { ok: false, output: '', error: res.error };
        }
        case 'search': {
          if (!input.vector) return { ok: false, output: '', error: 'vector is required for search' };
          const res = await store.search(input.collection, {
            vector: input.vector,
            limit: input.limit,
            filter: input.filter,
          });
          if (!res.ok) return { ok: false, output: '', error: res.error };
          return {
            ok: true,
            output: res.matches
              .map((m, i) => `${i + 1}. id=${m.id} score=${m.score.toFixed(4)}`)
              .join('\n') || '(no matches)',
            data: res,
          };
        }
        case 'delete': {
          const ids = input.ids ?? [];
          const res = await store.deleteByIds(input.collection, ids);
          return res.ok
            ? { ok: true, output: `deleted ${ids.length} id(s) from ${backend}/${input.collection}` }
            : { ok: false, output: '', error: res.error };
        }
      }
    } catch (err) {
      return { ok: false, output: '', error: err instanceof Error ? err.message : String(err) };
    }
  }

  private buildDefaultStore(backend: VectorBackend): VectorStore | null {
    const env = loadEnv();
    switch (backend) {
      case 'qdrant':
        return new QdrantStore({ baseUrl: env.QDRANT_URL, apiKey: env.QDRANT_API_KEY });
      case 'chroma':
        return new ChromaStore({ baseUrl: env.CHROMA_URL, token: env.CHROMA_TOKEN });
      case 'lancedb':
        return new LanceDBStore({ uri: env.LANCEDB_URI });
      default:
        return null;
    }
  }
}

function resolveDefaultBackend(): VectorBackend {
  const env = loadEnv();
  const choice = env.VECTOR_STORE_BACKEND;
  if (choice === 'qdrant' || choice === 'chroma' || choice === 'lancedb') return choice;
  if (env.QDRANT_URL) return 'qdrant';
  if (env.CHROMA_URL) return 'chroma';
  return 'lancedb';
}
