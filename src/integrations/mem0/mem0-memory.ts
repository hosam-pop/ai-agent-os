import { LongTermMemory, type LongTermRecord } from '../../memory/long-term.js';
import { loadEnv } from '../../config/env-loader.js';
import { logger } from '../../utils/logger.js';

/**
 * mem0-backed semantic memory with graceful local fallback.
 *
 * When `MEM0_API_KEY` is present we connect to mem0's managed service and use
 * its hybrid vector/semantic search. When it is absent (or the SDK cannot be
 * loaded), we fall back to the on-disk {@link LongTermMemory} so the
 * high-level API stays the same whether the user has signed up for mem0 or
 * not. Reference: {@link https://github.com/mem0ai/mem0 mem0ai/mem0}.
 */

export interface Mem0Record {
  id: string;
  text: string;
  score?: number;
  metadata?: Record<string, unknown>;
  createdAt?: string;
}

export interface Mem0Adapter {
  readonly backend: 'mem0' | 'local';
  add(text: string, metadata?: Record<string, unknown>): Promise<Mem0Record>;
  search(query: string, limit?: number): Promise<Mem0Record[]>;
  list(limit?: number): Promise<Mem0Record[]>;
  delete(id: string): Promise<boolean>;
}

interface Mem0ClientLike {
  add(
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    options?: { userId?: string; metadata?: Record<string, unknown> },
  ): Promise<Array<{ id: string }>>;
  search(
    query: string,
    options?: { userId?: string; topK?: number },
  ): Promise<{
    results: Array<{
      id: string;
      memory?: string;
      score?: number;
      metadata?: unknown;
      createdAt?: Date;
    }>;
  }>;
  getAll(options?: {
    userId?: string;
    pageSize?: number;
  }): Promise<{
    results: Array<{
      id: string;
      memory?: string;
      metadata?: unknown;
      createdAt?: Date;
    }>;
  }>;
  delete(id: string): Promise<unknown>;
}

export async function createMem0Memory(): Promise<Mem0Adapter> {
  const env = loadEnv();
  if (!env.MEM0_API_KEY) {
    logger.info('mem0.fallback.local', { reason: 'no MEM0_API_KEY' });
    return new LocalMem0(new LongTermMemory());
  }
  try {
    const mod = (await import('mem0ai')) as unknown as {
      MemoryClient?: new (options: {
        apiKey: string;
        organizationId?: string;
        projectId?: string;
      }) => unknown;
      default?: new (options: {
        apiKey: string;
        organizationId?: string;
        projectId?: string;
      }) => unknown;
    };
    const Ctor = mod.MemoryClient ?? mod.default;
    if (!Ctor) throw new Error('mem0ai module did not expose MemoryClient');
    const client = new Ctor({
      apiKey: env.MEM0_API_KEY,
      organizationId: env.MEM0_ORG_ID,
      projectId: env.MEM0_PROJECT_ID,
    }) as unknown as Mem0ClientLike;
    return new RemoteMem0(client, env.MEM0_USER_ID);
  } catch (err) {
    logger.warn('mem0.client.init-failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return new LocalMem0(new LongTermMemory());
  }
}

class RemoteMem0 implements Mem0Adapter {
  readonly backend = 'mem0' as const;

  constructor(
    private readonly client: Mem0ClientLike,
    private readonly userId: string,
  ) {}

  async add(text: string, metadata?: Record<string, unknown>): Promise<Mem0Record> {
    const result = await this.client.add(
      [{ role: 'user', content: text }],
      { userId: this.userId, metadata },
    );
    const first = result[0];
    const id = first?.id ?? `mem0-${Date.now().toString(36)}`;
    return { id, text, metadata, createdAt: new Date().toISOString() };
  }

  async search(query: string, limit = 10): Promise<Mem0Record[]> {
    const { results } = await this.client.search(query, {
      userId: this.userId,
      topK: limit,
    });
    return results.map((r) => ({
      id: r.id,
      text: r.memory ?? '',
      score: r.score,
      metadata: coerceMetadata(r.metadata),
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : undefined,
    }));
  }

  async list(limit = 50): Promise<Mem0Record[]> {
    const { results } = await this.client.getAll({
      userId: this.userId,
      pageSize: limit,
    });
    return results.map((r) => ({
      id: r.id,
      text: r.memory ?? '',
      metadata: coerceMetadata(r.metadata),
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : undefined,
    }));
  }

  async delete(id: string): Promise<boolean> {
    try {
      await this.client.delete(id);
      return true;
    } catch (err) {
      logger.warn('mem0.delete.error', {
        id,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }
}

class LocalMem0 implements Mem0Adapter {
  readonly backend = 'local' as const;

  constructor(private readonly underlying: LongTermMemory) {}

  async add(text: string, metadata?: Record<string, unknown>): Promise<Mem0Record> {
    const record = this.underlying.remember({
      title: summarizeTitle(text),
      body: text,
      tags: extractTags(metadata),
    });
    return { id: record.id, text: record.body, metadata, createdAt: record.createdAt };
  }

  async search(query: string, limit = 10): Promise<Mem0Record[]> {
    return this.underlying.search(query, limit).map(toMem0Record);
  }

  async list(limit = 50): Promise<Mem0Record[]> {
    return this.underlying.list(limit).map(toMem0Record);
  }

  async delete(_id: string): Promise<boolean> {
    return false;
  }
}

function toMem0Record(r: LongTermRecord): Mem0Record {
  return {
    id: r.id,
    text: r.body,
    createdAt: r.createdAt,
    metadata: { tags: r.tags, title: r.title },
  };
}

function summarizeTitle(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= 60) return trimmed;
  return `${trimmed.slice(0, 57)}…`;
}

function extractTags(metadata: Record<string, unknown> | undefined): string[] {
  if (!metadata) return [];
  const raw = metadata.tags;
  if (Array.isArray(raw)) return raw.filter((t): t is string => typeof t === 'string');
  return [];
}

function coerceMetadata(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  return value as Record<string, unknown>;
}
