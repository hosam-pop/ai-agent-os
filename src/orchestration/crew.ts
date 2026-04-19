import { logger } from '../utils/logger.js';

/**
 * CrewAI-inspired orchestration primitives.
 *
 * A Crew is a team of agents with roles, goals, and backstories. Tasks are
 * assigned to agents and executed in a configurable process (sequential or
 * hierarchical with a manager delegating work). This is a pure TypeScript
 * port of the mental model — no Python runtime dependency.
 */

export type CrewProcess = 'sequential' | 'hierarchical';

export interface CrewAgent {
  readonly role: string;
  readonly goal: string;
  readonly backstory?: string;
  readonly tools?: string[];
  execute(task: CrewTask, context: CrewStepContext): Promise<string>;
}

export interface CrewTask {
  readonly id: string;
  readonly description: string;
  readonly expectedOutput?: string;
  readonly agent?: string;
  readonly depends?: string[];
  readonly context?: string[];
}

export interface CrewStepContext {
  readonly history: CrewStepResult[];
  readonly outputs: Record<string, string>;
  readonly crew: Crew;
}

export interface CrewStepResult {
  readonly task: CrewTask;
  readonly agent: string;
  readonly output: string;
  readonly startedAt: number;
  readonly finishedAt: number;
}

export interface CrewRunResult {
  readonly steps: CrewStepResult[];
  readonly outputs: Record<string, string>;
  readonly final: string;
}

export interface CrewOptions {
  readonly agents: CrewAgent[];
  readonly tasks: CrewTask[];
  readonly process?: CrewProcess;
  readonly manager?: CrewAgent;
}

export class Crew {
  readonly agents: CrewAgent[];
  readonly tasks: CrewTask[];
  readonly process: CrewProcess;
  readonly manager?: CrewAgent;

  constructor(opts: CrewOptions) {
    if (opts.agents.length === 0) throw new Error('crew.agents must not be empty');
    if (opts.tasks.length === 0) throw new Error('crew.tasks must not be empty');
    if (opts.process === 'hierarchical' && !opts.manager) {
      throw new Error('hierarchical crew requires a manager agent');
    }
    this.agents = opts.agents;
    this.tasks = opts.tasks;
    this.process = opts.process ?? 'sequential';
    this.manager = opts.manager;
  }

  findAgent(role: string): CrewAgent | undefined {
    return this.agents.find((a) => a.role === role);
  }

  async kickoff(): Promise<CrewRunResult> {
    const steps: CrewStepResult[] = [];
    const outputs: Record<string, string> = {};

    const ordered = this.process === 'sequential' ? [...this.tasks] : planHierarchical(this.tasks);

    for (const task of ordered) {
      const assignee = this.resolveAssignee(task);
      logger.debug('crew.task.start', { task: task.id, agent: assignee.role });
      const startedAt = Date.now();
      const ctx: CrewStepContext = { history: [...steps], outputs: { ...outputs }, crew: this };
      const output = await assignee.execute(task, ctx);
      const finishedAt = Date.now();
      steps.push({ task, agent: assignee.role, output, startedAt, finishedAt });
      outputs[task.id] = output;
      logger.debug('crew.task.done', { task: task.id, agent: assignee.role });
    }

    const last = steps[steps.length - 1];
    return { steps, outputs, final: last ? last.output : '' };
  }

  private resolveAssignee(task: CrewTask): CrewAgent {
    if (task.agent) {
      const explicit = this.findAgent(task.agent);
      if (!explicit) throw new Error(`no agent registered for role "${task.agent}"`);
      return explicit;
    }
    if (this.process === 'hierarchical') {
      if (!this.manager) throw new Error('hierarchical crew requires a manager');
      return this.manager;
    }
    const first = this.agents[0];
    if (!first) throw new Error('crew has no agents');
    return first;
  }
}

function planHierarchical(tasks: CrewTask[]): CrewTask[] {
  // In hierarchical mode the manager delegates; we still walk tasks in
  // dependency order so downstream work sees upstream outputs.
  return topoSort(tasks);
}

export function topoSort(tasks: CrewTask[]): CrewTask[] {
  const byId = new Map(tasks.map((t) => [t.id, t] as const));
  const visited = new Set<string>();
  const temp = new Set<string>();
  const order: CrewTask[] = [];

  const visit = (id: string) => {
    if (visited.has(id)) return;
    if (temp.has(id)) throw new Error(`crew task cycle detected at ${id}`);
    const task = byId.get(id);
    if (!task) throw new Error(`crew task ${id} references unknown id`);
    temp.add(id);
    for (const dep of task.depends ?? []) visit(dep);
    temp.delete(id);
    visited.add(id);
    order.push(task);
  };

  for (const t of tasks) visit(t.id);
  return order;
}
