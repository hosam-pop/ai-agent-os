/**
 * OpenLITTracer — optional OTEL-native instrumentation via the `openlit` SDK.
 *
 * OpenLIT auto-instruments LLM provider SDKs (OpenAI / Anthropic / …) and
 * vector databases, exporting OpenTelemetry traces + metrics to any
 * OTLP-compatible backend (Grafana, Jaeger, SigNoz …).
 *
 * We only call `Openlit.init` once — idempotent across test re-imports.
 * Enabled via `DOGE_FEATURE_OPENLIT=true`.
 */

import { logger } from '../utils/logger.js';

export interface OpenLITOptions {
  readonly applicationName?: string;
  readonly environment?: string;
  readonly otlpEndpoint?: string;
  readonly otlpHeaders?: string;
  readonly disableMetrics?: boolean;
  readonly loader?: () => Promise<unknown>;
}

type OpenLITModule = {
  Openlit?: { init: (opts: unknown) => Promise<void> | void };
  default?: { init: (opts: unknown) => Promise<void> | void };
};

export class OpenLITTracer {
  private readonly opts: OpenLITOptions;
  private initialized = false;

  constructor(opts: OpenLITOptions = {}) {
    this.opts = opts;
  }

  async init(): Promise<boolean> {
    if (this.initialized) return true;
    const loader = this.opts.loader ?? (() => import('openlit'));
    try {
      const mod = (await loader()) as OpenLITModule;
      const impl = mod.Openlit ?? mod.default;
      if (!impl || typeof impl.init !== 'function') return false;
      await impl.init({
        applicationName: this.opts.applicationName ?? 'ai-agent-os',
        environment: this.opts.environment ?? 'development',
        otlpEndpoint: this.opts.otlpEndpoint,
        otlpHeaders: this.opts.otlpHeaders,
        disableMetrics: this.opts.disableMetrics,
      });
      this.initialized = true;
      return true;
    } catch (err) {
      logger.warn('openlit.init.error', {
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}
