import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChromaStore, decodeChromaQuery } from '../../../dist/vector-stores/chroma-store.js';

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  });
}

test('decodeChromaQuery converts distances to scores and merges documents', () => {
  const matches = decodeChromaQuery({
    ids: [['a', 'b']],
    distances: [[0.1, 0.4]],
    metadatas: [[{ k: 1 }, null]],
    documents: [['doc-a', 'doc-b']],
  });
  assert.equal(matches.length, 2);
  assert.equal(matches[0].id, 'a');
  assert.ok(Math.abs(matches[0].score - 0.9) < 1e-9);
  assert.equal(matches[0].payload?.document, 'doc-a');
  assert.equal(matches[0].payload?.k, 1);
  assert.equal(matches[1].payload?.document, 'doc-b');
});

test('decodeChromaQuery tolerates missing arrays', () => {
  const matches = decodeChromaQuery({});
  assert.deepEqual(matches, []);
});

test('ChromaStore.ensureCollection POSTs and caches id', async () => {
  const fetchImpl = async () => jsonResponse({ id: 'col-1', name: 'docs' });
  const store = new ChromaStore({ fetchImpl });
  const res = await store.ensureCollection('docs', 128);
  assert.equal(res.ok, true);
});

test('ChromaStore.search fails gracefully when collection is not resolved', async () => {
  const fetchImpl = async () => new Response('missing', { status: 404 });
  const store = new ChromaStore({ fetchImpl });
  const res = await store.search('nonexistent', { vector: [1] });
  assert.equal(res.ok, false);
  assert.deepEqual(res.matches, []);
});

test('ChromaStore.upsert short-circuits on empty points', async () => {
  let called = false;
  const store = new ChromaStore({
    fetchImpl: async () => { called = true; return jsonResponse({}); },
  });
  const res = await store.upsert('docs', []);
  assert.equal(res.ok, true);
  assert.equal(called, false);
});
