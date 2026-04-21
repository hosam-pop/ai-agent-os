/**
 * AgentestRunner — scenario-based evaluations backed by
 * `@agentesting/agentest`.
 *
 * `Agentest` treats an agent as a black box and drives it through a
 * scripted conversation, then evaluates the response against a set of
 * metrics (goal completion, coherence, helpfulness, …). The runner here
 * wires an arbitrary async `runAgent(prompt)` function into the SDK so
 * the same primitives the production loop uses can be exercised from
 * plain Node tests.
 *
 * Tests inject `loader` to avoid network calls entirely; the default
 * loader imports the real SDK only when the `AGENTEST_API_KEY` is set.
 */

import { logger } from '../utils/logger.js';

export type AgentRunner = (input: string) => Promise<string>;

export interface AgentestScenario {
  readonly name: string;
  readonly userMessages: readonly string[];
  readonly expectedGoal: string;
  readonly metrics?: readonly ('goal-completion' | 'coherence' | 'faithfulness' | 'helpfulness')[];
}

export interface AgentestResult {
  readonly name: string;
  readonly passed: boolean;
  readonly score: number;
  readonly details: string;
}

export interface AgentestRunnerOptions {
  readonly apiKey?: string;
  readonly loader?: () => Promise<unknown>;
}

type AgentestSDK = {
  Evaluator?: new (opts: unknown) => { evaluate: (params: unknown) => Promise<unknown> };
};

export class AgentestRunner {
  private readonly opts: AgentestRunnerOptions;
  private sdkPromise: Promise<AgentestSDK | null> | null = null;

  constructor(opts: AgentestRunnerOptions = {}) {
    this.opts = opts;
  }

  isConfigured(): boolean {
    return typeof this.opts.apiKey === 'string' && this.opts.apiKey.length > 0;
  }

  async run(scenarios: readonly AgentestScenario[], agent: AgentRunner): Promise<AgentestResult[]> {
    if (this.isConfigured()) {
      const sdk = await this.sdk();
      if (sdk?.Evaluator) {
        return this.runWithSDK(sdk.Evaluator, scenarios, agent);
      }
    }
    // Fallback: lightweight local evaluator so the runner is still useful
    // during CI / offline test runs.
    return this.runLocal(scenarios, agent);
  }

  private async runWithSDK(
    EvaluatorCtor: NonNullable<AgentestSDK['Evaluator']>,
    scenarios: readonly AgentestScenario[],
    agent: AgentRunner,
  ): Promise<AgentestResult[]> {
    const results: AgentestResult[] = [];
    for (const scenario of scenarios) {
      try {
        const evaluator = new EvaluatorCtor({ apiKey: this.opts.apiKey });
        const transcript: Array<{ role: 'user' | 'assistant'; content: string }> = [];
        for (const message of scenario.userMessages) {
          transcript.push({ role: 'user', content: message });
          const reply = await agent(message);
          transcript.push({ role: 'assistant', content: reply });
        }
        const raw = (await evaluator.evaluate({
          transcript,
          goal: scenario.expectedGoal,
          metrics: scenario.metrics ?? ['goal-completion'],
        })) as { passed?: boolean; score?: number; summary?: string };
        results.push({
          name: scenario.name,
          passed: Boolean(raw.passed),
          score: typeof raw.score === 'number' ? raw.score : 0,
          details: typeof raw.summary === 'string' ? raw.summary : JSON.stringify(raw),
        });
      } catch (err) {
        logger.warn('agentest.scenario.error', {
          name: scenario.name,
          error: err instanceof Error ? err.message : String(err),
        });
        results.push({ name: scenario.name, passed: false, score: 0, details: 'sdk-error' });
      }
    }
    return results;
  }

  private async runLocal(
    scenarios: readonly AgentestScenario[],
    agent: AgentRunner,
  ): Promise<AgentestResult[]> {
    const results: AgentestResult[] = [];
    for (const scenario of scenarios) {
      let finalReply = '';
      for (const message of scenario.userMessages) {
        finalReply = await agent(message);
      }
      const passed = scenario.expectedGoal
        .toLowerCase()
        .split(/[^a-z0-9]+/g)
        .filter((t) => t.length >= 3)
        .every((keyword) => finalReply.toLowerCase().includes(keyword));
      results.push({
        name: scenario.name,
        passed,
        score: passed ? 1 : 0,
        details: passed ? 'all-keywords-present' : 'missing-keywords',
      });
    }
    return results;
  }

  private async sdk(): Promise<AgentestSDK | null> {
    if (!this.sdkPromise) {
      const loader = this.opts.loader ?? (() => import('@agentesting/agentest'));
      this.sdkPromise = loader().then((mod) => mod as AgentestSDK).catch((err) => {
        logger.warn('agentest.loader.error', {
          error: err instanceof Error ? err.message : String(err),
        });
        return null;
      });
    }
    return this.sdkPromise;
  }
}
