import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AgentestRunner } from '../../../dist/testing/agentest-runner.js';

test('AgentestRunner local fallback: scenario passes when keywords present', async () => {
  const runner = new AgentestRunner();
  assert.equal(runner.isConfigured(), false);
  const results = await runner.run(
    [
      {
        name: 'greeting',
        userMessages: ['say hello world'],
        expectedGoal: 'hello world greeting',
      },
    ],
    async (msg) => `got ${msg}; hello world greeting`,
  );
  assert.equal(results.length, 1);
  assert.equal(results[0].passed, true);
  assert.equal(results[0].score, 1);
});

test('AgentestRunner local fallback: scenario fails on missing keyword', async () => {
  const runner = new AgentestRunner();
  const results = await runner.run(
    [
      {
        name: 'memory',
        userMessages: ['save note', 'recall'],
        expectedGoal: 'memory recall succeeded notebook',
      },
    ],
    async () => 'nothing useful',
  );
  assert.equal(results[0].passed, false);
  assert.equal(results[0].details, 'missing-keywords');
});

test('AgentestRunner uses SDK Evaluator when configured', async () => {
  const runner = new AgentestRunner({
    apiKey: 'tk',
    loader: async () => ({
      Evaluator: class {
        async evaluate() {
          return { passed: true, score: 0.9, summary: 'ok' };
        }
      },
    }),
  });
  assert.equal(runner.isConfigured(), true);
  const results = await runner.run(
    [{ name: 's1', userMessages: ['hi'], expectedGoal: 'anything' }],
    async () => 'reply',
  );
  assert.equal(results[0].passed, true);
  assert.equal(results[0].score, 0.9);
  assert.equal(results[0].details, 'ok');
});
