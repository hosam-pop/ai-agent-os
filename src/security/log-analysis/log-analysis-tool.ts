import { z } from 'zod';
import { jsonSchemaObject, type Tool, type ToolContext, type ToolResult } from '../../tools/registry.js';
import { loadEnv } from '../../config/env-loader.js';
import { ElasticClient, type ElasticSearchResult } from './elastic-client.js';
import { WazuhClient, type WazuhSummary } from './wazuh-client.js';

const Input = z.object({
  backend: z.enum(['elastic', 'wazuh']).describe('Which log backend to query'),
  action: z
    .enum(['search', 'recent_alerts'])
    .describe('elastic: "search" uses the DSL body. wazuh: "recent_alerts" lists recent events.'),
  index: z
    .string()
    .optional()
    .describe('Elasticsearch only: index or pattern to search (e.g. "filebeat-*").'),
  query: z
    .record(z.unknown())
    .optional()
    .describe('Elasticsearch only: raw DSL body. Defaults to match_all / size=25.'),
  agentId: z.string().optional().describe('Wazuh only: filter to a specific agent id.'),
  minLevel: z.number().int().min(0).max(15).optional(),
  limit: z.number().int().positive().max(500).default(50),
});

export class LogAnalysisTool implements Tool<z.infer<typeof Input>> {
  readonly name = 'log_analysis';
  readonly description =
    'Query defensive log stores (Elasticsearch/ELK, Wazuh). Returns aggregated and raw hits for incident response and threat hunting.';
  readonly schema = Input;
  readonly jsonSchema = jsonSchemaObject(
    {
      backend: { type: 'string', enum: ['elastic', 'wazuh'] },
      action: { type: 'string', enum: ['search', 'recent_alerts'] },
      index: { type: 'string' },
      query: { type: 'object', additionalProperties: true },
      agentId: { type: 'string' },
      minLevel: { type: 'number' },
      limit: { type: 'number', maximum: 500 },
    },
    ['backend', 'action'],
  );

  async run(input: z.infer<typeof Input>, _ctx: ToolContext): Promise<ToolResult> {
    const env = loadEnv();
    if (input.backend === 'elastic') {
      if (!env.ELASTIC_URL) {
        return { ok: false, output: '', error: 'ELASTIC_URL is not configured' };
      }
      if (!input.index) {
        return { ok: false, output: '', error: 'elastic requests must specify `index`' };
      }
      const client = new ElasticClient({
        baseUrl: env.ELASTIC_URL,
        apiKey: env.ELASTIC_API_KEY,
        username: env.ELASTIC_USERNAME,
        password: env.ELASTIC_PASSWORD,
      });
      const body = input.query ?? { query: { match_all: {} }, size: input.limit };
      const result = await client.search(input.index, body);
      return this.renderElastic(result, input.limit);
    }
    if (!env.WAZUH_URL) {
      return { ok: false, output: '', error: 'WAZUH_URL is not configured' };
    }
    const wazuh = new WazuhClient({
      baseUrl: env.WAZUH_URL,
      username: env.WAZUH_USERNAME,
      password: env.WAZUH_PASSWORD,
      token: env.WAZUH_TOKEN,
    });
    const summary = await wazuh.listAlerts({
      agentId: input.agentId,
      minLevel: input.minLevel,
      limit: input.limit,
    });
    return this.renderWazuh(summary, input.limit);
  }

  private renderElastic(result: ElasticSearchResult, limit: number): ToolResult {
    if (result.errors.length > 0 && result.hits.length === 0) {
      return { ok: false, output: '', error: result.errors.join('; '), data: result };
    }
    const top = result.hits.slice(0, limit);
    const lines = [
      `elastic: ${result.total} hit(s) (showing ${top.length})`,
      ...top.map((h) => `  ${h.index} ${h.id} score=${h.score.toFixed(2)} ${summariseDoc(h.source)}`),
    ];
    return { ok: true, output: lines.join('\n'), data: result };
  }

  private renderWazuh(result: WazuhSummary, limit: number): ToolResult {
    if (result.errors.length > 0 && result.alerts.length === 0) {
      return { ok: false, output: '', error: result.errors.join('; '), data: result };
    }
    const top = result.alerts.slice(0, limit);
    const lines = [
      `wazuh: ${result.total} alert(s) (showing ${top.length})`,
      ...top.map(
        (a) =>
          `  [lvl=${a.level}] ${a.timestamp} rule=${a.ruleId} agent=${a.agent.name ?? a.agent.id ?? '-'} — ${truncate(a.description, 160)}`,
      ),
    ];
    return { ok: true, output: lines.join('\n'), data: result };
  }
}

function summariseDoc(source: Record<string, unknown>): string {
  const keys = Object.keys(source).slice(0, 6);
  const parts: string[] = [];
  for (const key of keys) {
    const v = source[key];
    if (v === null || typeof v === 'object') continue;
    parts.push(`${key}=${truncate(String(v), 60)}`);
  }
  return parts.join(' ');
}

function truncate(s: string, max = 160): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}
