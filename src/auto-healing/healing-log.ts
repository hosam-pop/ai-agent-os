import { HealingAttempt } from './types.js';
import { logger } from '../utils/logger.js';

export class HealingLog {
  private attempts: HealingAttempt[] = [];

  log(attempt: HealingAttempt): void {
    this.attempts.push(attempt);
    logger.info('auto-healing.attempt', {
      category: attempt.category,
      strategy: attempt.strategy.type,
      success: attempt.success,
      error: attempt.error,
    });
  }

  getHistory(): HealingAttempt[] {
    return [...this.attempts];
  }

  getSuccessRate(): number {
    if (this.attempts.length === 0) return 0;
    const successes = this.attempts.filter((a) => a.success).length;
    return successes / this.attempts.length;
  }
}
