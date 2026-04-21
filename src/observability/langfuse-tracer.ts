/**
 * LangfuseTracer — optional tracing backed by the `langfuse` npm SDK.
 *
 * Every agent iteration (think → act → observe) can be wrapped with a
 * Langfuse trace so the team has long-term visibility into which tools
 * were called, how expensive each call was, and which prompts produced
 * which outputs. Enable via `DOGE_FEATURE_LANGFUSE=true` and provide
 * `LANGFUSE_PUBLIC_KEY` + `LANGFUSE_SECRET_KEY`.
 *
 * The tracer is a no-op when not configured; nothing else in the system
 * has to know whether Langfuse is live.
 */

import { logger } from '../utils/logger.js';

export interface LangfuseOptions {
  readonly publicKey?: string;
  readonly secretKey?: string;
  readonly baseUrl?: string;
  readonly loader?: () => Promise<unknown>;
}

export interface TraceHandle {
  readonly id: string;
  end(output?: unknown): Promise<void>;
  event(name: string, payload?: unknown): Promise<void>;
}

type LangfuseClient = {
  trace: (params: unknown) => {
    id: string;
    event?: (params: unknown) => void;
    update?: (params: unknown) => void;
  };
  flushAsync?: () => Promise<void>;
  shutdownAsync?: () => Promise<void>;
};

export class LangfuseTracer {
  private readonly opts: LangfuseOptions;
  private clientPromise: Promise<LangfuseClient | null> | null = null;

  constructor(opts: LangfuseOptions = {}) {
    this.opts = opts;
  }

  isConfigured(): boolean {
    return Boolean(this.opts.publicKey && this.opts.secretKey);
  }

  async startTrace(name: string, metadata?: Record<string, unknown>): Promise<TraceHandle> {
    const client = await this.client();
    if (!client) return noopTrace(name);
    try {
      const trace = client.trace({ name, metadata: metadata ?? {} });
      const id = trace.id ?? `noop-${Date.now().toString(36)}`;
      return {
        id,
        async end(output?: unknown) {
          try {
            trace.update?.({ output });
          } catch (err) {
            logger.warn('langfuse.trace.end.error', { error: stringifyError(err) });
          }
        },
        async event(evName: string, payload?: unknown) {
          try {
            trace.event?.({ name: evName, input: payload });
          } catch (err) {
            logger.warn('langfuse.trace.event.error', { error: stringifyError(err) });
          }
        },
      };
    } catch (err) {
      logger.warn('langfuse.trace.start.error', { error: stringifyError(err) });
      return noopTrace(name);
    }
  }

  async flush(): Promise<void> {
    const client = await this.client();
    if (!client) return;
    try {
      if (client.flushAsync) await client.flushAsync();
      else if (client.shutdownAsync) await client.shutdownAsync();
    } catch (err) {
      logger.warn('langfuse.flush.error', { error: stringifyError(err) });
    }
  }

  private async client(): Promise<LangfuseClient | null> {
    if (!this.isConfigured()) return null;
    if (!this.clientPromise) {
      this.clientPromise = this.buildClient();
    }
    return this.clientPromise;
  }

  private async buildClient(): Promise<LangfuseClient | null> {
    const loader = this.opts.loader ?? (() => import('langfuse'));
    try {
      const mod = (await loader()) as { Langfuse?: new (opts: unknown) => LangfuseClient };
      const Ctor = mod.Langfuse;
      if (typeof Ctor !== 'function') return null;
      return new Ctor({
        publicKey: this.opts.publicKey,
        secretKey: this.opts.secretKey,
        baseUrl: this.opts.baseUrl,
      });
    } catch (err) {
      logger.warn('langfuse.loader.error', { error: stringifyError(err) });
      return null;
    }
  }
}

function noopTrace(name: string): TraceHandle {
  return {
    id: `noop-${name}-${Date.now().toString(36)}`,
    async end() {},
    async event() {},
  };
}

function stringifyError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
