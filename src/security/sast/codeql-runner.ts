import { execa } from 'execa';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { logger } from '../../utils/logger.js';

export interface CodeqlFinding {
  ruleId: string;
  level: 'note' | 'warning' | 'error' | string;
  message: string;
  path: string;
  line: number;
  tags: string[];
}

export interface CodeqlSummary {
  findings: CodeqlFinding[];
  total: number;
  byLevel: Record<string, number>;
  errors: string[];
}

export interface CodeqlRunOptions {
  database: string;
  querySuite?: string;
  bin?: string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT = 30 * 60_000;

/**
 * Parse the SARIF document CodeQL emits. Extracts only what the agent
 * usefully consumes; keeps the rest of SARIF out of the prompt surface.
 */
export function parseCodeqlSarif(raw: unknown): CodeqlSummary {
  const findings: CodeqlFinding[] = [];
  const errors: string[] = [];
  const byLevel: Record<string, number> = {};

  if (!raw || typeof raw !== 'object') {
    return { findings, total: 0, byLevel, errors: ['codeql output was empty'] };
  }

  const runs = (raw as Record<string, unknown>).runs;
  if (!Array.isArray(runs)) {
    return { findings, total: 0, byLevel, errors: ['missing "runs" in SARIF'] };
  }

  for (const runValue of runs) {
    if (!runValue || typeof runValue !== 'object') continue;
    const run = runValue as Record<string, unknown>;
    const results = Array.isArray(run.results) ? run.results : [];
    const ruleIndex = buildRuleIndex(run);

    for (const item of results) {
      if (!item || typeof item !== 'object') continue;
      const r = item as Record<string, unknown>;
      const ruleId = typeof r.ruleId === 'string' ? r.ruleId : 'unknown';
      const rule = ruleIndex.get(ruleId);
      const level = typeof r.level === 'string' ? (r.level as string) : rule?.defaultLevel ?? 'note';
      byLevel[level] = (byLevel[level] ?? 0) + 1;

      const msgValue = (r.message as Record<string, unknown> | undefined)?.text;
      const locs = Array.isArray(r.locations) ? (r.locations as unknown[]) : [];
      const firstLoc = locs[0] as Record<string, unknown> | undefined;
      const physical = firstLoc?.physicalLocation as Record<string, unknown> | undefined;
      const artifact = physical?.artifactLocation as Record<string, unknown> | undefined;
      const region = physical?.region as Record<string, unknown> | undefined;

      findings.push({
        ruleId,
        level,
        message: typeof msgValue === 'string' ? msgValue : '',
        path: typeof artifact?.uri === 'string' ? (artifact.uri as string) : '',
        line: typeof region?.startLine === 'number' ? (region.startLine as number) : 0,
        tags: rule?.tags ?? [],
      });
    }
  }

  return { findings, total: findings.length, byLevel, errors };
}

interface RuleMeta {
  defaultLevel: string;
  tags: string[];
}

function buildRuleIndex(run: Record<string, unknown>): Map<string, RuleMeta> {
  const map = new Map<string, RuleMeta>();
  const tool = run.tool as Record<string, unknown> | undefined;
  const driver = tool?.driver as Record<string, unknown> | undefined;
  const rules = driver?.rules;
  if (!Array.isArray(rules)) return map;
  for (const rule of rules) {
    if (!rule || typeof rule !== 'object') continue;
    const r = rule as Record<string, unknown>;
    const id = typeof r.id === 'string' ? r.id : undefined;
    if (!id) continue;
    const defaults = (r.defaultConfiguration as Record<string, unknown> | undefined) ?? {};
    const properties = (r.properties as Record<string, unknown> | undefined) ?? {};
    const tags = Array.isArray(properties.tags)
      ? (properties.tags as unknown[]).filter((v): v is string => typeof v === 'string')
      : [];
    map.set(id, {
      defaultLevel: typeof defaults.level === 'string' ? (defaults.level as string) : 'note',
      tags,
    });
  }
  return map;
}

export async function runCodeql(opts: CodeqlRunOptions): Promise<CodeqlSummary> {
  const bin = opts.bin ?? 'codeql';
  if (!existsSync(opts.database)) {
    return {
      findings: [],
      total: 0,
      byLevel: {},
      errors: [`codeql database does not exist: ${opts.database}`],
    };
  }
  const suite = opts.querySuite ?? defaultSuiteFor(opts.database);
  const outDir = mkdtempSync(join(tmpdir(), 'codeql-'));
  const sarifPath = join(outDir, 'results.sarif');

  try {
    const res = await execa(
      bin,
      ['database', 'analyze', opts.database, suite, '--format=sarif-latest', '--output', sarifPath],
      {
        timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT,
        reject: false,
        all: true,
      },
    );
    if (!existsSync(sarifPath)) {
      return {
        findings: [],
        total: 0,
        byLevel: {},
        errors: [`codeql produced no SARIF (exit=${res.exitCode}): ${truncate(res.stderr)}`],
      };
    }
    const sarif = JSON.parse(readFileSync(sarifPath, 'utf-8')) as unknown;
    return parseCodeqlSarif(sarif);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn('codeql.invoke.error', { error: msg });
    return { findings: [], total: 0, byLevel: {}, errors: [msg] };
  }
}

function defaultSuiteFor(databasePath: string): string {
  const lower = databasePath.toLowerCase();
  if (lower.includes('javascript') || lower.includes('typescript')) {
    return 'javascript-security-and-quality.qls';
  }
  if (lower.includes('python')) return 'python-security-and-quality.qls';
  if (lower.includes('go')) return 'go-security-and-quality.qls';
  if (lower.includes('java')) return 'java-security-and-quality.qls';
  if (lower.includes('csharp')) return 'csharp-security-and-quality.qls';
  return 'javascript-security-and-quality.qls';
}

function truncate(s: string | undefined, max = 400): string {
  if (!s) return '';
  return s.length > max ? s.slice(0, max) + '…' : s;
}
