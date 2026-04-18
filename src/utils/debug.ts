import { logger } from './logger.js';

export interface TraceSpan {
  id: string;
  name: string;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  meta?: Record<string, unknown>;
  error?: string;
}

const spans: TraceSpan[] = [];

function makeId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function startSpan(name: string, meta?: Record<string, unknown>): TraceSpan {
  const span: TraceSpan = { id: makeId(), name, startedAt: Date.now(), meta };
  spans.push(span);
  logger.debug(`span.start ${name}`, { id: span.id, ...meta });
  return span;
}

export function endSpan(span: TraceSpan, error?: unknown): TraceSpan {
  span.endedAt = Date.now();
  span.durationMs = span.endedAt - span.startedAt;
  if (error) span.error = error instanceof Error ? error.message : String(error);
  logger.debug(`span.end ${span.name}`, {
    id: span.id,
    durationMs: span.durationMs,
    error: span.error,
  });
  return span;
}

export async function withSpan<T>(
  name: string,
  fn: () => Promise<T>,
  meta?: Record<string, unknown>,
): Promise<T> {
  const span = startSpan(name, meta);
  try {
    const result = await fn();
    endSpan(span);
    return result;
  } catch (err) {
    endSpan(span, err);
    throw err;
  }
}

export function snapshotTrace(): TraceSpan[] {
  return spans.map((s) => ({ ...s }));
}

export function clearTrace(): void {
  spans.length = 0;
}
