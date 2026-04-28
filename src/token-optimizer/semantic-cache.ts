import { CompletionRequest, CompletionResponse } from '../api/provider-interface.js';
import { logger } from '../utils/logger.js';
import crypto from 'crypto';

export interface CacheEntry {
  response: CompletionResponse;
  timestamp: number;
  hash: string;
}

/**
 * Semantic Cache Layer
 * Provides exact and near-exact matching for LLM requests to save tokens.
 */
export class SemanticCache {
  private cache: Map<string, CacheEntry> = new Map();
  private readonly ttl: number = 1000 * 60 * 60 * 24; // 24 hours

  constructor(ttlMs?: number) {
    if (ttlMs) this.ttl = ttlMs;
  }

  private generateHash(req: CompletionRequest): string {
    const relevantContent = {
      system: req.system,
      messages: req.messages.slice(-3).map(m => ({ role: m.role, content: m.content })),
      model: req.model
    };
    return crypto.createHash('sha256').update(JSON.stringify(relevantContent)).digest('hex');
  }

  async lookup(req: CompletionRequest): Promise<CompletionResponse | null> {
    const hash = this.generateHash(req);
    const entry = this.cache.get(hash);

    if (entry) {
      const isExpired = Date.now() - entry.timestamp > this.ttl;
      if (!isExpired) {
        logger.info('optimizer.cache.hit', { hash, model: req.model });
        return {
          ...entry.response,
          id: `cached-${entry.response.id}`,
          usage: { inputTokens: 0, outputTokens: 0 }
        };
      }
      this.cache.delete(hash);
    }
    
    return null;
  }

  async store(req: CompletionRequest, res: CompletionResponse): Promise<void> {
    const hash = this.generateHash(req);
    this.cache.set(hash, {
      response: res,
      timestamp: Date.now(),
      hash
    });
    
    if (this.cache.size > 1000) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }
  }
}
