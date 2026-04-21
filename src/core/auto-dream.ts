/**
 * Auto-dream — periodic context compression loop.
 *
 * Conceptually: every N minutes, skim the agent's working memory,
 * compress the older portion via the existing summarizer, and archive
 * the result into long-term memory. The pattern is lifted from the
 * "autoDream" stage of the Claude-Code pipeline but adapted to this
 * repository's primitives.
 *
 * Everything is gated behind `ENABLE_AUTO_DREAM`. When disabled, the
 * scheduler refuses to start; no timers are ever installed, which
 * keeps the test suite deterministic and the binary size small.
 */

import { feature } from '../config/feature-flags.js';
import { logger } from '../utils/logger.js';
import type { AIProvider, ChatMessage } from '../api/provider-interface.js';
import { summarize, type SummarizeOptions } from '../memory/summarizer.js';

export interface AutoDreamSource {
  /** Return the current conversation buffer (newest last). */
  snapshot(): Promise<ChatMessage[]> | ChatMessage[];
  /** Swap the buffer for the compressed version returned by auto-dream. */
  replace(next: ChatMessage[]): Promise<void> | void;
}

export interface AutoDreamSink {
  /** Persist the summary note to long-term memory. */
  archive(note: ChatMessage, meta: { compressedFrom: number; at: number }): Promise<void> | void;
}

export interface AutoDreamOptions extends SummarizeOptions {
  readonly intervalMs?: number;
  readonly minMessages?: number;
  readonly timer?: {
    setInterval: (cb: () => void, ms: number) => ReturnType<typeof setInterval>;
    clearInterval: (id: ReturnType<typeof setInterval>) => void;
  };
}

export interface AutoDreamHandle {
  stop(): void;
  /** Force a cycle to run now. Useful for tests and manual triggers. */
  tick(): Promise<AutoDreamCycleResult>;
  readonly isRunning: boolean;
}

export interface AutoDreamCycleResult {
  readonly ran: boolean;
  readonly compressedFrom?: number;
  readonly keptRecent?: number;
  readonly reason?: string;
}

export function startAutoDream(
  provider: AIProvider,
  source: AutoDreamSource,
  sink: AutoDreamSink,
  opts: AutoDreamOptions,
): AutoDreamHandle {
  if (!feature('AUTO_DREAM')) {
    return {
      stop: () => undefined,
      tick: async () => ({ ran: false, reason: 'feature-disabled' }),
      isRunning: false,
    };
  }

  const interval = opts.intervalMs ?? 5 * 60_000;
  const minMessages = Math.max(1, opts.minMessages ?? 12);
  const timer = opts.timer ?? { setInterval, clearInterval };

  let running = true;
  let cycleInFlight: Promise<AutoDreamCycleResult> | null = null;

  const tick = async (): Promise<AutoDreamCycleResult> => {
    if (!running) return { ran: false, reason: 'stopped' };
    if (cycleInFlight) return cycleInFlight;
    cycleInFlight = (async () => {
      try {
        const buf = await source.snapshot();
        if (buf.length < minMessages) {
          return { ran: false, reason: 'below-threshold' };
        }
        const next = await summarize(provider, buf, opts);
        if (next.length >= buf.length) {
          return { ran: false, reason: 'no-compression' };
        }
        const note = next[0];
        await source.replace(next);
        await sink.archive(note, { compressedFrom: buf.length, at: Date.now() });
        logger.info('auto-dream.cycle', {
          compressedFrom: buf.length,
          keptRecent: next.length - 1,
        });
        return { ran: true, compressedFrom: buf.length, keptRecent: next.length - 1 };
      } catch (err) {
        logger.warn('auto-dream.cycle.error', {
          error: err instanceof Error ? err.message : String(err),
        });
        return { ran: false, reason: 'error' };
      } finally {
        cycleInFlight = null;
      }
    })();
    return cycleInFlight;
  };

  const handle = timer.setInterval(() => {
    void tick();
  }, interval);

  return {
    stop: () => {
      running = false;
      timer.clearInterval(handle);
    },
    tick,
    get isRunning() {
      return running;
    },
  };
}
