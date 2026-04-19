import { logger } from '../utils/logger.js';

/**
 * SuperAGI-inspired task queue.
 *
 * A priority queue of planned tasks. A task decomposer turns a high-level
 * goal into a batch of concrete tasks; each task is executed by an
 * executor, and the executor may enqueue follow-up tasks. Execution halts
 * when the queue drains or the step budget is hit.
 */

export interface QueueTask {
  readonly id: string;
  readonly description: string;
  readonly priority?: number;
  readonly data?: Record<string, unknown>;
}

export interface TaskResult {
  readonly task: QueueTask;
  readonly output: string;
  readonly enqueued: QueueTask[];
  readonly startedAt: number;
  readonly finishedAt: number;
}

export interface TaskExecutor {
  execute(task: QueueTask, queue: TaskQueue): Promise<{ output: string; enqueued?: QueueTask[] }>;
}

export interface TaskDecomposer {
  decompose(goal: string): Promise<QueueTask[]> | QueueTask[];
}

export interface TaskQueueOptions {
  readonly executor: TaskExecutor;
  readonly decomposer?: TaskDecomposer;
  readonly stepLimit?: number;
}

export class TaskQueue {
  private readonly heap: QueueTask[] = [];
  private readonly executor: TaskExecutor;
  private readonly decomposer?: TaskDecomposer;
  private readonly stepLimit: number;

  constructor(opts: TaskQueueOptions) {
    this.executor = opts.executor;
    this.decomposer = opts.decomposer;
    this.stepLimit = opts.stepLimit ?? 64;
  }

  enqueue(task: QueueTask): void {
    this.heap.push(task);
    this.heap.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  }

  enqueueMany(tasks: QueueTask[]): void {
    for (const t of tasks) this.enqueue(t);
  }

  size(): number {
    return this.heap.length;
  }

  peek(): QueueTask | undefined {
    return this.heap[0];
  }

  async runGoal(goal: string): Promise<TaskResult[]> {
    if (!this.decomposer) throw new Error('task queue requires a decomposer to run a goal');
    const initial = await this.decomposer.decompose(goal);
    this.enqueueMany(initial);
    return this.drain();
  }

  async drain(): Promise<TaskResult[]> {
    const results: TaskResult[] = [];
    let steps = 0;
    while (this.heap.length > 0 && steps < this.stepLimit) {
      const next = this.heap.shift();
      if (!next) break;
      steps += 1;
      logger.debug('task-queue.execute', { task: next.id, remaining: this.heap.length });
      const startedAt = Date.now();
      const { output, enqueued } = await this.executor.execute(next, this);
      const finishedAt = Date.now();
      const follow = enqueued ?? [];
      for (const t of follow) this.enqueue(t);
      results.push({ task: next, output, enqueued: follow, startedAt, finishedAt });
    }
    return results;
  }
}
