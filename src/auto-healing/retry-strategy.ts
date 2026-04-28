import { ErrorCategory, HealingStrategy, AutoHealingConfig } from './types.js';

export class RetryStrategyEngine {
  constructor(private config: AutoHealingConfig) {}

  determineStrategy(category: ErrorCategory, attemptCount: number): HealingStrategy {
    const delayMs = this.config.initialDelayMs * Math.pow(2, attemptCount);

    switch (category) {
      case 'rate_limit':
        return {
          type: 'retry',
          delayMs,
          // In a real scenario, we might suggest switching to a backup model here
        };

      case 'context_overflow':
        return {
          type: 'compress',
        };

      case 'invalid_response':
        return {
          type: 'rephrase',
          rephrasePrompt: 'Your previous response was invalid. Please format your response correctly and try again.',
        };

      case 'timeout':
        return {
          type: 'retry',
          delayMs: 1000, // Shorter delay for timeout
        };

      case 'api_error':
        return {
          type: 'fallback',
        };

      default:
        return {
          type: 'retry',
          delayMs,
        };
    }
  }
}
