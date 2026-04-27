import { CompletionRequest } from '../api/provider-interface.js';
import { logger } from '../utils/logger.js';

/**
 * Smart Model Router
 * Routes simple tasks to cheaper models and complex tasks to heavy models.
 */
export class SmartModelRouter {
  private static CHEAP_MODEL = 'gpt-4o-mini';
  private static HEAVY_MODEL = 'claude-3-5-sonnet-latest';

  static route(req: CompletionRequest): string {
    const originalModel = req.model;
    
    const isSimple = 
      req.messages.length < 5 && 
      !req.tools?.length && 
      this.getTotalContentLength(req) < 1000;

    if (isSimple && (originalModel.includes('sonnet') || originalModel.includes('gpt-4o') && !originalModel.includes('mini'))) {
      logger.info('optimizer.router.downgrade', { 
        from: originalModel, 
        to: this.CHEAP_MODEL,
        reason: 'simple_task'
      });
      return this.CHEAP_MODEL;
    }

    return originalModel;
  }

  private static getTotalContentLength(req: CompletionRequest): number {
    return req.messages.reduce((acc, m) => {
      if (typeof m.content === 'string') return acc + m.content.length;
      return acc + m.content.reduce((pa, p) => pa + (p.type === 'text' ? p.text.length : 0), 0);
    }, 0);
  }
}
