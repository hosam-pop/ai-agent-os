import { execa } from 'execa';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { logger } from '../../utils/logger.js';

export interface ZapAlert {
  name: string;
  riskdesc: string;
  confidence: string;
  description: string;
  solution?: string;
  reference?: string;
  cweid?: string;
  wascid?: string;
  pluginid?: string;
  instances: Array<{ uri: string; method: string; evidence?: string }>;
}

export interface ZapSummary {
  alerts: ZapAlert[];
  total: number;
  byRisk: Record<string, number>;
  errors: string[];
}

export interface ZapRunOptions {
  target: string;
  bin?: string;
  mode?: 'baseline' | 'full';
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT = 20 * 60_000;

/**
 * Parse a ZAP JSON report as produced by `zap.sh -cmd -autorun ...` or the
 * `zap-baseline.py -J` flag. Accepts either the traditional {site:[{alerts}]}
 * shape or the flat {alerts:[]} shape from the newer automation framework.
 */
export function parseZapJson(raw: unknown): ZapSummary {
  const alerts: ZapAlert[] = [];
  const byRisk: Record<string, number> = {};

  if (!raw || typeof raw !== 'object') {
    return { alerts, total: 0, byRisk, errors: ['zap output was empty'] };
  }

  const obj = raw as Record<string, unknown>;
  const raw1 = Array.isArray(obj.site) ? (obj.site as unknown[]) : [];
  if (raw1.length > 0) {
    for (const site of raw1) {
      if (!site || typeof site !== 'object') continue;
      const s = site as Record<string, unknown>;
      const list = Array.isArray(s.alerts) ? (s.alerts as unknown[]) : [];
      for (const a of list) alerts.push(...[toAlert(a)].filter(isAlert));
    }
  } else if (Array.isArray(obj.alerts)) {
    for (const a of obj.alerts) alerts.push(...[toAlert(a)].filter(isAlert));
  }

  for (const a of alerts) {
    const key = a.riskdesc || 'unknown';
    byRisk[key] = (byRisk[key] ?? 0) + 1;
  }
  return { alerts, total: alerts.length, byRisk, errors: [] };
}

function isAlert(a: ZapAlert | null): a is ZapAlert {
  return a !== null;
}

function toAlert(raw: unknown): ZapAlert | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const instances = Array.isArray(r.instances)
    ? (r.instances as unknown[]).map((it) => {
        const item = (it as Record<string, unknown>) ?? {};
        return {
          uri: typeof item.uri === 'string' ? item.uri : '',
          method: typeof item.method === 'string' ? item.method : '',
          evidence: typeof item.evidence === 'string' ? item.evidence : undefined,
        };
      })
    : [];
  return {
    name: typeof r.name === 'string' ? r.name : typeof r.alert === 'string' ? r.alert : '',
    riskdesc: typeof r.riskdesc === 'string' ? r.riskdesc : typeof r.risk === 'string' ? r.risk : '',
    confidence: typeof r.confidence === 'string' ? r.confidence : '',
    description: typeof r.description === 'string' ? r.description : '',
    solution: typeof r.solution === 'string' ? r.solution : undefined,
    reference: typeof r.reference === 'string' ? r.reference : undefined,
    cweid: typeof r.cweid === 'string' ? r.cweid : undefined,
    wascid: typeof r.wascid === 'string' ? r.wascid : undefined,
    pluginid: typeof r.pluginid === 'string' ? r.pluginid : undefined,
    instances,
  };
}

export async function runZapBaseline(opts: ZapRunOptions): Promise<ZapSummary> {
  const bin = opts.bin ?? 'zap-baseline.py';
  const outDir = mkdtempSync(join(tmpdir(), 'zap-'));
  const reportPath = join(outDir, 'report.json');

  const args = ['-t', opts.target, '-J', 'report.json', '-w', '/dev/null'];

  try {
    const res = await execa(bin, args, {
      timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT,
      reject: false,
      all: true,
      cwd: outDir,
      env: { ...process.env, ZAP_CLI_EXECUTOR: 'baseline' },
    });
    if (!existsSync(reportPath)) {
      return {
        alerts: [],
        total: 0,
        byRisk: {},
        errors: [`zap produced no report (exit=${res.exitCode}): ${truncate(res.stderr)}`],
      };
    }
    const parsed = JSON.parse(readFileSync(reportPath, 'utf-8')) as unknown;
    return parseZapJson(parsed);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn('zap.invoke.error', { error: msg });
    return { alerts: [], total: 0, byRisk: {}, errors: [msg] };
  }
}

function truncate(s: string | undefined, max = 400): string {
  if (!s) return '';
  return s.length > max ? s.slice(0, max) + '…' : s;
}
