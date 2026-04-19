import { z } from 'zod';
import { jsonSchemaObject, type Tool, type ToolContext, type ToolResult } from '../../tools/registry.js';
import { loadEnv } from '../../config/env-loader.js';
import { runGrype, type ContainerScanSummary } from './grype-runner.js';
import { runTrivy } from './trivy-runner.js';

const Input = z.object({
  engine: z.enum(['grype', 'trivy']).describe('Which container vulnerability scanner to run'),
  target: z
    .string()
    .min(1)
    .describe('Container image ref, SBOM path, filesystem path, or git repo URL.'),
  mode: z
    .enum(['image', 'fs', 'repo'])
    .optional()
    .describe('Trivy-only: scan mode. Defaults to "image".'),
  severity: z
    .array(z.enum(['UNKNOWN', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']))
    .optional()
    .describe('Severity filter (Trivy). For Grype this maps to --fail-on of the lowest severity.'),
  ignoreUnfixed: z.boolean().optional().describe('Trivy: ignore vulns without a known fix.'),
  maxFindings: z.number().int().positive().max(2000).default(200),
});

export class ContainerScanTool implements Tool<z.infer<typeof Input>> {
  readonly name = 'container_scan';
  readonly description =
    'Container vulnerability scanning. Runs Grype or Trivy against an image, SBOM, filesystem, or git repo and returns CVE-level findings with severity, package, version, and fix info.';
  readonly schema = Input;
  readonly jsonSchema = jsonSchemaObject(
    {
      engine: { type: 'string', enum: ['grype', 'trivy'] },
      target: { type: 'string' },
      mode: { type: 'string', enum: ['image', 'fs', 'repo'] },
      severity: {
        type: 'array',
        items: { type: 'string', enum: ['UNKNOWN', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
      },
      ignoreUnfixed: { type: 'boolean' },
      maxFindings: { type: 'number', maximum: 2000 },
    },
    ['engine', 'target'],
  );

  async run(input: z.infer<typeof Input>, _ctx: ToolContext): Promise<ToolResult> {
    const env = loadEnv();
    const summary =
      input.engine === 'grype'
        ? await runGrype({
            target: input.target,
            bin: env.GRYPE_BIN,
            minSeverity: input.severity?.[0],
          })
        : await runTrivy({
            target: input.target,
            mode: input.mode,
            bin: env.TRIVY_BIN,
            severity: input.severity,
            ignoreUnfixed: input.ignoreUnfixed,
          });
    return this.render(summary, input.maxFindings);
  }

  private render(summary: ContainerScanSummary, maxFindings: number): ToolResult {
    if (summary.errors.length > 0 && summary.total === 0) {
      return { ok: false, output: '', error: summary.errors.join('; '), data: summary };
    }
    const top = summary.vulns.slice(0, maxFindings);
    const lines = [
      `${summary.engine}: ${summary.total} vuln(s) in ${summary.target} | ${formatBreakdown(summary.bySeverity)}`,
      ...top.map((v) => {
        const fix = v.fixedIn ? ` fix=${v.fixedIn}` : '';
        const cvss = typeof v.cvss === 'number' ? ` cvss=${v.cvss.toFixed(1)}` : '';
        return `  [${v.severity}] ${v.id} ${v.package}@${v.version}${fix}${cvss}`;
      }),
    ];
    if (summary.vulns.length > maxFindings) {
      lines.push(`  … +${summary.vulns.length - maxFindings} more (truncated).`);
    }
    return {
      ok: true,
      output: lines.join('\n'),
      data: { engine: summary.engine, summary },
    };
  }
}

function formatBreakdown(breakdown: Record<string, number>): string {
  const entries = Object.entries(breakdown).sort(([, a], [, b]) => b - a);
  return entries.length === 0 ? 'no findings' : entries.map(([k, v]) => `${k}=${v}`).join(' ');
}
