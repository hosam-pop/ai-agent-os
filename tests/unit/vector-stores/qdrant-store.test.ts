import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QdrantStore } from '../../../dist/vector-stores/qdrant-store.js';

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  });
}

test('QdrantStore.ensureCollection probes /exists then PUTs /collections/{name}', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), method: init?.method, body: init?.body });
    if (String(url).endsWith('/exists')) {
      return jsonResponse({ result: { exists: false } });
    }
    return jsonResponse({ result: true });
  };
  const store = new QdrantStore({ baseUrl: 'http://qdrant.local', fetchImpl });
  const res = await store.ensureCollection('docs', 128);
  assert.equal(res.ok, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].method, 'GET');
  assert.match(calls[0].url, /\/collections\/docs\/exists$/);
  assert.equal(calls[1].method, 'PUT');
  assert.match(calls[1].url, /\/collections\/docs$/);
  const body = JSON.parse(calls[1].body);
  assert.equal(body.vectors.size, 128);
  assert.equal(body.vectors.distance, 'Cosine');
});

test('QdrantStore.ensureCollection is idempotent when collection already exists', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), method: init?.method });
    if (String(url).endsWith('/exists')) {
      return jsonResponse({ result: { exists: true } });
    }
    throw new Error('should not PUT when /exists returns true');
  };
  const store = new QdrantStore({ baseUrl: 'http://qdrant.local', fetchImpl });
  const res = await store.ensureCollection('docs', 128);
  assert.equal(res.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'GET');
});

test('QdrantStore.ensureCollection treats 409 from PUT as success (race fallback)', async () => {
  const fetchImpl = async (url) => {
    if (String(url).endsWith('/exists')) {
      // Older Qdrant builds without /exists return 404.
      return new Response('not found', { status: 404 });
    }
    return new Response('{"status":{"error":"already exists"}}', { status: 409 });
  };
  const store = new QdrantStore({ baseUrl: 'http://qdrant.local', fetchImpl });
  const res = await store.ensureCollection('docs', 128);
  assert.equal(res.ok, true);
});

test('QdrantStore.upsert passes numeric ids through unchanged', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), body: init?.body });
    return jsonResponse({});
  };
  const store = new QdrantStore({ fetchImpl });
  const res = await store.upsert('docs', [
    { id: 42, vector: [0.1, 0.2] },
    { id: '11111111-1111-1111-1111-111111111111', vector: [0.3, 0.4] },
  ]);
  assert.equal(res.ok, true);
  const body = JSON.parse(calls[0].body);
  assert.equal(body.points[0].id, 42);
  assert.equal(typeof body.points[0].id, 'number');
  assert.equal(body.points[1].id, '11111111-1111-1111-1111-111111111111');
});

test('QdrantStore.deleteByIds accepts numeric ids', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), body: init?.body });
    return jsonResponse({});
  };
  const store = new QdrantStore({ fetchImpl });
  const res = await store.deleteByIds('docs', [1, 2, 3]);
  assert.equal(res.ok, true);
  const body = JSON.parse(calls[0].body);
  assert.deepEqual(body.points, [1, 2, 3]);
});

test('QdrantStore.upsert short-circuits when points are empty', async () => {
  let called = false;
  const store = new QdrantStore({ fetchImpl: async () => { called = true; return jsonResponse({}); } });
  const res = await store.upsert('docs', []);
  assert.equal(res.ok, true);
  assert.equal(called, false);
});

test('QdrantStore.search returns typed matches with preserved id type', async () => {
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
  assert.equal(res.matches[1].id, 2);
  assert.equal(typeof res.matches[1].id, 'number');
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
