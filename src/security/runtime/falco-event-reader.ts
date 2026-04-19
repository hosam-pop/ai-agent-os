import { open, stat } from 'node:fs/promises';
import { logger } from '../../utils/logger.js';

/**
 * Falco (https://github.com/falcosecurity/falco) emits one JSON event per
 * line when configured with `json_output: true`. This module reads the
 * tail of a Falco output file (default `/var/log/falco/falco.json`) and
 * returns a bounded, filterable summary of events.
 *
 * The reader never tails forever — it reads up to `maxBytes` from the end
 * of the file once, to stay safe as an agent tool. For true streaming use
 * Falco's gRPC interface separately.
 */

export interface FalcoEvent {
  time: string;
  rule: string;
  priority: FalcoPriority | string;
  source: string;
  message: string;
  tags?: string[];
  outputFields?: Record<string, unknown>;
  hostname?: string;
}

export type FalcoPriority =
  | 'Emergency'
  | 'Alert'
  | 'Critical'
  | 'Error'
  | 'Warning'
  | 'Notice'
  | 'Informational'
  | 'Debug';

export interface FalcoSummary {
  events: FalcoEvent[];
  total: number;
  byPriority: Record<string, number>;
  byRule: Record<string, number>;
  errors: string[];
  truncated: boolean;
}

export interface FalcoReadOptions {
  path: string;
  limit?: number;
  minPriority?: FalcoPriority | string;
  rule?: string;
  tag?: string;
  source?: string;
  maxBytes?: number;
}

const DEFAULT_LIMIT = 200;
const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;
const PRIORITY_ORDER: Record<string, number> = {
  Emergency: 0,
  Alert: 1,
  Critical: 2,
  Error: 3,
  Warning: 4,
  Notice: 5,
  Informational: 6,
  Debug: 7,
};

export async function readFalcoEvents(opts: FalcoReadOptions): Promise<FalcoSummary> {
  const empty = (errors: string[]): FalcoSummary => ({
    events: [],
    total: 0,
    byPriority: {},
    byRule: {},
    errors,
    truncated: false,
  });

  let size: number;
  try {
    const s = await stat(opts.path);
    size = s.size;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('ENOENT')) return empty([`falco output not found: ${opts.path}`]);
    logger.warn('falco.stat.error', { error: msg });
    return empty([msg]);
  }

  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const start = size > maxBytes ? size - maxBytes : 0;
  const truncated = start > 0;
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const minRank = opts.minPriority ? PRIORITY_ORDER[opts.minPriority] ?? Number.POSITIVE_INFINITY : Number.POSITIVE_INFINITY;

  const handle = await open(opts.path, 'r');
  const events: FalcoEvent[] = [];
  const byPriority: Record<string, number> = {};
  const byRule: Record<string, number> = {};
  const errors: string[] = [];
  let buffer = '';

  try {
    const stream = handle.createReadStream({ start, encoding: 'utf8' });
    for await (const chunk of stream) {
      buffer += chunk;
      let nl = buffer.indexOf('\n');
      while (nl !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        nl = buffer.indexOf('\n');
        if (!line) continue;
        const parsed = safeJson(line);
        if (!parsed || typeof parsed !== 'object') continue;
        const event = normaliseEvent(parsed as Record<string, unknown>);
        if (!event) continue;
        if (!passesFilters(event, opts, minRank)) continue;
        events.push(event);
        byPriority[event.priority] = (byPriority[event.priority] ?? 0) + 1;
        byRule[event.rule] = (byRule[event.rule] ?? 0) + 1;
        if (events.length >= limit) {
          return { events, total: events.length, byPriority, byRule, errors, truncated };
        }
      }
    }
  } finally {
    await handle.close();
  }

  return { events, total: events.length, byPriority, byRule, errors, truncated };
}

function normaliseEvent(raw: Record<string, unknown>): FalcoEvent | undefined {
  const rule = typeof raw.rule === 'string' ? raw.rule : undefined;
  if (!rule) return undefined;
  const priority = typeof raw.priority === 'string' ? raw.priority : 'Notice';
  const time = typeof raw.time === 'string' ? raw.time : new Date().toISOString();
  const source = typeof raw.source === 'string' ? raw.source : 'syscall';
  const message = typeof raw.output === 'string' ? raw.output : '';
  const tags = Array.isArray(raw.tags)
    ? (raw.tags as unknown[]).filter((t): t is string => typeof t === 'string')
    : undefined;
  const outputFields =
    raw.output_fields && typeof raw.output_fields === 'object'
      ? (raw.output_fields as Record<string, unknown>)
      : undefined;
  const hostname = typeof raw.hostname === 'string' ? raw.hostname : undefined;
  return { time, rule, priority, source, message, tags, outputFields, hostname };
}

function passesFilters(event: FalcoEvent, opts: FalcoReadOptions, minRank: number): boolean {
  if (opts.rule && event.rule !== opts.rule) return false;
  if (opts.source && event.source !== opts.source) return false;
  if (opts.tag && !(event.tags ?? []).includes(opts.tag)) return false;
  const rank = PRIORITY_ORDER[event.priority];
  if (minRank !== Number.POSITIVE_INFINITY && (rank === undefined || rank > minRank)) return false;
  return true;
}

function safeJson(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}
