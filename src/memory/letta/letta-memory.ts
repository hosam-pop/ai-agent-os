/**
 * Adapter that exposes a {@link LettaClient} through the same interface the
 * rest of the agent uses for long-term memory (semantic recall + archival
 * store). Soft-fails when the Letta service is unreachable so the agent
 * keeps running rather than crashing.
 */

import type { Mem0Adapter, Mem0Record } from '../../integrations/mem0/mem0-memory.js';
import { loadEnv } from '../../config/env-loader.js';
import { logger } from '../../utils/logger.js';
import { LettaClient } from './letta-client.js';

export interface LettaMemoryOptions {
  readonly agentId?: string;
  readonly client?: LettaClient;
}

export async function createLettaMemory(opts: LettaMemoryOptions = {}): Promise<Mem0Adapter | null> {
  const env = loadEnv();
  const agentId = opts.agentId ?? env.LETTA_AGENT_ID;
  if (!agentId) {
    logger.info('letta.skip', { reason: 'LETTA_AGENT_ID missing' });
    return null;
  }
  const client =
    opts.client ??
    new LettaClient({
      baseUrl: env.LETTA_URL,
      token: env.LETTA_TOKEN,
    });
  return new LettaAdapter(client, agentId);
}

class LettaAdapter implements Mem0Adapter {
  readonly backend = 'local' as const;

  constructor(
    private readonly client: LettaClient,
    private readonly agentId: string,
  ) {}

  async add(text: string, metadata?: Record<string, unknown>): Promise<Mem0Record> {
    const res = await this.client.appendArchival(this.agentId, text, metadata);
    if (!res.ok || !res.record) {
      logger.warn('letta.add.failed', { error: res.error });
      return { id: `letta-fail-${Date.now().toString(36)}`, text, metadata };
    }
    return {
      id: res.record.id,
      text: res.record.text,
      metadata: res.record.metadata,
      createdAt: res.record.createdAt,
    };
  }

  async search(query: string, limit = 10): Promise<Mem0Record[]> {
    const res = await this.client.searchArchival(this.agentId, query, limit);
    if (!res.ok) {
      logger.warn('letta.search.failed', { error: res.error });
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
    return this.search('', limit);
  }

  async delete(_id: string): Promise<boolean> {
    logger.warn('letta.delete.unsupported', { agentId: this.agentId });
    return false;
  }
}
