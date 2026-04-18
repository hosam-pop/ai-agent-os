import type { AIProvider, ChatMessage, ContentPart, ToolUsePart } from '../api/provider-interface.js';
import type { ToolRegistry } from '../tools/registry.js';
import { ShortTermMemory } from '../memory/short-term.js';
import { summarize } from '../memory/summarizer.js';
import { Executor } from './executor.js';
import { hooks } from '../hooks/lifecycle-hooks.js';
import { logger } from '../utils/logger.js';
import { loadEnv } from '../config/env-loader.js';
import { withSpan } from '../utils/debug.js';

export interface AgentLoopOptions {
  provider: AIProvider;
  tools: ToolRegistry;
  executor: Executor;
  model: string;
  systemPrompt: string;
  maxIterations?: number;
  memory?: ShortTermMemory;
}

export interface AgentRunResult {
  finalText: string;
  iterations: number;
  usage: { inputTokens: number; outputTokens: number };
  messages: ChatMessage[];
}

/**
 * Core Think → Plan → Act → Observe loop.
 *
 * Each iteration:
 *   1. Think: ask the model for the next action given current context.
 *   2. If the model emits tool_use blocks → Act: run each tool, record results.
 *   3. Observe: append tool results to memory, check context budget, summarize
 *      if we're approaching the limit.
 *   4. Otherwise → end_turn, return the final textual response.
 */
export class AgentLoop {
  private readonly provider: AIProvider;
  private readonly tools: ToolRegistry;
  private readonly executor: Executor;
  private readonly model: string;
  private readonly systemPrompt: string;
  private readonly maxIterations: number;
  private readonly memory: ShortTermMemory;

  constructor(opts: AgentLoopOptions) {
    this.provider = opts.provider;
    this.tools = opts.tools;
    this.executor = opts.executor;
    this.model = opts.model;
    this.systemPrompt = opts.systemPrompt;
    this.maxIterations = opts.maxIterations ?? loadEnv().DOGE_MAX_ITERATIONS;
    this.memory = opts.memory ?? new ShortTermMemory(loadEnv().DOGE_CONTEXT_TOKEN_BUDGET);
  }

  async run(goal: string): Promise<AgentRunResult> {
    return withSpan('agent.run', () => this.runInner(goal), { goal: goal.slice(0, 120) });
  }

  private async runInner(goal: string): Promise<AgentRunResult> {
    const taskId = `task-${Date.now().toString(36)}`;
    await hooks.emit('preTask', { taskId, goal });

    this.memory.append({ role: 'user', content: goal });
    const usage = { inputTokens: 0, outputTokens: 0 };
    let finalText = '';
    let iterations = 0;

    try {
      for (let i = 0; i < this.maxIterations; i++) {
        iterations = i + 1;
        await this.maybeCompressContext();

        const completion = await this.provider.complete({
          model: this.model,
          system: this.systemPrompt,
          messages: this.memory.snapshot(),
          tools: this.tools.toSchemas(),
          maxTokens: 4096,
        });
        usage.inputTokens += completion.usage.inputTokens;
        usage.outputTokens += completion.usage.outputTokens;

        this.memory.append({ role: 'assistant', content: completion.content });

        if (completion.stopReason !== 'tool_use') {
          finalText = this.extractText(completion.content);
          logger.info('agent.loop.end_turn', { iteration: iterations });
          break;
        }

        const toolUses = completion.content.filter(
          (p): p is ToolUsePart => p.type === 'tool_use',
        );
        if (toolUses.length === 0) {
          finalText = this.extractText(completion.content);
          break;
        }

        const toolResults: ContentPart[] = [];
        for (const call of toolUses) {
          const result = await this.executor.exec(call.name, call.input);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: call.id,
            content: result.output || result.error || '(no output)',
            is_error: !result.ok,
          });
        }
        this.memory.append({ role: 'tool', content: toolResults });
      }

      await hooks.emit('postTask', { taskId, success: !!finalText, output: finalText });
      return {
        finalText,
        iterations,
        usage,
        messages: this.memory.snapshot(),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await hooks.emit('onError', { scope: 'agent.run', error: msg });
      await hooks.emit('postTask', { taskId, success: false, output: msg });
      throw err;
    }
  }

  private extractText(parts: ContentPart[]): string {
    return parts
      .filter((p) => p.type === 'text')
      .map((p) => (p.type === 'text' ? p.text : ''))
      .join('\n')
      .trim();
  }

  private async maybeCompressContext(): Promise<void> {
    if (!this.memory.overBudget()) return;
    const compressed = await summarize(this.provider, this.memory.snapshot(), {
      model: this.model,
      keepRecent: 6,
    });
    this.memory.replace(compressed);
    logger.info('agent.loop.context.compressed', { remainingMessages: compressed.length });
  }
}
