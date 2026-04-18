import { execa } from 'execa';
import { z } from 'zod';
import { jsonSchemaObject, type Tool, type ToolContext, type ToolResult } from './registry.js';
import { PolicyEngine } from '../permissions/policy-engine.js';
import { logger } from '../utils/logger.js';

const Input = z.object({
  command: z.string().min(1).describe('Shell command to execute'),
  timeoutMs: z.number().int().positive().max(10 * 60_000).optional(),
  cwd: z.string().optional(),
});

export class BashTool implements Tool<z.infer<typeof Input>> {
  readonly name = 'bash';
  readonly description =
    'Execute a shell command inside the workspace. Destructive commands are blocked by policy.';
  readonly schema = Input;
  readonly jsonSchema = jsonSchemaObject(
    {
      command: { type: 'string', description: 'Shell command to execute' },
      timeoutMs: { type: 'number', description: 'Kill after this many ms (<= 600000)' },
      cwd: { type: 'string', description: 'Working directory (defaults to workspace root)' },
    },
    ['command'],
  );
  readonly dangerous = true;

  constructor(private readonly policy: PolicyEngine) {}

  async run(input: z.infer<typeof Input>, ctx: ToolContext): Promise<ToolResult> {
    const decision = this.policy.evaluate({
      toolName: this.name,
      argsSignature: input.command,
      rawArgs: input,
    });
    if (decision.action === 'deny') {
      return { ok: false, output: '', error: `Command denied by policy: ${decision.reason ?? 'unspecified'}` };
    }
    if (decision.action === 'prompt') {
      logger.warn('bash.prompt-required', { command: input.command });
    }

    const cwd = input.cwd ?? ctx.workspace;
    try {
      const result = await execa(input.command, {
        shell: '/bin/bash',
        cwd,
        timeout: input.timeoutMs ?? 120_000,
        reject: false,
        all: true,
        env: { ...process.env, CI: '1' },
      });
      const combined = result.all ?? `${result.stdout}\n${result.stderr}`;
      const truncated = combined.length > 20_000 ? combined.slice(0, 20_000) + '\n…[truncated]' : combined;
      return {
        ok: result.exitCode === 0,
        output: truncated,
        error: result.exitCode === 0 ? undefined : `exit=${result.exitCode}`,
        data: { exitCode: result.exitCode, signal: result.signal },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, output: '', error: message };
    }
  }
}
