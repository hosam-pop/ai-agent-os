import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TaskQueue } from '../../../dist/orchestration/task-queue.js';

test('TaskQueue drains by priority (higher first) and enqueues follow-ups', async () => {
  const order: string[] = [];
  const executor = {
    async execute(task) {
      order.push(task.id);
      if (task.id === 'root') {
        return {
          output: 'expanded',
          enqueued: [
            { id: 'child-hi', description: 'hi', priority: 10 },
            { id: 'child-lo', description: 'lo', priority: -1 },
          ],
        };
      }
      return { output: 'ok' };
    },
  };
  const queue = new TaskQueue({ executor });
  queue.enqueue({ id: 'root', description: 'root', priority: 5 });
  queue.enqueue({ id: 'other', description: 'other', priority: 1 });
  const results = await queue.drain();
  assert.deepEqual(order, ['root', 'child-hi', 'other', 'child-lo']);
  assert.equal(results.length, 4);
  assert.equal(results[0].enqueued.length, 2);
});

test('TaskQueue.runGoal uses decomposer and respects stepLimit', async () => {
  const executor = {
    async execute(task) {
      if (task.id === 'expand') {
        return {
          output: '',
          enqueued: [
            { id: 'e1', description: 'e1' },
            { id: 'e2', description: 'e2' },
          ],
        };
      }
      return { output: task.id };
    },
  };
  const decomposer = {
    decompose(goal: string) {
      return [
        { id: 'expand', description: goal, priority: 1 },
        { id: 'static', description: 'static' },
      ];
    },
  };
  const queue = new TaskQueue({ executor, decomposer, stepLimit: 3 });
  const results = await queue.runGoal('do things');
  assert.equal(results.length, 3);
  assert.ok(queue.size() > 0);
});

test('TaskQueue.runGoal without a decomposer throws', () => {
  const queue = new TaskQueue({
    executor: {
      async execute() {
        return { output: '' };
      },
    },
  });
  return assert.rejects(() => queue.runGoal('goal'), /decomposer/);
});
