import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GroupChat,
  keywordSelector,
  roundRobinSelector,
  terminatesOn,
} from '../../../dist/orchestration/group-chat.js';

test('GroupChat rotates agents round-robin and respects maxTurns', async () => {
  const a1 = { name: 'alpha', async respond() { return 'alpha says hi'; } };
  const a2 = { name: 'beta', async respond() { return 'beta says hello'; } };
  const chat = new GroupChat({ agents: [a1, a2], maxTurns: 3 });
  const result = await chat.run({ task: 'greet each other' });
  assert.equal(result.reason, 'max-turns');
  assert.equal(result.transcript[0].from, 'user');
  assert.equal(result.transcript[1].from, 'alpha');
  assert.equal(result.transcript[2].from, 'beta');
  assert.equal(result.transcript[3].from, 'alpha');
});

test('GroupChat terminates via predicate and supports keyword selectors', async () => {
  const router = {
    name: 'router',
    async respond() {
      return 'I will hand this to the coder please.';
    },
  };
  const coder = {
    name: 'coder',
    async respond() {
      return 'Done. FINAL';
    },
  };
  const chat = new GroupChat({
    agents: [router, coder],
    initiator: 'router',
    selector: keywordSelector({ coder: 'coder' }, 'router'),
    terminate: terminatesOn('FINAL'),
    maxTurns: 5,
  });
  const result = await chat.run({ task: 'solve it' });
  assert.equal(result.reason, 'terminated');
  assert.equal(result.transcript[result.transcript.length - 1].from, 'coder');
});

test('roundRobinSelector wraps correctly', () => {
  const chat = new GroupChat({
    agents: [
      { name: 'a', async respond() { return ''; } },
      { name: 'b', async respond() { return ''; } },
    ],
  });
  const transcript = [
    { from: 'user', content: 'x', timestamp: 0 },
    { from: 'a', content: 'y', timestamp: 1 },
    { from: 'b', content: 'z', timestamp: 2 },
  ];
  assert.equal(roundRobinSelector(transcript, chat), 'a');
});
