import { loadEnv } from '../config/env-loader.js';
import { decompose, type SubTask } from '../tasks/decomposition.js';
import type { DependencyGraph } from '../tasks/dependency-graph.js';
import type { AIProvider } from '../api/provider-interface.js';
import type { AgentLoop } from './agent-loop.js';
import { logger } from '../utils/logger.js';
import { withSpan } from '../utils/debug.js';

export interface OrchestrationResult {
  success: boolean;
  subtaskResults: Array<{
    id: string;
    title: string;
    output: string;
    success: boolean;
  }>;
  finalSummary: string;
}

/**
 * Orchestrator.
 *
 * Decomposes a complex goal into a DAG of subtasks and runs them respecting
 * dependencies, parallelizing independent subtasks up to a configurable
 * concurrency bound. Each subtask is executed by a shared AgentLoop instance
 * against its own short-term memory (via the caller).
 */
export class Orchestrator {
  constructor(
    private readonly provider: AIProvider,
    private readonly model: string,
    private readonly agentFactory: () => AgentLoop,
  ) {}

  async run(goal: string): Promise<OrchestrationResult> {
    return withSpan('orchestrator.run', () => this.runInner(goal), { goal: goal.slice(0, 120) });
  }

  private async runInner(goal: string): Promise<OrchestrationResult> {
    const env = loadEnv();
    const graph: DependencyGraph<SubTask> = await decompose(this.provider, goal, this.model);
    const nodes = graph.topological();
    logger.info('orchestrator.decomposed', {
      subtasks: nodes.length,
      ids: nodes.map((n) => n.id),
    });

    const done = new Set<string>();
    const results: OrchestrationResult['subtaskResults'] = [];
    const maxParallel = env.DOGE_MAX_PARALLEL_TASKS;

    while (done.size < nodes.length) {
      const ready = graph.frontier(done).slice(0, maxParallel);
      if (ready.length === 0) {
        logger.warn('orchestrator.deadlock', { done: [...done] });
        break;
      }
      const batch = await Promise.all(
        ready.map(async (node) => {
          const agent = this.agentFactory();
          const prompt = this.buildSubtaskPrompt(goal, node.value, results);
          try {
            const r = await agent.run(prompt);
            return {
              id: node.id,
              title: node.value.title,
              output: r.finalText,
              success: true,
            };
          } catch (err) {
            return {
              id: node.id,
              title: node.value.title,
              output: err instanceof Error ? err.message : String(err),
              success: false,
            };
          }
        }),
      );
      for (const r of batch) {
        results.push(r);
        done.add(r.id);
      }
    }

    const allOk = results.every((r) => r.success);
    const finalSummary = this.summarize(goal, results);
    return { success: allOk, subtaskResults: results, finalSummary };
  }

  private buildSubtaskPrompt(
    goal: string,
    task: SubTask,
    prior: OrchestrationResult['subtaskResults'],
  ): string {
    const context =
      prior.length === 0
        ? ''
        : '\n\nPrior subtask results (for context):\n' +
          prior
            .map((p) => `- [${p.id}] ${p.title} ${p.success ? '(ok)' : '(failed)'}:\n${p.output}`)
            .join('\n');
    return `Parent goal: ${goal}\n\nYour subtask (${task.id}): ${task.title}\nDetails: ${task.description}${context}`;
  }

  private summarize(goal: string, results: OrchestrationResult['subtaskResults']): string {
    const bullets = results
      .map((r) => `- [${r.id}] ${r.title}: ${r.success ? 'ok' : 'FAILED'}`)
      .join('\n');
    return `Goal: ${goal}\n\nSubtasks:\n${bullets}`;
  }
}
