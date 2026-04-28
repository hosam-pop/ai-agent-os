import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVectorMatch } from '../../../dist/vector-stores/vector-store.js';

test('parseVectorMatch extracts id, score, and payload', () => {
  const m = parseVectorMatch({ id: 'x', score: 0.7, payload: { k: 1 } }, 0);
  assert.equal(m.id, 'x');
  assert.equal(m.score, 0.7);
  assert.deepEqual(m.payload, { k: 1 });
});

test('parseVectorMatch preserves numeric ids verbatim', () => {
  const m = parseVectorMatch({ id: 42, score: 0.5 }, 0);
  assert.equal(m.id, 42);
  assert.equal(typeof m.id, 'number');
});

test('parseVectorMatch converts distance to (1 - distance) score', () => {
  const m = parseVectorMatch({ id: 'y', distance: 0.25 }, 0);
  assert.equal(m.score, 0.75);
});

test('parseVectorMatch falls back when id missing', () => {
  const m = parseVectorMatch({ score: 0.1 }, 4);
  assert.equal(m.id, 'match-4');
});

test('parseVectorMatch handles nullish and non-object input', () => {
  assert.equal(parseVectorMatch(null, 0).id, 'match-0');
  assert.equal(parseVectorMatch(undefined, 2).id, 'match-2');
  assert.equal(parseVectorMatch(42, 3).id, 'match-3');
});

test('parseVectorMatch reads metadata when payload missing', () => {
  const m = parseVectorMatch({ id: 'z', score: 0.1, metadata: { tag: 'a' } }, 0);
  assert.deepEqual(m.payload, { tag: 'a' });
});
