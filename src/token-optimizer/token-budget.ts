import { CompletionUsage } from '../api/provider-interface.js';
import { logger } from '../utils/logger.js';

/**
 * Token Budget Manager
 * Tracks and limits token usage across a session or globally.
 */
export class TokenBudgetManager {
  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  private readonly limit: number;

  constructor(limit: number = 1000000) {
    this.limit = limit;
  }

  track(usage: CompletionUsage): void {
    this.totalInputTokens += usage.inputTokens;
    this.totalOutputTokens += usage.outputTokens;
    
    const total = this.totalInputTokens + this.totalOutputTokens;
    if (total > this.limit * 0.8) {
      logger.warn('optimizer.budget.near_limit', { 
        current: total, 
        limit: this.limit,
        percentage: `${Math.round((total / this.limit) * 100)}%`
      });
    }
  }

  checkBudget(): void {
    const total = this.totalInputTokens + this.totalOutputTokens;
    if (total >= this.limit) {
      throw new Error(`Token budget exceeded: ${total} >= ${this.limit}. Stopping to save costs.`);
    }
  }

  getStats() {
    return {
      input: this.totalInputTokens,
      output: this.totalOutputTokens,
      total: this.totalInputTokens + this.totalOutputTokens,
      remaining: Math.max(0, this.limit - (this.totalInputTokens + this.totalOutputTokens))
    };
  }
}
