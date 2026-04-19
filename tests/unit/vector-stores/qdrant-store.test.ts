import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QdrantStore } from '../../../dist/vector-stores/qdrant-store.js';

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  });
}

test('QdrantStore.ensureCollection PUTs to /collections/{name}', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), method: init?.method, body: init?.body });
    return jsonResponse({ result: true });
  };
  const store = new QdrantStore({ baseUrl: 'http://qdrant.local', fetchImpl });
  const res = await store.ensureCollection('docs', 128);
  assert.equal(res.ok, true);
  assert.equal(calls[0].method, 'PUT');
  assert.match(calls[0].url, /\/collections\/docs$/);
  const body = JSON.parse(calls[0].body);
  assert.equal(body.vectors.size, 128);
  assert.equal(body.vectors.distance, 'Cosine');
});

test('QdrantStore.upsert short-circuits when points are empty', async () => {
  let called = false;
  const store = new QdrantStore({ fetchImpl: async () => { called = true; return jsonResponse({}); } });
  const res = await store.upsert('docs', []);
  assert.equal(res.ok, true);
  assert.equal(called, false);
});

test('QdrantStore.search returns typed matches', async () => {
  const fetchImpl = async () =>
    jsonResponse({
      result: [
        { id: 'a', score: 0.9, payload: { k: 1 } },
        { id: 2, score: 0.7, payload: { k: 2 } },
      ],
    });
  const store = new QdrantStore({ fetchImpl });
  const res = await store.search('docs', { vector: [1, 2, 3], limit: 5 });
  assert.equal(res.ok, true);
  assert.equal(res.matches.length, 2);
  assert.equal(res.matches[0].id, 'a');
  assert.equal(res.matches[1].id, '2');
});

test('QdrantStore.search soft-fails on HTTP 500', async () => {
  const fetchImpl = async () => new Response('bad', { status: 500 });
  const store = new QdrantStore({ fetchImpl });
  const res = await store.search('docs', { vector: [0.1] });
  assert.equal(res.ok, false);
  assert.deepEqual(res.matches, []);
});

test('QdrantStore.ensureCollection rejects empty name', async () => {
  const store = new QdrantStore({ fetchImpl: async () => jsonResponse({}) });
  const res = await store.ensureCollection('', 8);
  assert.equal(res.ok, false);
});
