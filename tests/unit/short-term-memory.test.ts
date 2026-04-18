import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ShortTermMemory } from '../../dist/memory/short-term.js';

test('appends and snapshots messages', () => {
  const m = new ShortTermMemory(1000);
  m.append({ role: 'user', content: 'hello' });
  m.append({ role: 'assistant', content: 'hi' });
  assert.equal(m.length(), 2);
  const snap = m.snapshot();
  assert.equal(snap[0]?.content, 'hello');
  assert.equal(snap[1]?.content, 'hi');
});

test('over-budget flips when estimated tokens exceed budget', () => {
  const m = new ShortTermMemory(2);
  m.append({ role: 'user', content: 'x'.repeat(10000) });
  assert.ok(m.overBudget());
});

test('replace swaps the entire message buffer', () => {
  const m = new ShortTermMemory(100);
  m.append({ role: 'user', content: 'a' });
  m.append({ role: 'user', content: 'b' });
  m.replace([{ role: 'assistant', content: 'summary' }]);
  assert.equal(m.length(), 1);
  assert.equal(m.snapshot()[0]?.content, 'summary');
});
