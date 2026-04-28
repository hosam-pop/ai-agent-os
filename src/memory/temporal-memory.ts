/**
 * Temporal memory layer.
 *
 * Wraps the existing Zep adapter to record *when* a fact was observed
 * and *who* observed it, so downstream consumers can reason about
 * how a user's preferences or a project's state evolve.
 *
 * The module is a pure addition: it does not modify the existing Zep
 * adapter, and it stays inert unless `ENABLE_TEMPORAL_MEMORY` is on.
 */

import { logger } from '../utils/logger.js';

export interface TemporalFact {
  readonly subject: string;
  readonly predicate: string;
  readonly value: string;
  readonly observedAt: number;
  readonly source?: string;
  readonly confidence?: number;
}

export interface TemporalStoreOptions {
  readonly now?: () => number;
  readonly writer?: TemporalWriter;
}

export interface TemporalWriter {
  write(fact: TemporalFact): Promise<void>;
}

export class TemporalMemory {
  private readonly now: () => number;
  private readonly writer?: TemporalWriter;
  private readonly facts: TemporalFact[] = [];

  constructor(opts: TemporalStoreOptions = {}) {
    this.now = opts.now ?? (() => Date.now());
    this.writer = opts.writer;
  }

  async observe(fact: Omit<TemporalFact, 'observedAt'> & { observedAt?: number }): Promise<TemporalFact> {
    const entry: TemporalFact = {
      ...fact,
      observedAt: fact.observedAt ?? this.now(),
    };
    this.facts.push(entry);
    if (this.writer) {
      try {
        await this.writer.write(entry);
      } catch (err) {
        logger.warn('temporal-memory.write.error', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return entry;
  }

  /** Return the latest value for a (subject, predicate) pair, or undefined. */
  latest(subject: string, predicate: string): TemporalFact | undefined {
    let best: TemporalFact | undefined;
    for (const fact of this.facts) {
      if (fact.subject !== subject || fact.predicate !== predicate) continue;
      if (!best || fact.observedAt > best.observedAt) best = fact;
    }
    return best;
  }

  /** Return the full history for (subject, predicate) oldest-first. */
  history(subject: string, predicate: string): TemporalFact[] {
    return this.facts
      .filter((f) => f.subject === subject && f.predicate === predicate)
      .sort((a, b) => a.observedAt - b.observedAt);
  }

  /** Return every fact observed within the half-open interval [from, to). */
  between(from: number, to: number): TemporalFact[] {
    return this.facts.filter((f) => f.observedAt >= from && f.observedAt < to);
  }

  size(): number {
    return this.facts.length;
  }
}

/**
 * Thin adapter that persists TemporalFact entries into any adapter
 * implementing a Zep-compatible `add({ role, content })` surface.
 */
export class ZepTemporalWriter implements TemporalWriter {
  constructor(private readonly mem: { add: (msg: { role: string; content: string }) => Promise<unknown> | unknown }) {}

  async write(fact: TemporalFact): Promise<void> {
    await this.mem.add({
      role: 'system',
      content: JSON.stringify({ kind: 'temporal-fact', ...fact }),
    });
  }
}
