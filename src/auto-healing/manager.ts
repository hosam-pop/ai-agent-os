import { AutoHealingConfig, HealingAttempt, ErrorCategory, HealingStrategy } from './types.js';
import { ErrorAnalyzer } from './error-analyzer.js';
import { RetryStrategyEngine } from './retry-strategy.js';
import { CircuitBreaker } from './circuit-breaker.js';
import { HealingLog } from './healing-log.js';

export class AutoHealingManager {
  private config: AutoHealingConfig;
  private strategyEngine: RetryStrategyEngine;
  private circuitBreaker: CircuitBreaker;
  private log: HealingLog;

  constructor(config?: Partial<AutoHealingConfig>) {
    this.config = {
      maxRetries: config?.maxRetries ?? 3,
      initialDelayMs: config?.initialDelayMs ?? 1000,
      circuitBreakerThreshold: config?.circuitBreakerThreshold ?? 5,
      circuitBreakerResetMs: config?.circuitBreakerResetMs ?? 60000,
    };
    this.strategyEngine = new RetryStrategyEngine(this.config);
    this.circuitBreaker = new CircuitBreaker(this.config);
    this.log = new HealingLog();
  }

  async handleFailure<T>(
    operation: () => Promise<T>,
    providerName: string,
    context?: { onCompress?: () => Promise<void>; onRephrase?: (msg: string) => void }
  ): Promise<T> {
    let lastError: unknown;
    
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      if (this.circuitBreaker.isOpen(providerName)) {
        throw new Error(`Circuit breaker is open for provider: ${providerName}`);
      }

      try {
        const result = await operation();
        this.circuitBreaker.recordSuccess(providerName);
        return result;
      } catch (error) {
        lastError = error;
        this.circuitBreaker.recordFailure(providerName);
        
        const category = ErrorAnalyzer.analyze(error);
        const strategy = this.strategyEngine.determineStrategy(category, attempt);
        
        const healingAttempt: HealingAttempt = {
          timestamp: Date.now(),
          error: error instanceof Error ? error.message : String(error),
          category,
          strategy,
          success: false,
        };

        if (attempt < this.config.maxRetries) {
          await this.applyStrategy(strategy, context);
          healingAttempt.success = true;
          this.log.log(healingAttempt);
        } else {
          this.log.log(healingAttempt);
          break;
        }
      }
    }

    throw lastError;
  }

  private async applyStrategy(
    strategy: HealingStrategy,
    context?: { onCompress?: () => Promise<void>; onRephrase?: (msg: string) => void }
  ): Promise<void> {
    switch (strategy.type) {
      case 'retry':
        if (strategy.delayMs) {
          await new Promise((resolve) => setTimeout(resolve, strategy.delayMs));
        }
        break;
      case 'compress':
        if (context?.onCompress) {
          await context.onCompress();
        }
        break;
      case 'rephrase':
        if (context?.onRephrase && strategy.rephrasePrompt) {
          context.onRephrase(strategy.rephrasePrompt);
        }
        break;
      case 'fallback':
        // Fallback logic is usually handled by AIRouter, 
        // but here we could trigger a provider switch if needed
        break;
    }
  }

  getHistory() {
    return this.log.getHistory();
  }
}
