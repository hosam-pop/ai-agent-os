import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AIRouter } from '../../dist/integrations/router/ai-router.js';

function makeProvider(name, behaviour) {
  return {
    name,
    async complete(req) {
      if (behaviour === 'fail') throw new Error(`${name} boom`);
      return {
        message: { role: 'assistant', content: [{ type: 'text', text: `${name}:${req.model ?? 'default'}` }] },
        stopReason: 'end_turn',
        usage: { inputTokens: 1, outputTokens: 1 },
      };
    },
  };
}

test('failover strategy falls through to next backend on error', async () => {
  const router = new AIRouter(
    [
      { name: 'a', provider: makeProvider('a', 'fail') },
      { name: 'b', provider: makeProvider('b', 'ok') },
    ],
    { strategy: 'failover' },
  );
  const out = await router.complete({ model: 'm', messages: [] });
  assert.match(out.message.content[0].text, /^b:m$/);
});

test('round-robin rotates backends across calls', async () => {
  const router = new AIRouter(
    [
      { name: 'a', provider: makeProvider('a', 'ok') },
      { name: 'b', provider: makeProvider('b', 'ok') },
    ],
    { strategy: 'round-robin' },
  );
  const first = await router.complete({ model: 'm', messages: [] });
  const second = await router.complete({ model: 'm', messages: [] });
  assert.notEqual(first.message.content[0].text, second.message.content[0].text);
});

test('empty backend list throws at construction time', () => {
  assert.throws(() => new AIRouter([]));
});

test('exhausted backends surface the last error', async () => {
  const router = new AIRouter(
    [
      { name: 'a', provider: makeProvider('a', 'fail') },
      { name: 'b', provider: makeProvider('b', 'fail') },
    ],
    { strategy: 'failover' },
  );
  await assert.rejects(() => router.complete({ model: 'm', messages: [] }), /exhausted/);
});
