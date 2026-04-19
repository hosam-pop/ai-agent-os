import { execa } from 'execa';
import { logger } from '../../utils/logger.js';

/**
 * Grype (https://github.com/anchore/grype) is a vulnerability scanner for
 * container images, SBOMs, and filesystems. `grype <target> -o json` emits
 * a report with a top-level `matches` array. We normalise each match into
 * a {@link ContainerVuln}.
 */

export interface ContainerVuln {
  id: string;
  severity: string;
  package: string;
  version: string;
  fixedIn?: string;
  target: string;
  description?: string;
  cvss?: number;
  urls?: string[];
}

export interface ContainerScanSummary {
  engine: 'grype' | 'trivy';
  target: string;
  vulns: ContainerVuln[];
  total: number;
  bySeverity: Record<string, number>;
  errors: string[];
}

export interface GrypeRunOptions {
  target: string;
  bin?: string;
  scope?: 'squashed' | 'all-layers';
  minSeverity?: string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT = 10 * 60_000;

export function parseGrypeJson(raw: unknown, target: string): ContainerScanSummary {
  const vulns: ContainerVuln[] = [];
  const bySeverity: Record<string, number> = {};
  const errors: string[] = [];

  if (!raw || typeof raw !== 'object') {
    return {
      engine: 'grype',
      target,
      vulns,
      total: 0,
      bySeverity,
      errors: ['grype output was empty'],
    };
  }
  const obj = raw as Record<string, unknown>;
  const matches = Array.isArray(obj.matches) ? obj.matches : [];
  for (const item of matches) {
    if (!item || typeof item !== 'object') continue;
    const m = item as Record<string, unknown>;
    const vuln = (m.vulnerability as Record<string, unknown> | undefined) ?? {};
    const artifact = (m.artifact as Record<string, unknown> | undefined) ?? {};
    const fix = (vuln.fix as Record<string, unknown> | undefined) ?? {};
    const cvssEntries = Array.isArray(vuln.cvss) ? (vuln.cvss as unknown[]) : [];
    const highestCvss = extractHighestCvss(cvssEntries);
    const urls = Array.isArray(vuln.urls)
      ? (vuln.urls as unknown[]).filter((u): u is string => typeof u === 'string')
      : undefined;
    const severity = typeof vuln.severity === 'string' ? vuln.severity : 'Unknown';
    bySeverity[severity] = (bySeverity[severity] ?? 0) + 1;

    const fixedVersions = Array.isArray(fix.versions)
      ? (fix.versions as unknown[]).filter((v): v is string => typeof v === 'string')
      : [];
    vulns.push({
      id: typeof vuln.id === 'string' ? vuln.id : 'unknown',
      severity,
      package: typeof artifact.name === 'string' ? artifact.name : 'unknown',
      version: typeof artifact.version === 'string' ? artifact.version : 'unknown',
      fixedIn: fixedVersions[0],
      target,
      description: typeof vuln.description === 'string' ? vuln.description : undefined,
      cvss: highestCvss,
      urls,
    });
  }

  const errList = obj.errors;
  if (Array.isArray(errList)) {
    for (const e of errList) {
      if (typeof e === 'string') errors.push(e);
    }
  }

  return {
    engine: 'grype',
    target,
    vulns,
    total: vulns.length,
    bySeverity,
    errors,
  };
}

function extractHighestCvss(entries: unknown[]): number | undefined {
  let best: number | undefined;
  for (const e of entries) {
    if (!e || typeof e !== 'object') continue;
    const metrics = ((e as Record<string, unknown>).metrics as Record<string, unknown> | undefined) ?? {};
    const score = metrics.baseScore;
    if (typeof score === 'number') {
      best = best === undefined ? score : Math.max(best, score);
    }
  }
  return best;
}

export async function runGrype(opts: GrypeRunOptions): Promise<ContainerScanSummary> {
  const bin = opts.bin ?? 'grype';
  const args = [opts.target, '-o', 'json'];
  if (opts.scope) args.push('--scope', opts.scope);
  if (opts.minSeverity) args.push('--fail-on', opts.minSeverity);

  try {
    const res = await execa(bin, args, {
      timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT,
      reject: false,
      env: { ...process.env, GRYPE_CHECK_FOR_APP_UPDATE: 'false' },
    });
    if (!res.stdout) {
      return {
        engine: 'grype',
        target: opts.target,
        vulns: [],
        total: 0,
        bySeverity: {},
        errors: [`grype produced no output (exit=${res.exitCode}): ${truncate(res.stderr)}`],
      };
    }
    try {
      const parsed = JSON.parse(res.stdout) as unknown;
      return parseGrypeJson(parsed, opts.target);
    } catch (err) {
      return {
        engine: 'grype',
        target: opts.target,
        vulns: [],
        total: 0,
        bySeverity: {},
        errors: [`failed to parse grype JSON: ${err instanceof Error ? err.message : String(err)}`],
      };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn('grype.invoke.error', { error: msg });
    return {
      engine: 'grype',
      target: opts.target,
      vulns: [],
      total: 0,
      bySeverity: {},
      errors: [msg],
    };
  }
}

function truncate(s: string | undefined, max = 400): string {
  if (!s) return '';
  return s.length > max ? s.slice(0, max) + '…' : s;
}
