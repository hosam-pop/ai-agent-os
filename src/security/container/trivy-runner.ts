import { execa } from 'execa';
import { logger } from '../../utils/logger.js';
import type { ContainerScanSummary, ContainerVuln } from './grype-runner.js';

/**
 * Trivy (https://github.com/aquasecurity/trivy) can scan container images,
 * filesystems, and git repos. We cover the image / fs / repo modes and
 * parse the common `Results[].Vulnerabilities[]` shape.
 */

export type TrivyMode = 'image' | 'fs' | 'repo';

export interface TrivyRunOptions {
  target: string;
  mode?: TrivyMode;
  bin?: string;
  severity?: string[];
  ignoreUnfixed?: boolean;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT = 10 * 60_000;

export function parseTrivyJson(raw: unknown, target: string): ContainerScanSummary {
  const vulns: ContainerVuln[] = [];
  const bySeverity: Record<string, number> = {};
  const errors: string[] = [];

  if (!raw || typeof raw !== 'object') {
    return {
      engine: 'trivy',
      target,
      vulns,
      total: 0,
      bySeverity,
      errors: ['trivy output was empty'],
    };
  }
  const obj = raw as Record<string, unknown>;
  const results = Array.isArray(obj.Results) ? obj.Results : [];
  for (const result of results) {
    if (!result || typeof result !== 'object') continue;
    const r = result as Record<string, unknown>;
    const list = Array.isArray(r.Vulnerabilities) ? r.Vulnerabilities : [];
    const localTarget = typeof r.Target === 'string' ? r.Target : target;
    for (const v of list) {
      if (!v || typeof v !== 'object') continue;
      const item = v as Record<string, unknown>;
      const severity = typeof item.Severity === 'string' ? item.Severity : 'UNKNOWN';
      bySeverity[severity] = (bySeverity[severity] ?? 0) + 1;
      const urls: string[] = [];
      if (typeof item.PrimaryURL === 'string') urls.push(item.PrimaryURL);
      if (Array.isArray(item.References)) {
        for (const u of item.References) {
          if (typeof u === 'string') urls.push(u);
        }
      }
      const cvssMap = (item.CVSS as Record<string, unknown> | undefined) ?? {};
      let highest: number | undefined;
      for (const entry of Object.values(cvssMap)) {
        if (!entry || typeof entry !== 'object') continue;
        const e = entry as Record<string, unknown>;
        for (const key of ['V3Score', 'V2Score'] as const) {
          const val = e[key];
          if (typeof val === 'number') {
            highest = highest === undefined ? val : Math.max(highest, val);
          }
        }
      }
      vulns.push({
        id: typeof item.VulnerabilityID === 'string' ? item.VulnerabilityID : 'unknown',
        severity,
        package: typeof item.PkgName === 'string' ? item.PkgName : 'unknown',
        version: typeof item.InstalledVersion === 'string' ? item.InstalledVersion : 'unknown',
        fixedIn: typeof item.FixedVersion === 'string' ? item.FixedVersion : undefined,
        target: localTarget,
        description: typeof item.Description === 'string' ? item.Description : undefined,
        cvss: highest,
        urls: urls.length > 0 ? urls : undefined,
      });
    }
  }

  return {
    engine: 'trivy',
    target,
    vulns,
    total: vulns.length,
    bySeverity,
    errors,
  };
}

export async function runTrivy(opts: TrivyRunOptions): Promise<ContainerScanSummary> {
  const bin = opts.bin ?? 'trivy';
  const mode: TrivyMode = opts.mode ?? 'image';
  const args = [mode, '--quiet', '--format', 'json', '--timeout', '5m'];
  if (opts.severity && opts.severity.length > 0) args.push('--severity', opts.severity.join(','));
  if (opts.ignoreUnfixed) args.push('--ignore-unfixed');
  args.push(opts.target);

  try {
    const res = await execa(bin, args, {
      timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT,
      reject: false,
      env: { ...process.env, TRIVY_DISABLE_VEX_NOTICE: 'true' },
    });
    if (!res.stdout) {
      return {
        engine: 'trivy',
        target: opts.target,
        vulns: [],
        total: 0,
        bySeverity: {},
        errors: [`trivy produced no output (exit=${res.exitCode}): ${truncate(res.stderr)}`],
      };
    }
    try {
      const parsed = JSON.parse(res.stdout) as unknown;
      return parseTrivyJson(parsed, opts.target);
    } catch (err) {
      return {
        engine: 'trivy',
        target: opts.target,
        vulns: [],
        total: 0,
        bySeverity: {},
        errors: [`failed to parse trivy JSON: ${err instanceof Error ? err.message : String(err)}`],
      };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn('trivy.invoke.error', { error: msg });
    return {
      engine: 'trivy',
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
