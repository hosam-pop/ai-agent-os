import { execa } from 'execa';
import { existsSync } from 'node:fs';
import { logger } from '../../utils/logger.js';

export interface SemgrepFinding {
  ruleId: string;
  severity: 'INFO' | 'WARNING' | 'ERROR' | string;
  path: string;
  line: number;
  endLine: number;
  message: string;
  cwe?: string[];
  owasp?: string[];
  snippet?: string;
}

export interface SemgrepSummary {
  findings: SemgrepFinding[];
  total: number;
  bySeverity: Record<string, number>;
  errors: string[];
}

export interface SemgrepRunOptions {
  target: string;
  config?: string;
  bin?: string;
  timeoutMs?: number;
  include?: string[];
  exclude?: string[];
}

const DEFAULT_CONFIG = 'auto';
const DEFAULT_TIMEOUT = 5 * 60_000;

/**
 * Parse the JSON document Semgrep emits under `semgrep --json`. Keeping this
 * pure so it can be unit-tested without an installed binary.
 */
export function parseSemgrepJson(raw: unknown): SemgrepSummary {
  const findings: SemgrepFinding[] = [];
  const errors: string[] = [];
  const bySeverity: Record<string, number> = {};

  if (!raw || typeof raw !== 'object') {
    return { findings, total: 0, bySeverity, errors: ['semgrep output was empty'] };
  }

  const obj = raw as Record<string, unknown>;
  const results = Array.isArray(obj.results) ? obj.results : [];
  for (const item of results) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const start = (r.start as Record<string, unknown> | undefined) ?? {};
    const end = (r.end as Record<string, unknown> | undefined) ?? {};
    const extra = (r.extra as Record<string, unknown> | undefined) ?? {};
    const metadata = (extra.metadata as Record<string, unknown> | undefined) ?? {};

    const severity = typeof extra.severity === 'string' ? (extra.severity as string) : 'INFO';
    bySeverity[severity] = (bySeverity[severity] ?? 0) + 1;

    findings.push({
      ruleId: typeof r.check_id === 'string' ? r.check_id : 'unknown',
      severity,
      path: typeof r.path === 'string' ? r.path : '',
      line: typeof start.line === 'number' ? start.line : 0,
      endLine: typeof end.line === 'number' ? end.line : 0,
      message: typeof extra.message === 'string' ? (extra.message as string) : '',
      cwe: toStringArray(metadata.cwe),
      owasp: toStringArray(metadata.owasp),
      snippet: typeof extra.lines === 'string' ? (extra.lines as string) : undefined,
    });
  }

  const errList = Array.isArray(obj.errors) ? obj.errors : [];
  for (const e of errList) {
    if (!e || typeof e !== 'object') continue;
    const msg = (e as Record<string, unknown>).message;
    if (typeof msg === 'string') errors.push(msg);
  }

  return { findings, total: findings.length, bySeverity, errors };
}

function toStringArray(value: unknown): string[] | undefined {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string');
  }
  return undefined;
}

export async function runSemgrep(opts: SemgrepRunOptions): Promise<SemgrepSummary> {
  const bin = opts.bin ?? 'semgrep';
  const config = opts.config ?? DEFAULT_CONFIG;
  if (!existsSync(opts.target)) {
    return {
      findings: [],
      total: 0,
      bySeverity: {},
      errors: [`target does not exist: ${opts.target}`],
    };
  }

  const args = ['--json', '--quiet', '--config', config, '--timeout', '120'];
  for (const inc of opts.include ?? []) args.push('--include', inc);
  for (const exc of opts.exclude ?? []) args.push('--exclude', exc);
  args.push(opts.target);

  try {
    const res = await execa(bin, args, {
      timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT,
      reject: false,
      all: true,
      env: { ...process.env, SEMGREP_SEND_METRICS: 'off' },
    });
    if (!res.stdout) {
      return {
        findings: [],
        total: 0,
        bySeverity: {},
        errors: [`semgrep produced no output (exit=${res.exitCode}): ${truncate(res.stderr)}`],
      };
    }
    try {
      const parsed = JSON.parse(res.stdout) as unknown;
      return parseSemgrepJson(parsed);
    } catch (err) {
      return {
        findings: [],
        total: 0,
        bySeverity: {},
        errors: [`failed to parse semgrep JSON: ${err instanceof Error ? err.message : String(err)}`],
      };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn('semgrep.invoke.error', { error: msg });
    return { findings: [], total: 0, bySeverity: {}, errors: [msg] };
  }
}

function truncate(s: string | undefined, max = 400): string {
  if (!s) return '';
  return s.length > max ? s.slice(0, max) + '…' : s;
}
