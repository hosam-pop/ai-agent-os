import { z } from 'zod';
import { jsonSchemaObject, type Tool, type ToolContext, type ToolResult } from '../../tools/registry.js';
import { loadEnv } from '../../config/env-loader.js';
import { scanAtomicRedTeam, type AtomicSummary } from './atomic-red-team-reader.js';

const Input = z.object({
  rootPath: z.string().optional(),
  techniqueIds: z.array(z.string()).optional(),
  platforms: z.array(z.string()).optional(),
  query: z.string().optional(),
  limit: z.number().int().positive().max(1000).default(100),
});

export class AtomicLookupTool implements Tool<z.infer<typeof Input>> {
  readonly name = 'atomic_lookup';
  readonly description =
    'Read Atomic Red Team YAML definitions from a local clone. Returns technique / test metadata (name, platforms, command pattern) so detection engineers can build SIEM rules. Read-only: never executes any atomic test.';
  readonly schema = Input;
  readonly jsonSchema = jsonSchemaObject(
    {
      rootPath: { type: 'string' },
      techniqueIds: { type: 'array', items: { type: 'string' } },
      platforms: { type: 'array', items: { type: 'string' } },
      query: { type: 'string' },
      limit: { type: 'number', maximum: 1000 },
    },
    [],
  );

  async run(input: z.infer<typeof Input>, _ctx: ToolContext): Promise<ToolResult> {
    const env = loadEnv();
    const rootPath = input.rootPath ?? env.ATOMIC_RED_TEAM_PATH;
    if (!rootPath) {
      return {
        ok: false,
        output: '',
        error: 'atomic_lookup: ATOMIC_RED_TEAM_PATH is not set (and no rootPath provided).',
      };
    }
    const summary = await scanAtomicRedTeam({
      rootPath,
      techniqueIds: input.techniqueIds,
      platforms: input.platforms,
      query: input.query,
      limit: input.limit,
    });
    return render(summary, rootPath);
  }
}

function render(summary: AtomicSummary, rootPath: string): ToolResult {
  if (summary.techniques.length === 0) {
    const error = summary.errors[0] ?? 'no techniques matched';
    return { ok: false, output: '', error, data: { rootPath, summary } };
  }
  const platformBreakdown = formatBreakdown(summary.byPlatform);
  const header = `atomic-red-team: ${summary.techniques.length} technique(s), ${summary.total} test(s) | ${platformBreakdown}`;
  const lines = [header];
  for (const tech of summary.techniques) {
    lines.push(`  ${tech.id} ${tech.displayName}`);
    for (const test of tech.tests.slice(0, 5)) {
      const platforms = test.platforms.join(',') || 'any';
      const exec = test.executor?.name ? ` [${test.executor.name}]` : '';
      lines.push(`    - ${test.name} (${platforms})${exec}`);
    }
    if (tech.tests.length > 5) lines.push(`    … +${tech.tests.length - 5} more`);
  }
  if (summary.errors.length > 0) {
    lines.push(`  warnings: ${summary.errors.slice(0, 3).join('; ')}`);
  }
  return { ok: true, output: lines.join('\n'), data: { rootPath, summary } };
}

function formatBreakdown(breakdown: Record<string, number>): string {
  const entries = Object.entries(breakdown).sort(([, a], [, b]) => b - a);
  return entries.length === 0 ? 'no-tests' : entries.map(([k, v]) => `${k}=${v}`).join(' ');
}
