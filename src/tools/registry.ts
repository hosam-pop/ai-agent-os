import { z } from 'zod';
import type { ToolSchema } from '../api/provider-interface.js';
import { logger } from '../utils/logger.js';

export interface ToolContext {
  workspace: string;
  abortSignal?: AbortSignal;
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

export class ToolRegistry {
  private readonly tools = new Map<string, Tool<unknown>>();

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

  async invoke(name: string, input: unknown, ctx: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { ok: false, output: '', error: `Unknown tool: ${name}` };
    }
    const parsed = tool.schema.safeParse(input ?? {});
    if (!parsed.success) {
      return {
        ok: false,
        output: '',
        error: `Invalid arguments for ${name}: ${parsed.error.issues.map((i) => i.path.join('.') + ' ' + i.message).join('; ')}`,
      };
    }
    try {
      return await tool.run(parsed.data, ctx);
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
