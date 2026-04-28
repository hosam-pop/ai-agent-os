import { z } from 'zod';
import { jsonSchemaObject, type Tool, type ToolContext, type ToolResult } from '../../tools/registry.js';
import { loadEnv } from '../../config/env-loader.js';
import { readFalcoEvents, type FalcoSummary } from './falco-event-reader.js';

const Input = z.object({
  action: z.enum(['recent_events']).default('recent_events'),
  path: z
    .string()
    .optional()
    .describe('Override Falco JSON output path. Defaults to FALCO_LOG_PATH or /var/log/falco/falco.json.'),
  minPriority: z
    .enum(['Emergency', 'Alert', 'Critical', 'Error', 'Warning', 'Notice', 'Informational', 'Debug'])
    .optional(),
  rule: z.string().optional(),
  tag: z.string().optional(),
  source: z.string().optional(),
  limit: z.number().int().positive().max(2000).default(200),
});

const DEFAULT_PATH = '/var/log/falco/falco.json';

export class RuntimeMonitorTool implements Tool<z.infer<typeof Input>> {
  readonly name = 'runtime_monitor';
  readonly description =
    'Read recent Falco runtime-security events from a JSON log. Supports filtering by rule, tag, source, and minimum priority. Read-only.';
  readonly schema = Input;
  readonly jsonSchema = jsonSchemaObject(
    {
      action: { type: 'string', enum: ['recent_events'] },
      path: { type: 'string' },
      minPriority: {
        type: 'string',
        enum: [
          'Emergency',
          'Alert',
          'Critical',
          'Error',
          'Warning',
          'Notice',
          'Informational',
          'Debug',
        ],
      },
      rule: { type: 'string' },
      tag: { type: 'string' },
      source: { type: 'string' },
      limit: { type: 'number', maximum: 2000 },
    },
    [],
  );

  async run(input: z.infer<typeof Input>, _ctx: ToolContext): Promise<ToolResult> {
    const env = loadEnv();
    const path = input.path ?? env.FALCO_LOG_PATH ?? DEFAULT_PATH;
    const summary = await readFalcoEvents({
      path,
      limit: input.limit,
      minPriority: input.minPriority,
      rule: input.rule,
      tag: input.tag,
      source: input.source,
    });
    return this.render(summary, path);
  }

  private render(summary: FalcoSummary, path: string): ToolResult {
    if (summary.errors.length > 0 && summary.total === 0) {
      return { ok: false, output: '', error: summary.errors.join('; '), data: { path, summary } };
    }
    if (summary.total === 0) {
      return {
        ok: true,
        output: `falco: 0 event(s) in ${path}${summary.truncated ? ' (tail-bounded)' : ''}`,
        data: { path, summary },
      };
    }
    const top = summary.events.slice(0, 50);
    const lines = [
      `falco: ${summary.total} event(s) | ${formatBreakdown(summary.byPriority)}`,
      ...top.map((e) => `  [${e.priority}] ${e.time} ${e.rule} — ${truncate(e.message, 160)}`),
    ];
    if (summary.events.length > top.length) {
      lines.push(`  … +${summary.events.length - top.length} more`);
    }
    return { ok: true, output: lines.join('\n'), data: { path, summary } };
  }
}

function formatBreakdown(breakdown: Record<string, number>): string {
  const entries = Object.entries(breakdown).sort(([, a], [, b]) => b - a);
  return entries.length === 0 ? 'no events' : entries.map(([k, v]) => `${k}=${v}`).join(' ');
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}
