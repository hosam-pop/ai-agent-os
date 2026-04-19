import { createReadStream, existsSync, statSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { logger } from '../../utils/logger.js';

export interface SuricataAlert {
  timestamp: string;
  eventType: string;
  signature: string;
  signatureId: number;
  category: string;
  severity: number;
  srcIp: string;
  destIp: string;
  srcPort?: number;
  destPort?: number;
  protocol?: string;
  raw: Record<string, unknown>;
}

export interface SuricataSummary {
  total: number;
  alerts: SuricataAlert[];
  bySeverity: Record<string, number>;
  byCategory: Record<string, number>;
  errors: string[];
}

export interface SuricataReadOptions {
  path: string;
  minSeverity?: number;
  category?: string;
  eventType?: string;
  limit?: number;
  maxBytes?: number;
}

const DEFAULT_LIMIT = 200;
const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;

/**
 * Stream-read an eve.json file, filter alerts, and return a bounded summary.
 * Designed for large log files: we stop after `limit` matches or `maxBytes`.
 */
export async function readSuricataEve(opts: SuricataReadOptions): Promise<SuricataSummary> {
  const { path } = opts;
  if (!existsSync(path)) {
    return emptySummary([`eve.json not found: ${path}`]);
  }
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const fileSize = statSync(path).size;
  const offset = Math.max(0, fileSize - maxBytes);

  const stream = createReadStream(path, { encoding: 'utf-8', start: offset });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  const alerts: SuricataAlert[] = [];
  const bySeverity: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  const errors: string[] = [];

  try {
    for await (const line of rl) {
      if (alerts.length >= limit) break;
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('{')) continue;
      let obj: unknown;
      try {
        obj = JSON.parse(trimmed);
      } catch {
        continue;
      }
      const alert = toAlert(obj);
      if (!alert) continue;
      if (opts.eventType && alert.eventType !== opts.eventType) continue;
      if (opts.category && alert.category !== opts.category) continue;
      if (typeof opts.minSeverity === 'number' && alert.severity > opts.minSeverity) continue;
      alerts.push(alert);
      bySeverity[String(alert.severity)] = (bySeverity[String(alert.severity)] ?? 0) + 1;
      if (alert.category) byCategory[alert.category] = (byCategory[alert.category] ?? 0) + 1;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn('suricata.read.error', { error: msg });
    errors.push(msg);
  } finally {
    rl.close();
    stream.close();
  }

  return { total: alerts.length, alerts, bySeverity, byCategory, errors };
}

function toAlert(raw: unknown): SuricataAlert | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const eventType = typeof r.event_type === 'string' ? (r.event_type as string) : '';
  if (eventType !== 'alert') return null;
  const a = (r.alert as Record<string, unknown> | undefined) ?? {};
  return {
    timestamp: typeof r.timestamp === 'string' ? (r.timestamp as string) : '',
    eventType,
    signature: typeof a.signature === 'string' ? (a.signature as string) : '',
    signatureId: typeof a.signature_id === 'number' ? (a.signature_id as number) : 0,
    category: typeof a.category === 'string' ? (a.category as string) : '',
    severity: typeof a.severity === 'number' ? (a.severity as number) : 0,
    srcIp: typeof r.src_ip === 'string' ? (r.src_ip as string) : '',
    destIp: typeof r.dest_ip === 'string' ? (r.dest_ip as string) : '',
    srcPort: typeof r.src_port === 'number' ? (r.src_port as number) : undefined,
    destPort: typeof r.dest_port === 'number' ? (r.dest_port as number) : undefined,
    protocol: typeof r.proto === 'string' ? (r.proto as string) : undefined,
    raw: r,
  };
}

function emptySummary(errors: string[]): SuricataSummary {
  return { total: 0, alerts: [], bySeverity: {}, byCategory: {}, errors };
}
