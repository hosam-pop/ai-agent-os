/**
 * OSV.dev (https://osv.dev) is Google's open vulnerability database. It is
 * free, public, and requires no authentication, making it ideal as the first
 * threat-intel source for the agent. This module provides a pure parser for
 * OSV's /v1/query and /v1/vulns/{id} responses plus a thin HTTP client.
 *
 * Pattern mirrors src/security/container/*: pure parsers first, I/O-wrapped
 * client second, both soft-fail.
 */

export type Ecosystem =
  | 'npm'
  | 'PyPI'
  | 'Go'
  | 'Maven'
  | 'crates.io'
  | 'RubyGems'
  | 'NuGet'
  | 'Packagist'
  | 'Pub'
  | 'Hex'
  | string;

export interface OsvVulnerability {
  readonly id: string;
  readonly summary?: string;
  readonly details?: string;
  readonly aliases: string[];
  readonly published?: string;
  readonly modified?: string;
  readonly severity: string;
  readonly cvss?: number;
  readonly references: string[];
  readonly affectedPackage?: string;
  readonly affectedEcosystem?: string;
  readonly fixedVersions: string[];
  readonly introducedVersions: string[];
}

export interface OsvQuerySummary {
  readonly vulns: OsvVulnerability[];
  readonly total: number;
  readonly bySeverity: Record<string, number>;
  readonly byEcosystem: Record<string, number>;
  readonly errors: string[];
}

export interface OsvQueryRequest {
  /** Package + ecosystem lookup. */
  readonly package?: { name: string; ecosystem: Ecosystem };
  /** Version at which the package is being used. OSV filters matches by this. */
  readonly version?: string;
  /** Commit sha lookup (source-level). */
  readonly commit?: string;
}

export interface OsvClientOptions {
  /** Override the OSV endpoint (default `https://api.osv.dev`). */
  baseUrl?: string;
  /** Millisecond request timeout (default 15_000). */
  timeoutMs?: number;
  /** Override for tests. */
  fetchImpl?: typeof fetch;
}

/**
 * Parse an OSV /v1/query response (vulns array) into a normalised summary.
 * Pure, never throws, tolerates partial data, unknown severities, and
 * missing fields.
 */
export function parseOsvQuery(raw: unknown): OsvQuerySummary {
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object') {
    return { vulns: [], total: 0, bySeverity: {}, byEcosystem: {}, errors: ['osv: non-object response'] };
  }
  const body = raw as Record<string, unknown>;
  const rawVulns = body.vulns;
  if (!Array.isArray(rawVulns)) {
    return { vulns: [], total: 0, bySeverity: {}, byEcosystem: {}, errors };
  }
  const vulns: OsvVulnerability[] = [];
  const bySeverity: Record<string, number> = {};
  const byEcosystem: Record<string, number> = {};
  for (const entry of rawVulns) {
    if (!entry || typeof entry !== 'object') continue;
    const parsed = parseSingleVulnerability(entry as Record<string, unknown>);
    if (!parsed) continue;
    vulns.push(parsed);
    bySeverity[parsed.severity] = (bySeverity[parsed.severity] ?? 0) + 1;
    if (parsed.affectedEcosystem) {
      byEcosystem[parsed.affectedEcosystem] = (byEcosystem[parsed.affectedEcosystem] ?? 0) + 1;
    }
  }
  return { vulns, total: vulns.length, bySeverity, byEcosystem, errors };
}

export function parseOsvVulnerability(raw: unknown): OsvQuerySummary {
  if (!raw || typeof raw !== 'object') {
    return { vulns: [], total: 0, bySeverity: {}, byEcosystem: {}, errors: ['osv: non-object vulnerability'] };
  }
  const one = parseSingleVulnerability(raw as Record<string, unknown>);
  if (!one) {
    return { vulns: [], total: 0, bySeverity: {}, byEcosystem: {}, errors: ['osv: vulnerability missing id'] };
  }
  return {
    vulns: [one],
    total: 1,
    bySeverity: { [one.severity]: 1 },
    byEcosystem: one.affectedEcosystem ? { [one.affectedEcosystem]: 1 } : {},
    errors: [],
  };
}

function parseSingleVulnerability(e: Record<string, unknown>): OsvVulnerability | null {
  const id = typeof e.id === 'string' ? e.id : undefined;
  if (!id) return null;
  const aliases = Array.isArray(e.aliases)
    ? (e.aliases.filter((x): x is string => typeof x === 'string') as string[])
    : [];
  const references = Array.isArray(e.references)
    ? (e.references
        .map((r) => (r && typeof r === 'object' && 'url' in r ? (r as { url: unknown }).url : null))
        .filter((u): u is string => typeof u === 'string') as string[])
    : [];

  const severityInfo = extractSeverity(e.severity);
  const database = extractDatabaseSeverity(e.database_specific);
  const ecosystemSpecific = extractDatabaseSeverity(e.ecosystem_specific);
  const severityLabel = database ?? ecosystemSpecific ?? severityInfo.label;

  const affected = extractAffected(e.affected);

  return {
    id,
    summary: typeof e.summary === 'string' ? e.summary : undefined,
    details: typeof e.details === 'string' ? e.details : undefined,
    aliases,
    published: typeof e.published === 'string' ? e.published : undefined,
    modified: typeof e.modified === 'string' ? e.modified : undefined,
    severity: severityLabel,
    cvss: severityInfo.score,
    references,
    affectedPackage: affected.name,
    affectedEcosystem: affected.ecosystem,
    fixedVersions: affected.fixed,
    introducedVersions: affected.introduced,
  };
}

function extractSeverity(sev: unknown): { label: string; score?: number } {
  if (!Array.isArray(sev) || sev.length === 0) return { label: 'unknown' };
  let best: number | undefined;
  let bestType: string | undefined;
  for (const entry of sev) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.score !== 'string') continue;
    const match = e.score.match(/\/AV:[A-Z]\/.*$/) ? e.score : e.score;
    const numeric = extractCvssFromVector(match);
    if (numeric !== undefined && (best === undefined || numeric > best)) {
      best = numeric;
      bestType = typeof e.type === 'string' ? e.type : undefined;
    }
  }
  const label = best === undefined ? 'unknown' : severityBucket(best, bestType);
  return { label, score: best };
}

function extractCvssFromVector(vector: string): number | undefined {
  const parsed = Number(vector);
  if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= 10) return parsed;
  return undefined;
}

function severityBucket(score: number, type?: string): string {
  if (score >= 9) return 'CRITICAL';
  if (score >= 7) return 'HIGH';
  if (score >= 4) return 'MEDIUM';
  if (score > 0) return 'LOW';
  return type ? type.toUpperCase() : 'unknown';
}

function extractDatabaseSeverity(raw: unknown): string | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.severity === 'string') return r.severity.toUpperCase();
  return undefined;
}

function extractAffected(raw: unknown): {
  name?: string;
  ecosystem?: string;
  fixed: string[];
  introduced: string[];
} {
  if (!Array.isArray(raw) || raw.length === 0) return { fixed: [], introduced: [] };
  const first = raw[0];
  if (!first || typeof first !== 'object') return { fixed: [], introduced: [] };
  const f = first as Record<string, unknown>;
  const pkg = f.package as Record<string, unknown> | undefined;
  const name = pkg && typeof pkg.name === 'string' ? pkg.name : undefined;
  const ecosystem = pkg && typeof pkg.ecosystem === 'string' ? pkg.ecosystem : undefined;
  const ranges = Array.isArray(f.ranges) ? f.ranges : [];
  const fixed: string[] = [];
  const introduced: string[] = [];
  for (const r of ranges) {
    if (!r || typeof r !== 'object') continue;
    const events = (r as Record<string, unknown>).events;
    if (!Array.isArray(events)) continue;
    for (const ev of events) {
      if (!ev || typeof ev !== 'object') continue;
      const evt = ev as Record<string, unknown>;
      if (typeof evt.fixed === 'string') fixed.push(evt.fixed);
      if (typeof evt.introduced === 'string' && evt.introduced !== '0') introduced.push(evt.introduced);
    }
  }
  return { name, ecosystem, fixed, introduced };
}

export class OsvClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: OsvClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? 'https://api.osv.dev').replace(/\/$/, '');
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  }

  async query(req: OsvQueryRequest): Promise<OsvQuerySummary> {
    if (typeof this.fetchImpl !== 'function') {
      return { vulns: [], total: 0, bySeverity: {}, byEcosystem: {}, errors: ['osv: global fetch unavailable'] };
    }
    if (!req.package && !req.commit) {
      return {
        vulns: [],
        total: 0,
        bySeverity: {},
        byEcosystem: {},
        errors: ['osv: either package or commit is required'],
      };
    }
    const body: Record<string, unknown> = {};
    if (req.package) body.package = req.package;
    if (req.version) body.version = req.version;
    if (req.commit) body.commit = req.commit;

    return this.request('/v1/query', body, parseOsvQuery);
  }

  async getById(id: string): Promise<OsvQuerySummary> {
    if (!id || typeof id !== 'string') {
      return { vulns: [], total: 0, bySeverity: {}, byEcosystem: {}, errors: ['osv: id is required'] };
    }
    return this.request(`/v1/vulns/${encodeURIComponent(id)}`, null, parseOsvVulnerability);
  }

  private async request(
    path: string,
    body: unknown,
    parser: (raw: unknown) => OsvQuerySummary,
  ): Promise<OsvQuerySummary> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: body === null ? 'GET' : 'POST',
        headers: body === null ? {} : { 'content-type': 'application/json' },
        body: body === null ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        const text = await safeText(response);
        return {
          vulns: [],
          total: 0,
          bySeverity: {},
          byEcosystem: {},
          errors: [`osv: HTTP ${response.status} ${response.statusText} ${text}`.trim()],
        };
      }
      const json = (await response.json()) as unknown;
      return parser(json);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { vulns: [], total: 0, bySeverity: {}, byEcosystem: {}, errors: [`osv: ${message}`] };
    } finally {
      clearTimeout(timer);
    }
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    const t = await response.text();
    return t.length > 200 ? `${t.slice(0, 200)}…` : t;
  } catch {
    return '';
  }
}
