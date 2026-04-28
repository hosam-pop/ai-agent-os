import { logger } from '../../utils/logger.js';

export interface ElasticClientOptions {
  baseUrl: string;
  apiKey?: string;
  username?: string;
  password?: string;
  fetchImpl?: typeof fetch;
}

export interface ElasticHit {
  id: string;
  index: string;
  score: number;
  source: Record<string, unknown>;
}

export interface ElasticSearchResult {
  total: number;
  hits: ElasticHit[];
  aggregations?: Record<string, unknown>;
  errors: string[];
}

export class ElasticClient {
  constructor(private readonly opts: ElasticClientOptions) {}

  async search(index: string, body: Record<string, unknown>): Promise<ElasticSearchResult> {
    const f = this.opts.fetchImpl ?? fetch;
    const url = `${trim(this.opts.baseUrl)}/${encodeURIComponent(index)}/_search`;
    try {
      const res = await f(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...this.authHeaders() },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        return {
          total: 0,
          hits: [],
          errors: [`elastic ${res.status}: ${truncate(text)}`],
        };
      }
      const json = (await res.json()) as unknown;
      return parseElasticResponse(json);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('elastic.search.error', { error: msg });
      return { total: 0, hits: [], errors: [msg] };
    }
  }

  private authHeaders(): Record<string, string> {
    if (this.opts.apiKey) return { authorization: `ApiKey ${this.opts.apiKey}` };
    if (this.opts.username && this.opts.password) {
      const basic = Buffer.from(`${this.opts.username}:${this.opts.password}`).toString('base64');
      return { authorization: `Basic ${basic}` };
    }
    return {};
  }
}

export function parseElasticResponse(raw: unknown): ElasticSearchResult {
  if (!raw || typeof raw !== 'object') {
    return { total: 0, hits: [], errors: ['empty response'] };
  }
  const obj = raw as Record<string, unknown>;
  const hitsContainer = (obj.hits as Record<string, unknown> | undefined) ?? {};
  const rawHits = Array.isArray(hitsContainer.hits) ? (hitsContainer.hits as unknown[]) : [];
  const totalValue = hitsContainer.total;
  let total = 0;
  if (typeof totalValue === 'number') total = totalValue;
  else if (totalValue && typeof totalValue === 'object') {
    const t = (totalValue as Record<string, unknown>).value;
    if (typeof t === 'number') total = t;
  }
  const hits: ElasticHit[] = [];
  for (const item of rawHits) {
    if (!item || typeof item !== 'object') continue;
    const h = item as Record<string, unknown>;
    hits.push({
      id: typeof h._id === 'string' ? h._id : '',
      index: typeof h._index === 'string' ? h._index : '',
      score: typeof h._score === 'number' ? h._score : 0,
      source: (h._source as Record<string, unknown> | undefined) ?? {},
    });
  }
  return {
    total,
    hits,
    aggregations: (obj.aggregations as Record<string, unknown> | undefined) ?? undefined,
    errors: [],
  };
}

function trim(u: string): string {
  return u.endsWith('/') ? u.slice(0, -1) : u;
}

function truncate(s: string, max = 400): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}
