import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TemporalMemory,
  ZepTemporalWriter,
} from '../../../dist/memory/temporal-memory.js';

test('TemporalMemory tracks latest value per (subject,predicate)', async () => {
  let t = 1000;
  const mem = new TemporalMemory({ now: () => t });
  await mem.observe({ subject: 'user:hosam', predicate: 'pref:lang', value: 'ar' });
  t = 2000;
  await mem.observe({ subject: 'user:hosam', predicate: 'pref:lang', value: 'en' });
  const latest = mem.latest('user:hosam', 'pref:lang');
  assert.equal(latest?.value, 'en');
  assert.equal(mem.size(), 2);
});

test('TemporalMemory.history returns entries oldest-first', async () => {
  const mem = new TemporalMemory();
  await mem.observe({ subject: 'x', predicate: 'p', value: '1', observedAt: 5 });
  await mem.observe({ subject: 'x', predicate: 'p', value: '2', observedAt: 3 });
  const hist = mem.history('x', 'p');
  assert.deepEqual(hist.map((h) => h.value), ['2', '1']);
});

test('TemporalMemory.between filters to the requested window', async () => {
  const mem = new TemporalMemory();
  await mem.observe({ subject: 'x', predicate: 'p', value: '1', observedAt: 5 });
  await mem.observe({ subject: 'x', predicate: 'p', value: '2', observedAt: 15 });
  await mem.observe({ subject: 'x', predicate: 'p', value: '3', observedAt: 25 });
  const window = mem.between(10, 20);
  assert.equal(window.length, 1);
  assert.equal(window[0]?.value, '2');
});

test('ZepTemporalWriter forwards a JSON envelope to a Zep-compatible adapter', async () => {
  const calls: unknown[] = [];
  const fake = { add: async (msg: unknown) => calls.push(msg) };
  const writer = new ZepTemporalWriter(fake);
  await writer.write({
    subject: 's',
    predicate: 'p',
    value: 'v',
    observedAt: 42,
  });
  assert.equal(calls.length, 1);
  const content = (calls[0] as { content: string }).content;
  const payload = JSON.parse(content);
  assert.equal(payload.kind, 'temporal-fact');
  assert.equal(payload.subject, 's');
  assert.equal(payload.observedAt, 42);
});
