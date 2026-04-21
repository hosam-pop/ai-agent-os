import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HybridRetriever } from '../../../dist/memory/hybrid-retriever.js';

test('HybridRetriever.bm25 ranks matching docs above non-matching', () => {
  const r = new HybridRetriever();
  r.addDocument({ id: 'a', text: 'the quick brown fox jumps over the lazy dog' });
  r.addDocument({ id: 'b', text: 'agent memory graph database with vector search' });
  r.addDocument({ id: 'c', text: 'an unrelated sentence about weather today' });
  const ranked = r.bm25('agent memory');
  assert.ok(ranked.length >= 1);
  assert.equal(ranked[0]?.id, 'b');
});

test('HybridRetriever merges BM25 and vector scores via weighted sum', async () => {
  const r = new HybridRetriever({ bm25Weight: 0.4, vectorWeight: 0.6 });
  r.addDocument({ id: 'a', text: 'exact keyword alpha' });
  r.addDocument({ id: 'b', text: 'something else bravo' });
  const vectorSearch = async () => [
    { id: 'b', score: 0.9 },
    { id: 'a', score: 0.1 },
  ];
  const results = await r.retrieve('alpha', vectorSearch, 2);
  assert.equal(results.length, 2);
  // `a` wins on BM25, `b` wins on vector; with weights 0.4/0.6 vector
  // dominates here.
  assert.equal(results[0]?.id, 'b');
  assert.ok(results[0]!.score >= results[1]!.score);
});

test('HybridRetriever survives vector search errors', async () => {
  const r = new HybridRetriever();
  r.addDocument({ id: 'a', text: 'agent memory' });
  const badVector = async () => {
    throw new Error('vector-down');
  };
  const results = await r.retrieve('agent', badVector, 5);
  assert.equal(results.length, 1);
  assert.equal(results[0]?.id, 'a');
});

test('HybridRetriever.removeDocument drops a doc from BM25 state', () => {
  const r = new HybridRetriever();
  r.addDocument({ id: 'a', text: 'agent memory' });
  r.addDocument({ id: 'b', text: 'agent memory' });
  r.removeDocument('a');
  const ranked = r.bm25('agent');
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0]?.id, 'b');
});
