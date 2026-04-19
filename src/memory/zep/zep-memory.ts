/**
 * Zep memory adapter that implements the same `Mem0Adapter` surface used by
 * the rest of the agent, so long-term memory calls can be routed through
 * Zep instead of mem0 without any other code change.
 */

import type { Mem0Adapter, Mem0Record } from '../../integrations/mem0/mem0-memory.js';
import { loadEnv } from '../../config/env-loader.js';
import { logger } from '../../utils/logger.js';
import { ZepClient } from './zep-client.js';

export interface ZepMemoryOptions {
  readonly sessionId?: string;
  readonly client?: ZepClient;
}

export async function createZepMemory(opts: ZepMemoryOptions = {}): Promise<Mem0Adapter | null> {
  const env = loadEnv();
  const sessionId = opts.sessionId ?? env.ZEP_SESSION_ID ?? 'ai-agent-os-default';
  if (!env.ZEP_API_KEY && !opts.client) {
    logger.info('zep.skip', { reason: 'ZEP_API_KEY missing' });
    return null;
  }
  const client =
    opts.client ??
    new ZepClient({
      baseUrl: env.ZEP_URL,
      token: env.ZEP_API_KEY,
    });
  return new ZepAdapter(client, sessionId);
}

class ZepAdapter implements Mem0Adapter {
  readonly backend = 'local' as const;

  constructor(
    private readonly client: ZepClient,
    private readonly sessionId: string,
  ) {}

  async add(text: string, metadata?: Record<string, unknown>): Promise<Mem0Record> {
    const res = await this.client.addMemory(this.sessionId, [
      { role: 'user', content: text },
    ]);
    if (!res.ok) logger.warn('zep.add.failed', { error: res.error });
    return {
      id: `zep-${this.sessionId}-${Date.now().toString(36)}`,
      text,
      metadata,
      createdAt: new Date().toISOString(),
    };
  }

  async search(query: string, limit = 10): Promise<Mem0Record[]> {
    const res = await this.client.searchMemory(this.sessionId, query, limit);
    if (!res.ok) {
      logger.warn('zep.search.failed', { error: res.error });
      return [];
    }
    return res.records.map((r) => ({
      id: r.id,
      text: r.text,
      metadata: r.metadata,
      createdAt: r.createdAt,
      score: r.score,
    }));
  }

  async list(limit = 50): Promise<Mem0Record[]> {
    const res = await this.client.getMemory(this.sessionId);
    if (!res.ok) return [];
    return res.records.slice(0, limit).map((r) => ({
      id: r.id,
      text: r.text,
      metadata: r.metadata,
      createdAt: r.createdAt,
    }));
  }

  async delete(_id: string): Promise<boolean> {
    logger.warn('zep.delete.unsupported', { sessionId: this.sessionId });
    return false;
  }
}
