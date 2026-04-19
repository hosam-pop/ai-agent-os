import { z } from 'zod';
import { jsonSchemaObject, type Tool, type ToolContext, type ToolResult } from '../../tools/registry.js';
import { loadEnv } from '../../config/env-loader.js';
import { runNuclei, type NucleiSummary } from './nuclei-runner.js';
import { runZapBaseline, type ZapSummary } from './zap-runner.js';

const Input = z.object({
  engine: z.enum(['nuclei', 'zap']).describe('Which dynamic scanner to run'),
  targets: z
    .array(z.string().url())
    .min(1)
    .max(25)
    .describe('Fully qualified URLs to scan. Only scan assets you own or are authorised to test.'),
  templates: z
    .array(z.string())
    .optional()
    .describe('Nuclei only: list of template IDs or tag filters to include.'),
  severity: z
    .array(z.enum(['info', 'low', 'medium', 'high', 'critical']))
    .optional()
    .describe('Nuclei only: restrict to these severity levels.'),
  rateLimit: z.number().int().positive().max(500).optional(),
  maxFindings: z.number().int().positive().max(500).default(100),
});

export class DastTool implements Tool<z.infer<typeof Input>> {
  readonly name = 'dast';
  readonly description =
    'Dynamic application security testing. Runs Nuclei or OWASP ZAP Baseline against a list of URLs and returns severity-ranked findings. Only scan assets you are authorised to test.';
  readonly schema = Input;
  readonly jsonSchema = jsonSchemaObject(
    {
      engine: { type: 'string', enum: ['nuclei', 'zap'] },
      targets: { type: 'array', items: { type: 'string', format: 'uri' } },
      templates: { type: 'array', items: { type: 'string' } },
      severity: {
        type: 'array',
        items: { type: 'string', enum: ['info', 'low', 'medium', 'high', 'critical'] },
      },
      rateLimit: { type: 'number' },
      maxFindings: { type: 'number', maximum: 500 },
    },
    ['engine', 'targets'],
  );
  readonly dangerous = true;

  async run(input: z.infer<typeof Input>, _ctx: ToolContext): Promise<ToolResult> {
    const env = loadEnv();
    if (input.engine === 'nuclei') {
      const summary = await runNuclei({
        targets: input.targets,
        bin: env.NUCLEI_BIN,
        templates: input.templates,
        severity: input.severity,
        rateLimit: input.rateLimit,
      });
      return this.renderNuclei(summary, input.maxFindings);
    }
    if (input.targets.length !== 1) {
      return {
        ok: false,
        output: '',
        error: 'ZAP baseline expects exactly one target URL per run',
      };
    }
    const summary = await runZapBaseline({
      target: input.targets[0],
      bin: env.ZAP_BIN,
    });
    return this.renderZap(summary, input.maxFindings);
  }

  private renderNuclei(summary: NucleiSummary, maxFindings: number): ToolResult {
    if (summary.errors.length > 0 && summary.total === 0) {
      return { ok: false, output: '', error: summary.errors.join('; '), data: summary };
    }
    const top = summary.findings.slice(0, maxFindings);
    const lines = [
      `nuclei: ${summary.total} finding(s) | ${formatBreakdown(summary.bySeverity)}`,
      ...top.map(
        (f) => `  [${f.severity}] ${f.templateId} ${f.host} ${f.matchedAt} — ${truncate(f.name, 120)}`,
      ),
    ];
    if (summary.findings.length > maxFindings) {
      lines.push(`  … +${summary.findings.length - maxFindings} more (truncated).`);
    }
    return { ok: true, output: lines.join('\n'), data: { engine: 'nuclei', summary } };
  }

  private renderZap(summary: ZapSummary, maxFindings: number): ToolResult {
    if (summary.errors.length > 0 && summary.total === 0) {
      return { ok: false, output: '', error: summary.errors.join('; '), data: summary };
    }
    const top = summary.alerts.slice(0, maxFindings);
    const lines = [
      `zap: ${summary.total} alert(s) | ${formatBreakdown(summary.byRisk)}`,
      ...top.map(
        (a) =>
          `  [${a.riskdesc}] ${a.name} (cwe=${a.cweid ?? '-'}) — ${a.instances.length} instance(s)`,
      ),
    ];
    if (summary.alerts.length > maxFindings) {
      lines.push(`  … +${summary.alerts.length - maxFindings} more (truncated).`);
    }
    return { ok: true, output: lines.join('\n'), data: { engine: 'zap', summary } };
  }
}

function formatBreakdown(breakdown: Record<string, number>): string {
  const entries = Object.entries(breakdown).sort(([, a], [, b]) => b - a);
  return entries.length === 0 ? 'no findings' : entries.map(([k, v]) => `${k}=${v}`).join(' ');
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}
