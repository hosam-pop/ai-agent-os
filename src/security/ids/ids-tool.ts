import { z } from 'zod';
import { jsonSchemaObject, type Tool, type ToolContext, type ToolResult } from '../../tools/registry.js';
import { loadEnv } from '../../config/env-loader.js';
import { readSuricataEve, type SuricataSummary } from './suricata-eve-reader.js';

const Input = z.object({
  action: z
    .enum(['recent_alerts'])
    .default('recent_alerts')
    .describe('Currently only "recent_alerts": stream recent alerts from eve.json.'),
  path: z
    .string()
    .optional()
    .describe('Override SURICATA_EVE_PATH for this call.'),
  minSeverity: z
    .number()
    .int()
    .min(1)
    .max(5)
    .optional()
    .describe('Suricata severity is inverse: 1 = most severe. Only alerts <= this are returned.'),
  category: z.string().optional(),
  limit: z.number().int().positive().max(500).default(100),
});

export class IdsTool implements Tool<z.infer<typeof Input>> {
  readonly name = 'ids';
  readonly description =
    'Stream recent Suricata IDS alerts from eve.json. Supports filtering by category, severity, and event type. Read-only.';
  readonly schema = Input;
  readonly jsonSchema = jsonSchemaObject(
    {
      action: { type: 'string', enum: ['recent_alerts'] },
      path: { type: 'string' },
      minSeverity: { type: 'number', minimum: 1, maximum: 5 },
      category: { type: 'string' },
      limit: { type: 'number', maximum: 500 },
    },
    [],
  );

  async run(input: z.infer<typeof Input>, _ctx: ToolContext): Promise<ToolResult> {
    const env = loadEnv();
    const path = input.path ?? env.SURICATA_EVE_PATH;
    if (!path) {
      return {
        ok: false,
        output: '',
        error: 'No eve.json path — set SURICATA_EVE_PATH or pass `path`.',
      };
    }
    const summary = await readSuricataEve({
      path,
      minSeverity: input.minSeverity,
      category: input.category,
      eventType: 'alert',
      limit: input.limit,
    });
    return this.render(summary, input.limit);
  }

  private render(summary: SuricataSummary, limit: number): ToolResult {
    if (summary.errors.length > 0 && summary.total === 0) {
      return { ok: false, output: '', error: summary.errors.join('; '), data: summary };
    }
    const top = summary.alerts.slice(0, limit);
    const lines = [
      `suricata: ${summary.total} alert(s) | severity=${format(summary.bySeverity)} | category=${format(summary.byCategory)}`,
      ...top.map(
        (a) =>
          `  [sev=${a.severity}] ${a.timestamp} sid=${a.signatureId} ${a.srcIp}:${a.srcPort ?? '-'} → ${a.destIp}:${a.destPort ?? '-'} (${a.protocol ?? '-'}) — ${truncate(a.signature, 160)}`,
      ),
    ];
    return { ok: true, output: lines.join('\n'), data: summary };
  }
}

function format(breakdown: Record<string, number>): string {
  const entries = Object.entries(breakdown).sort(([, a], [, b]) => b - a).slice(0, 6);
  return entries.length === 0 ? '-' : entries.map(([k, v]) => `${k}:${v}`).join(',');
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}
