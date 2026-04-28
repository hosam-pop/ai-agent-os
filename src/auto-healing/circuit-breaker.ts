import { AutoHealingConfig } from './types.js';
import { logger } from '../utils/logger.js';

export class CircuitBreaker {
  private failures = new Map<string, number>();
  private lastFailureTime = new Map<string, number>();
  private openCircuits = new Set<string>();

  constructor(private config: AutoHealingConfig) {}

  recordFailure(providerName: string): void {
    const now = Date.now();
    const count = (this.failures.get(providerName) || 0) + 1;
    this.failures.set(providerName, count);
    this.lastFailureTime.set(providerName, now);

    if (count >= this.config.circuitBreakerThreshold) {
      this.openCircuits.add(providerName);
      logger.warn('circuit-breaker.open', { provider: providerName, failures: count });
    }
  }

  recordSuccess(providerName: string): void {
    this.failures.set(providerName, 0);
    this.openCircuits.delete(providerName);
  }

  isOpen(providerName: string): boolean {
    if (!this.openCircuits.has(providerName)) return false;

    const lastFailure = this.lastFailureTime.get(providerName) || 0;
    const now = Date.now();

    if (now - lastFailure > this.config.circuitBreakerResetMs) {
      // Half-open state - let one request through
      this.openCircuits.delete(providerName);
      return false;
    }

    return true;
  }
}
