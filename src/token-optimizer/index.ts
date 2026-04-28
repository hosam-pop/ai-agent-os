import { AIProvider, CompletionRequest, CompletionResponse } from '../api/provider-interface.js';
import { SemanticCache } from './semantic-cache.js';
import { PromptCompressor } from './prompt-compressor.js';
import { SmartModelRouter } from './smart-router.js';
import { TokenBudgetManager } from './token-budget.js';
import { logger } from '../utils/logger.js';

export * from './semantic-cache.js';
export * from './prompt-compressor.js';
export * from './smart-router.js';
export * from './token-budget.js';

/**
 * TokenOptimizerProvider
 * A wrapper for any AIProvider that applies all token-saving optimizations.
 */
export class TokenOptimizerProvider implements AIProvider {
  private cache = new SemanticCache();
  private budget = new TokenBudgetManager();

  constructor(private inner: AIProvider) {}

  get name() {
    return `optimized-${this.inner.name}`;
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    this.budget.checkBudget();

    const routedModel = SmartModelRouter.route(req);
    const effectiveReq = { ...req, model: routedModel };

    effectiveReq.messages = PromptCompressor.compress(effectiveReq.messages);

    const cached = await this.cache.lookup(effectiveReq);
    if (cached) return cached;

    const response = await this.inner.complete(effectiveReq);

    this.budget.track(response.usage);
    await this.cache.store(effectiveReq, response);

    return response;
  }
}
