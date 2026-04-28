export type ErrorCategory =
  | 'rate_limit'
  | 'context_overflow'
  | 'invalid_response'
  | 'timeout'
  | 'api_error'
  | 'unknown';

export interface HealingStrategy {
  type: 'retry' | 'fallback' | 'compress' | 'rephrase';
  delayMs?: number;
  newModel?: string;
  rephrasePrompt?: string;
}

export interface HealingAttempt {
  timestamp: number;
  error: string;
  category: ErrorCategory;
  strategy: HealingStrategy;
  success: boolean;
}

export interface AutoHealingConfig {
  maxRetries: number;
  initialDelayMs: number;
  circuitBreakerThreshold: number;
  circuitBreakerResetMs: number;
}
