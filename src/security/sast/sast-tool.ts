import { z } from 'zod';
import { jsonSchemaObject, type Tool, type ToolContext, type ToolResult } from '../../tools/registry.js';
import { loadEnv } from '../../config/env-loader.js';
import { runSemgrep, type SemgrepSummary } from './semgrep-runner.js';
import { runCodeql, type CodeqlSummary } from './codeql-runner.js';

const Input = z.object({
  engine: z.enum(['semgrep', 'codeql']).describe('Which static-analysis engine to run'),
  target: z
    .string()
    .min(1)
    .describe('For semgrep: path to source tree. For codeql: path to a prebuilt CodeQL database.'),
  config: z
    .string()
    .optional()
    .describe('Semgrep rule pack (e.g. "p/owasp-top-ten") or CodeQL query suite path.'),
  include: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
  maxFindings: z.number().int().positive().max(1000).default(200),
});

export class SastTool implements Tool<z.infer<typeof Input>> {
  readonly name = 'sast';
  readonly description =
    'Static application security testing. Runs Semgrep against source code or CodeQL against a prebuilt database and returns deduplicated findings with severity, CWE, and OWASP mappings.';
  readonly schema = Input;
  readonly jsonSchema = jsonSchemaObject(
    {
      engine: { type: 'string', enum: ['semgrep', 'codeql'] },
      target: { type: 'string' },
      config: { type: 'string' },
      include: { type: 'array', items: { type: 'string' } },
      exclude: { type: 'array', items: { type: 'string' } },
      maxFindings: { type: 'number', maximum: 1000 },
    },
    ['engine', 'target'],
  );

  async run(input: z.infer<typeof Input>, _ctx: ToolContext): Promise<ToolResult> {
    const env = loadEnv();
    if (input.engine === 'semgrep') {
      const summary = await runSemgrep({
        target: input.target,
        config: input.config,
        bin: env.SEMGREP_BIN,
        include: input.include,
        exclude: input.exclude,
      });
      return this.renderSemgrep(summary, input.maxFindings);
    }
    const summary = await runCodeql({
      database: input.target,
      querySuite: input.config,
      bin: env.CODEQL_BIN,
    });
    return this.renderCodeql(summary, input.maxFindings);
  }

  private renderSemgrep(summary: SemgrepSummary, maxFindings: number): ToolResult {
    if (summary.errors.length > 0 && summary.total === 0) {
      return { ok: false, output: '', error: summary.errors.join('; '), data: summary };
    }
    const top = summary.findings.slice(0, maxFindings);
    const lines = [
      `semgrep: ${summary.total} finding(s) | ${formatBreakdown(summary.bySeverity)}`,
      ...top.map(
        (f) =>
          `  [${f.severity}] ${f.ruleId} ${f.path}:${f.line}-${f.endLine} — ${truncate(f.message, 160)}`,
      ),
    ];
    if (summary.findings.length > maxFindings) {
      lines.push(`  … +${summary.findings.length - maxFindings} more (truncated).`);
    }
    return {
      ok: true,
      output: lines.join('\n'),
      data: { engine: 'semgrep', summary },
    };
  }

  private renderCodeql(summary: CodeqlSummary, maxFindings: number): ToolResult {
    if (summary.errors.length > 0 && summary.total === 0) {
      return { ok: false, output: '', error: summary.errors.join('; '), data: summary };
    }
    const top = summary.findings.slice(0, maxFindings);
    const lines = [
      `codeql: ${summary.total} finding(s) | ${formatBreakdown(summary.byLevel)}`,
      ...top.map(
        (f) => `  [${f.level}] ${f.ruleId} ${f.path}:${f.line} — ${truncate(f.message, 160)}`,
      ),
    ];
    if (summary.findings.length > maxFindings) {
      lines.push(`  … +${summary.findings.length - maxFindings} more (truncated).`);
    }
    return {
      ok: true,
      output: lines.join('\n'),
      data: { engine: 'codeql', summary },
    };
  }
}

function formatBreakdown(breakdown: Record<string, number>): string {
  const entries = Object.entries(breakdown).sort(([, a], [, b]) => b - a);
  return entries.length === 0 ? 'no findings' : entries.map(([k, v]) => `${k}=${v}`).join(' ');
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}
