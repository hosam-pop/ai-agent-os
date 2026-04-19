import { z } from 'zod';
import { jsonSchemaObject, type Tool, type ToolContext, type ToolResult } from '../../tools/registry.js';
import { loadEnv } from '../../config/env-loader.js';
import { VigilClient, type VigilScanSummary } from './vigil-client.js';

const Input = z.object({
  engine: z.enum(['vigil']).default('vigil'),
  prompt: z.string().min(1),
  scanners: z.array(z.string()).optional(),
  baseUrl: z.string().url().optional(),
  maxMatches: z.number().int().positive().max(200).default(50),
});

export class LlmGuardTool implements Tool<z.infer<typeof Input>> {
  readonly name = 'llm_guard';
  readonly description =
    'Scan a prompt or tool output for prompt-injection, jailbreaks, and PII via a defensive LLM guard service (currently Vigil). Read-only; never forwards the prompt to an upstream model.';
  readonly schema = Input;
  readonly jsonSchema = jsonSchemaObject(
    {
      engine: { type: 'string', enum: ['vigil'] },
      prompt: { type: 'string' },
      scanners: { type: 'array', items: { type: 'string' } },
      baseUrl: { type: 'string' },
      maxMatches: { type: 'number', maximum: 200 },
    },
    ['prompt'],
  );

  async run(input: z.infer<typeof Input>, _ctx: ToolContext): Promise<ToolResult> {
    const env = loadEnv();
    const baseUrl = input.baseUrl ?? env.VIGIL_URL;
    if (!baseUrl) {
      return {
        ok: false,
        output: '',
        error: 'llm_guard: VIGIL_URL is not configured (set VIGIL_URL or pass baseUrl).',
      };
    }
    const client = new VigilClient({ baseUrl, token: env.VIGIL_TOKEN });
    const summary = await client.scan({ prompt: input.prompt, scanners: input.scanners });
    return render(summary, baseUrl, input.maxMatches);
  }
}

function render(summary: VigilScanSummary, baseUrl: string, maxMatches: number): ToolResult {
  if (summary.errors.length > 0 && summary.total === 0 && summary.verdict === 'clean') {
    return {
      ok: false,
      output: '',
      error: summary.errors.join('; '),
      data: { baseUrl, summary },
    };
  }
  const top = summary.matches.slice(0, maxMatches);
  const header = `vigil: verdict=${summary.verdict} matches=${summary.total} ${formatBreakdown(summary.byScanner)}`;
  const lines = [header];
  for (const m of top) {
    const score = typeof m.score === 'number' ? ` score=${m.score.toFixed(2)}` : '';
    const rule = m.rule ? ` rule=${m.rule}` : '';
    lines.push(`  [${m.scanner}]${rule}${score} ${truncate(m.message, 160)}`);
  }
  if (summary.matches.length > top.length) {
    lines.push(`  … +${summary.matches.length - top.length} more`);
  }
  if (summary.errors.length > 0) {
    lines.push(`  warnings: ${summary.errors.join('; ')}`);
  }
  return { ok: true, output: lines.join('\n'), data: { baseUrl, summary } };
}

function formatBreakdown(breakdown: Record<string, number>): string {
  const entries = Object.entries(breakdown).sort(([, a], [, b]) => b - a);
  return entries.length === 0 ? 'no-matches' : entries.map(([k, v]) => `${k}=${v}`).join(' ');
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
