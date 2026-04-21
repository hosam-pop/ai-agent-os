import { z } from 'zod';
import type { ToolSchema } from '../api/provider-interface.js';
import { logger } from '../utils/logger.js';

export interface ToolContext {
  workspace: string;
  abortSignal?: AbortSignal;
  agentId?: string;
  userId?: string;
  [key: string]: unknown;
}

export interface ToolResult {
  ok: boolean;
  output: string;
  error?: string;
  data?: unknown;
}

export interface Tool<I = unknown> {
  readonly name: string;
  readonly description: string;
  readonly schema: z.ZodType<I, z.ZodTypeDef, unknown>;
  readonly jsonSchema: Record<string, unknown>;
  readonly dangerous?: boolean;
  run(input: I, ctx: ToolContext): Promise<ToolResult>;
}

/**
 * Optional security / infrastructure chain that wraps every tool call.
 *
 * Order of operations inside {@link ToolRegistry.invoke}:
 *
 *   1. `guard.checkInput`   — reject malformed / adversarial args.
 *   2. `auth.authorize`     — agent-identity + scoped-permission check.
 *   3. `vault.executeTool`  — if the vault claims the tool, it injects
 *                             credentials and executes; otherwise the
 *                             local `tool.run` implementation runs.
 *   4. `guard.sanitizeOutput` — redact secrets before the model sees the
 *                                output string.
 *
 * Every step is optional. When `configurePolicy` is never called the
 * registry behaves exactly as it did before this change — which is what
 * keeps the 169 existing tests green.
 */
export interface RegistryPolicy {
  readonly guard?: {
    checkInput(toolName: string, input: unknown): { allowed: boolean; reason?: string };
    sanitizeOutput(output: string): string;
  };
  readonly auth?: {
    authorize(
      agentId: string,
      action: string,
      resource: string,
    ): Promise<{ allowed: boolean; reason?: string }>;
  };
  readonly vault?: {
    handles(toolName: string): boolean;
    executeTool(
      userId: string | undefined,
      toolName: string,
      input: unknown,
    ): Promise<{ ok: boolean; output: string; error?: string; data?: unknown }>;
  };
}

export class ToolRegistry {
  private readonly tools = new Map<string, Tool<unknown>>();
  private policy: RegistryPolicy = {};

  register<I>(tool: Tool<I>): void {
    if (this.tools.has(tool.name)) {
      logger.warn('tool.register.override', { name: tool.name });
    }
    this.tools.set(tool.name, tool as Tool<unknown>);
    logger.debug('tool.register', { name: tool.name });
  }

  get(name: string): Tool<unknown> | undefined {
    return this.tools.get(name);
  }

  list(): Tool<unknown>[] {
    return [...this.tools.values()];
  }

  toSchemas(): ToolSchema[] {
    return [...this.tools.values()].map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.jsonSchema,
    }));
  }

  configurePolicy(policy: RegistryPolicy): void {
    this.policy = policy;
  }

  async invoke(name: string, input: unknown, ctx: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(name);
    const claimedByVault = this.policy.vault?.handles(name) ?? false;
    if (!tool && !claimedByVault) {
      return { ok: false, output: '', error: `Unknown tool: ${name}` };
    }

    const parsedInput = tool
      ? (() => {
          const parsed = tool.schema.safeParse(input ?? {});
          if (!parsed.success) {
            return {
              ok: false,
              error: `Invalid arguments for ${name}: ${parsed.error.issues.map((i) => i.path.join('.') + ' ' + i.message).join('; ')}`,
            } as const;
          }
          return { ok: true, value: parsed.data } as const;
        })()
      : ({ ok: true, value: input } as const);

    if (!parsedInput.ok) {
      return { ok: false, output: '', error: parsedInput.error };
    }

    const guardDecision = this.policy.guard?.checkInput(name, parsedInput.value);
    if (guardDecision && !guardDecision.allowed) {
      logger.warn('tool.invoke.guard.blocked', { name, reason: guardDecision.reason });
      return { ok: false, output: '', error: `guard-blocked:${guardDecision.reason ?? 'unknown'}` };
    }

    if (this.policy.auth && ctx.agentId) {
      const authDecision = await this.policy.auth.authorize(ctx.agentId, `tool:${name}`, ctx.workspace);
      if (!authDecision.allowed) {
        logger.warn('tool.invoke.auth.blocked', {
          name,
          agentId: ctx.agentId,
          reason: authDecision.reason,
        });
        return { ok: false, output: '', error: `auth-blocked:${authDecision.reason ?? 'unknown'}` };
      }
    }

    try {
      let result: ToolResult;
      if (claimedByVault && this.policy.vault) {
        const vr = await this.policy.vault.executeTool(ctx.userId, name, parsedInput.value);
        result = { ok: vr.ok, output: vr.output ?? '', error: vr.error, data: vr.data };
      } else if (tool) {
        result = await tool.run(parsedInput.value, ctx);
      } else {
        return { ok: false, output: '', error: `Unknown tool: ${name}` };
      }

      if (this.policy.guard?.sanitizeOutput && typeof result.output === 'string') {
        result = { ...result, output: this.policy.guard.sanitizeOutput(result.output) };
      }
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('tool.invoke.error', { name, error: message });
      return { ok: false, output: '', error: message };
    }
  }
}

/** Helper to produce a JSON Schema object from a plain spec. */
export function jsonSchemaObject(properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> {
  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  };
}
