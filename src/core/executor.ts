import type { ToolRegistry, ToolContext, ToolResult } from '../tools/registry.js';
import { hooks } from '../hooks/lifecycle-hooks.js';
import { logger } from '../utils/logger.js';

/**
 * Tool executor.
 *
 * Thin wrapper around the registry that fires lifecycle hooks, traces timing,
 * and normalizes results for the agent loop.
 */
export class Executor {
  constructor(
    private readonly tools: ToolRegistry,
    private readonly ctx: ToolContext,
  ) {}

  async exec(name: string, input: unknown): Promise<ToolResult> {
    await hooks.emit('preToolCall', { tool: name, args: input });
    const startedAt = Date.now();
    const result = await this.tools.invoke(name, input, this.ctx);
    const elapsed = Date.now() - startedAt;
    logger.info('tool.result', { name, ok: result.ok, ms: elapsed });
    await hooks.emit('postToolCall', {
      tool: name,
      ok: result.ok,
      output: result.output,
      error: result.error,
    });
    return result;
  }
}
