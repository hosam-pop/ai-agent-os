import { execa } from 'execa';
import { logger } from '../../utils/logger.js';

export interface NucleiFinding {
  templateId: string;
  name: string;
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical' | string;
  type: string;
  host: string;
  matchedAt: string;
  tags: string[];
  description?: string;
  reference?: string[];
}

export interface NucleiSummary {
  findings: NucleiFinding[];
  total: number;
  bySeverity: Record<string, number>;
  errors: string[];
}

export interface NucleiRunOptions {
  targets: string[];
  bin?: string;
  templates?: string[];
  severity?: Array<'info' | 'low' | 'medium' | 'high' | 'critical'>;
  rateLimit?: number;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT = 10 * 60_000;

/**
 * Nuclei emits one JSON object per line under `-jsonl`. This parses the
 * stream, accepting both bare `-json` and the newer `-jsonl` shapes.
 */
export function parseNucleiJsonl(stdout: string): NucleiSummary {
  const findings: NucleiFinding[] = [];
  const bySeverity: Record<string, number> = {};
  const errors: string[] = [];

  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!obj || typeof obj !== 'object') continue;
    const r = obj as Record<string, unknown>;
    const info = (r.info as Record<string, unknown> | undefined) ?? {};
    const severity = typeof info.severity === 'string' ? (info.severity as string) : 'info';
    bySeverity[severity] = (bySeverity[severity] ?? 0) + 1;

    findings.push({
      templateId: typeof r['template-id'] === 'string' ? (r['template-id'] as string) : 'unknown',
      name: typeof info.name === 'string' ? (info.name as string) : '',
      severity,
      type: typeof r.type === 'string' ? (r.type as string) : '',
      host: typeof r.host === 'string' ? (r.host as string) : '',
      matchedAt: typeof r['matched-at'] === 'string' ? (r['matched-at'] as string) : '',
      tags: toStringArray(info.tags),
      description: typeof info.description === 'string' ? (info.description as string) : undefined,
      reference: Array.isArray(info.reference)
        ? (info.reference as unknown[]).filter((v): v is string => typeof v === 'string')
        : undefined,
    });
  }

  return { findings, total: findings.length, bySeverity, errors };
}

function toStringArray(value: unknown): string[] {
  if (typeof value === 'string') return value.split(',').map((s) => s.trim()).filter(Boolean);
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  return [];
}

export async function runNuclei(opts: NucleiRunOptions): Promise<NucleiSummary> {
  const bin = opts.bin ?? 'nuclei';
  const args: string[] = ['-jsonl', '-silent', '-disable-update-check'];
  for (const t of opts.targets) args.push('-u', t);
  for (const tpl of opts.templates ?? []) args.push('-t', tpl);
  if (opts.severity && opts.severity.length > 0) args.push('-severity', opts.severity.join(','));
  if (typeof opts.rateLimit === 'number') args.push('-rl', String(opts.rateLimit));

  try {
    const res = await execa(bin, args, {
      timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT,
      reject: false,
      all: false,
    });
    return parseNucleiJsonl(res.stdout ?? '');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn('nuclei.invoke.error', { error: msg });
    return { findings: [], total: 0, bySeverity: {}, errors: [msg] };
  }
}
