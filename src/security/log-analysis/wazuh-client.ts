import { logger } from '../../utils/logger.js';

export interface WazuhClientOptions {
  baseUrl: string;
  username?: string;
  password?: string;
  token?: string;
  fetchImpl?: typeof fetch;
}

export interface WazuhAlert {
  id: string;
  timestamp: string;
  level: number;
  ruleId: string;
  description: string;
  agent: { id?: string; name?: string };
  source: Record<string, unknown>;
}

export interface WazuhSummary {
  total: number;
  alerts: WazuhAlert[];
  errors: string[];
}

/**
 * Minimal Wazuh REST client. Wazuh's own API lives at /security/user/authenticate
 * for token acquisition, then /agents, /alerts, etc. We keep the surface narrow —
 * enough for the agent to pull recent alerts and filter by agent / level.
 */
export class WazuhClient {
  private tokenCache: { token: string; fetchedAt: number } | null = null;

  constructor(private readonly opts: WazuhClientOptions) {
    if (opts.token) {
      this.tokenCache = { token: opts.token, fetchedAt: Date.now() };
    }
  }

  async listAlerts(params: { agentId?: string; minLevel?: number; limit?: number } = {}): Promise<WazuhSummary> {
    const token = await this.ensureToken();
    if (!token) {
      return { total: 0, alerts: [], errors: ['wazuh authentication failed'] };
    }
    const f = this.opts.fetchImpl ?? fetch;
    const query = new URLSearchParams();
    if (typeof params.limit === 'number') query.set('limit', String(params.limit));
    if (typeof params.agentId === 'string') query.set('agents_list', params.agentId);
    if (typeof params.minLevel === 'number') query.set('level', String(params.minLevel));

    const url = `${trim(this.opts.baseUrl)}/security/alerts${query.toString() ? `?${query}` : ''}`;
    try {
      const res = await f(url, { headers: { authorization: `Bearer ${token}` } });
      if (!res.ok) {
        return {
          total: 0,
          alerts: [],
          errors: [`wazuh ${res.status}: ${truncate(await res.text())}`],
        };
      }
      const json = (await res.json()) as unknown;
      return parseWazuhResponse(json);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('wazuh.list.error', { error: msg });
      return { total: 0, alerts: [], errors: [msg] };
    }
  }

  private async ensureToken(): Promise<string | null> {
    const ttl = 14 * 60_000;
    if (this.tokenCache && Date.now() - this.tokenCache.fetchedAt < ttl) {
      return this.tokenCache.token;
    }
    if (!this.opts.username || !this.opts.password) return this.tokenCache?.token ?? null;
    const f = this.opts.fetchImpl ?? fetch;
    const basic = Buffer.from(`${this.opts.username}:${this.opts.password}`).toString('base64');
    try {
      const res = await f(`${trim(this.opts.baseUrl)}/security/user/authenticate`, {
        method: 'POST',
        headers: { authorization: `Basic ${basic}` },
      });
      if (!res.ok) return null;
      const json = (await res.json()) as unknown;
      const token = extractToken(json);
      if (!token) return null;
      this.tokenCache = { token, fetchedAt: Date.now() };
      return token;
    } catch (err) {
      logger.warn('wazuh.auth.error', {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }
}

function extractToken(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = (raw as Record<string, unknown>).data;
  if (data && typeof data === 'object') {
    const t = (data as Record<string, unknown>).token;
    if (typeof t === 'string') return t;
  }
  const direct = (raw as Record<string, unknown>).token;
  if (typeof direct === 'string') return direct;
  return null;
}

export function parseWazuhResponse(raw: unknown): WazuhSummary {
  if (!raw || typeof raw !== 'object') {
    return { total: 0, alerts: [], errors: ['empty response'] };
  }
  const obj = raw as Record<string, unknown>;
  const data = (obj.data as Record<string, unknown> | undefined) ?? {};
  const affectedItems = Array.isArray(data.affected_items)
    ? (data.affected_items as unknown[])
    : Array.isArray(data.items)
      ? (data.items as unknown[])
      : [];
  const totalValue = typeof data.total_affected_items === 'number' ? data.total_affected_items : affectedItems.length;

  const alerts: WazuhAlert[] = [];
  for (const item of affectedItems) {
    if (!item || typeof item !== 'object') continue;
    const a = item as Record<string, unknown>;
    const rule = (a.rule as Record<string, unknown> | undefined) ?? {};
    const agent = (a.agent as Record<string, unknown> | undefined) ?? {};
    alerts.push({
      id: typeof a.id === 'string' ? a.id : '',
      timestamp: typeof a.timestamp === 'string' ? a.timestamp : '',
      level: typeof rule.level === 'number' ? (rule.level as number) : 0,
      ruleId: typeof rule.id === 'string' ? (rule.id as string) : String(rule.id ?? ''),
      description: typeof rule.description === 'string' ? (rule.description as string) : '',
      agent: {
        id: typeof agent.id === 'string' ? (agent.id as string) : undefined,
        name: typeof agent.name === 'string' ? (agent.name as string) : undefined,
      },
      source: a,
    });
  }
  return { total: totalValue, alerts, errors: [] };
}

function trim(u: string): string {
  return u.endsWith('/') ? u.slice(0, -1) : u;
}

function truncate(s: string, max = 400): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}
