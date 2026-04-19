import { execa } from 'execa';
import { existsSync } from 'node:fs';
import { logger } from '../../utils/logger.js';

/**
 * Bearer (https://github.com/Bearer/bearer) is a privacy-aware static-analysis
 * tool. Its `scan` subcommand emits a JSON report summarising findings per
 * severity. We parse that report into the same shape the rest of the SAST
 * family uses.
 */

export interface BearerFinding {
  ruleId: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'warning' | string;
  title: string;
  description: string;
  path: string;
  line: number;
  cwe?: string[];
  owasp?: string[];
  snippet?: string;
}

export interface BearerSummary {
  findings: BearerFinding[];
  total: number;
  bySeverity: Record<string, number>;
  errors: string[];
}

export interface BearerRunOptions {
  target: string;
  bin?: string;
  timeoutMs?: number;
  skipPath?: string[];
  rulesConfig?: string;
}

const DEFAULT_TIMEOUT = 10 * 60_000;
const KNOWN_BUCKETS = ['critical', 'high', 'medium', 'low', 'warning'] as const;

export function parseBearerJson(raw: unknown): BearerSummary {
  const findings: BearerFinding[] = [];
  const bySeverity: Record<string, number> = {};
  const errors: string[] = [];

  if (!raw || typeof raw !== 'object') {
    return { findings, total: 0, bySeverity, errors: ['bearer output was empty'] };
  }
  const obj = raw as Record<string, unknown>;

  for (const bucket of KNOWN_BUCKETS) {
    const list = obj[bucket];
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const r = item as Record<string, unknown>;
      const finding: BearerFinding = {
        ruleId: pickString(r, ['id', 'rule_id', 'check_id']) ?? 'unknown',
        severity: bucket,
        title: pickString(r, ['title', 'rule_title', 'name']) ?? '',
        description: pickString(r, ['description', 'message', 'summary']) ?? '',
        path: pickString(r, ['filename', 'path', 'file']) ?? '',
        line: typeof r.line_number === 'number' ? r.line_number : typeof r.line === 'number' ? r.line : 0,
        cwe: coerceStringArray(r.cwe_ids ?? r.cwe),
        owasp: coerceStringArray(r.owasp ?? r.owasp_top_10),
        snippet: pickString(r, ['snippet', 'code_extract']),
      };
      findings.push(finding);
      bySeverity[bucket] = (bySeverity[bucket] ?? 0) + 1;
    }
  }

  const errList = obj.errors ?? obj.error;
  if (Array.isArray(errList)) {
    for (const e of errList) {
      if (typeof e === 'string') errors.push(e);
      else if (e && typeof e === 'object' && typeof (e as Record<string, unknown>).message === 'string') {
        errors.push((e as Record<string, unknown>).message as string);
      }
    }
  } else if (typeof errList === 'string') {
    errors.push(errList);
  }

  return { findings, total: findings.length, bySeverity, errors };
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

function coerceStringArray(value: unknown): string[] | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) {
    const out = value
      .map((v) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null))
      .filter((v): v is string => typeof v === 'string' && v.length > 0);
    return out.length > 0 ? out : undefined;
  }
  return undefined;
}

export async function runBearer(opts: BearerRunOptions): Promise<BearerSummary> {
  const bin = opts.bin ?? 'bearer';
  if (!existsSync(opts.target)) {
    return {
      findings: [],
      total: 0,
      bySeverity: {},
      errors: [`target does not exist: ${opts.target}`],
    };
  }

  const args = ['scan', opts.target, '--format', 'json', '--quiet'];
  if (opts.rulesConfig) args.push('--config-file', opts.rulesConfig);
  for (const sp of opts.skipPath ?? []) args.push('--skip-path', sp);

  try {
    const res = await execa(bin, args, {
      timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT,
      reject: false,
      env: { ...process.env, NO_COLOR: '1' },
    });
    if (!res.stdout) {
      return {
        findings: [],
        total: 0,
        bySeverity: {},
        errors: [`bearer produced no output (exit=${res.exitCode}): ${truncate(res.stderr)}`],
      };
    }
    try {
      const parsed = JSON.parse(res.stdout) as unknown;
      return parseBearerJson(parsed);
    } catch (err) {
      return {
        findings: [],
        total: 0,
        bySeverity: {},
        errors: [`failed to parse bearer JSON: ${err instanceof Error ? err.message : String(err)}`],
      };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn('bearer.invoke.error', { error: msg });
    return { findings: [], total: 0, bySeverity: {}, errors: [msg] };
  }
}

function truncate(s: string | undefined, max = 400): string {
  if (!s) return '';
  return s.length > max ? s.slice(0, max) + '…' : s;
}
