/**
 * AgentWatchAdapter — fleet-health monitoring via `@nicofains1/agentwatch`.
 *
 * The adapter is fire-and-forget: it accepts structured events from the
 * agent loop, attaches a trace id, and asks the SDK to flush. If
 * AgentWatch is not configured, every emit becomes a no-op.
 */

import { logger } from '../utils/logger.js';

export interface AgentWatchOptions {
  readonly endpoint?: string;
  readonly apiKey?: string;
  readonly serviceName?: string;
  readonly loader?: () => Promise<unknown>;
}

export interface HeartbeatEvent {
  readonly agentId: string;
  readonly iteration: number;
  readonly goalPreview: string;
  readonly tokenUsage: { readonly inputTokens: number; readonly outputTokens: number };
  readonly status: 'running' | 'succeeded' | 'failed';
  readonly error?: string;
}

type AgentWatchClient = {
  recordEvent?: (event: unknown) => void | Promise<void>;
  flush?: () => Promise<void>;
};

export class AgentWatchAdapter {
  private readonly opts: AgentWatchOptions;
  private clientPromise: Promise<AgentWatchClient | null> | null = null;

  constructor(opts: AgentWatchOptions = {}) {
    this.opts = opts;
  }

  isConfigured(): boolean {
    return typeof this.opts.endpoint === 'string' && this.opts.endpoint.length > 0;
  }

  async heartbeat(event: HeartbeatEvent): Promise<void> {
    const client = await this.client();
    if (!client) return;
    try {
      await client.recordEvent?.({
        service: this.opts.serviceName ?? 'ai-agent-os',
        type: 'agent.heartbeat',
        payload: event,
        ts: Date.now(),
      });
    } catch (err) {
      logger.warn('agentwatch.heartbeat.error', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async flush(): Promise<void> {
    const client = await this.client();
    if (!client) return;
    try {
      await client.flush?.();
    } catch (err) {
      logger.warn('agentwatch.flush.error', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async client(): Promise<AgentWatchClient | null> {
    if (!this.isConfigured()) return null;
    if (!this.clientPromise) {
      this.clientPromise = this.buildClient();
    }
    return this.clientPromise;
  }

  private async buildClient(): Promise<AgentWatchClient | null> {
    const loader = this.opts.loader ?? (() => import('@nicofains1/agentwatch'));
    try {
      const mod = (await loader()) as {
        AgentWatch?: new (opts: unknown) => AgentWatchClient;
      };
      const Ctor = mod.AgentWatch;
      if (typeof Ctor !== 'function') return null;
      return new Ctor({
        endpoint: this.opts.endpoint,
        apiKey: this.opts.apiKey,
        serviceName: this.opts.serviceName ?? 'ai-agent-os',
      });
    } catch (err) {
      logger.warn('agentwatch.loader.error', {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }
}
