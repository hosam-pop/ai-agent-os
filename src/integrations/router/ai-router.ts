import type {
  AIProvider,
  CompletionRequest,
  CompletionResponse,
} from '../../api/provider-interface.js';
import { logger } from '../../utils/logger.js';

/**
 * Multi-provider router with pluggable selection strategies.
 *
 * Conceptually inspired by {@link https://github.com/isaced/ai-router
 * `@isaced/ai-router`}. That upstream package is distributed as raw TypeScript
 * sources (no compiled `dist/`), which is inconvenient for a typed library
 * consumer. We reimplement the same shape — `providers + strategy` —
 * natively so it composes cleanly with our {@link AIProvider} interface and
 * can be built by `tsc` without runtime surprises.
 */

export type RouterStrategy = 'failover' | 'round-robin' | 'weighted' | 'least-recent';

export interface RouterBackend {
  name: string;
  provider: AIProvider;
  weight?: number;
  modelOverride?: string;
}

export interface RouterOptions {
  strategy?: RouterStrategy;
  maxAttemptsPerRequest?: number;
  onProviderError?: (backend: RouterBackend, err: unknown) => void;
}

export class AIRouter implements AIProvider {
  readonly name = 'router';

  private readonly strategy: RouterStrategy;
  private readonly maxAttemptsPerRequest: number;
  private readonly onProviderError?: (backend: RouterBackend, err: unknown) => void;
  private readonly backends: RouterBackend[];

  private roundRobinCursor = 0;
  private readonly lastUsedAt = new Map<string, number>();
  private readonly failCount = new Map<string, number>();

  constructor(backends: RouterBackend[], opts: RouterOptions = {}) {
    if (backends.length === 0) {
      throw new Error('AIRouter requires at least one backend');
    }
    this.backends = backends;
    this.strategy = opts.strategy ?? 'failover';
    this.maxAttemptsPerRequest = Math.max(1, opts.maxAttemptsPerRequest ?? backends.length);
    this.onProviderError = opts.onProviderError;
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const order = this.selectOrder();
    const attempts = Math.min(this.maxAttemptsPerRequest, order.length);
    let lastError: unknown;
    for (let i = 0; i < attempts; i++) {
      const backend = order[i];
      if (!backend) continue;
      const effective: CompletionRequest = backend.modelOverride
        ? { ...req, model: backend.modelOverride }
        : req;
      try {
        const response = await backend.provider.complete(effective);
        this.lastUsedAt.set(backend.name, Date.now());
        this.failCount.set(backend.name, 0);
        logger.debug('router.dispatch', {
          backend: backend.name,
          strategy: this.strategy,
          attempt: i + 1,
        });
        return response;
      } catch (err) {
        lastError = err;
        this.failCount.set(backend.name, (this.failCount.get(backend.name) ?? 0) + 1);
        this.onProviderError?.(backend, err);
        logger.warn('router.backend.error', {
          backend: backend.name,
          attempt: i + 1,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    throw new Error(
      `AIRouter exhausted ${attempts} backend(s): ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
    );
  }

  listBackends(): Array<{ name: string; failures: number; lastUsedAt: number | null }> {
    return this.backends.map((b) => ({
      name: b.name,
      failures: this.failCount.get(b.name) ?? 0,
      lastUsedAt: this.lastUsedAt.get(b.name) ?? null,
    }));
  }

  private selectOrder(): RouterBackend[] {
    switch (this.strategy) {
      case 'failover':
        return [...this.backends];
      case 'round-robin': {
        if (this.backends.length === 0) return [];
        const start = this.roundRobinCursor % this.backends.length;
        this.roundRobinCursor = (this.roundRobinCursor + 1) % this.backends.length;
        return [...this.backends.slice(start), ...this.backends.slice(0, start)];
      }
      case 'weighted': {
        const weighted = [...this.backends].sort(
          (a, b) => (b.weight ?? 1) - (a.weight ?? 1),
        );
        return weighted;
      }
      case 'least-recent': {
        return [...this.backends].sort((a, b) => {
          const aTs = this.lastUsedAt.get(a.name) ?? 0;
          const bTs = this.lastUsedAt.get(b.name) ?? 0;
          return aTs - bTs;
        });
      }
    }
  }
}
