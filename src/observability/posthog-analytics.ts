/**
 * PostHogAnalytics — optional product analytics backed by `posthog-node`.
 *
 * We report two event families:
 *  - `agent.tool_call` — one event per tool invocation with latency, ok.
 *  - `agent.iteration` — one event per think-act-observe iteration.
 *
 * Enabled via `DOGE_FEATURE_POSTHOG=true` + `POSTHOG_API_KEY`.
 * The adapter is a no-op when unconfigured.
 */

import { logger } from '../utils/logger.js';

export interface PostHogOptions {
  readonly apiKey?: string;
  readonly host?: string;
  readonly distinctId?: string;
  readonly loader?: () => Promise<unknown>;
}

export interface AnalyticsEvent {
  readonly event: string;
  readonly properties?: Record<string, unknown>;
  readonly distinctId?: string;
}

type PostHogClient = {
  capture: (params: unknown) => void;
  shutdown?: () => Promise<void>;
  shutdownAsync?: () => Promise<void>;
};

export class PostHogAnalytics {
  private readonly opts: PostHogOptions;
  private clientPromise: Promise<PostHogClient | null> | null = null;

  constructor(opts: PostHogOptions = {}) {
    this.opts = opts;
  }

  isConfigured(): boolean {
    return typeof this.opts.apiKey === 'string' && this.opts.apiKey.length > 0;
  }

  async capture(event: AnalyticsEvent): Promise<void> {
    const client = await this.client();
    if (!client) return;
    try {
      client.capture({
        distinctId: event.distinctId ?? this.opts.distinctId ?? 'ai-agent-os',
        event: event.event,
        properties: event.properties ?? {},
      });
    } catch (err) {
      logger.warn('posthog.capture.error', { error: stringifyError(err) });
    }
  }

  async shutdown(): Promise<void> {
    const client = await this.client();
    if (!client) return;
    try {
      if (client.shutdownAsync) await client.shutdownAsync();
      else if (client.shutdown) await client.shutdown();
    } catch (err) {
      logger.warn('posthog.shutdown.error', { error: stringifyError(err) });
    }
  }

  private async client(): Promise<PostHogClient | null> {
    if (!this.isConfigured()) return null;
    if (!this.clientPromise) {
      this.clientPromise = this.buildClient();
    }
    return this.clientPromise;
  }

  private async buildClient(): Promise<PostHogClient | null> {
    const loader = this.opts.loader ?? (() => import('posthog-node'));
    try {
      const mod = (await loader()) as { PostHog?: new (key: string, opts?: unknown) => PostHogClient };
      const Ctor = mod.PostHog;
      if (typeof Ctor !== 'function') return null;
      return new Ctor(this.opts.apiKey as string, { host: this.opts.host });
    } catch (err) {
      logger.warn('posthog.loader.error', { error: stringifyError(err) });
      return null;
    }
  }
}

function stringifyError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
