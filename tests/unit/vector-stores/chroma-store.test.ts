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

test('ChromaStore.ensureCollection POSTs to v2 tenant/database scope and caches id', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), method: init?.method, body: init?.body });
    return jsonResponse({ id: 'col-1', name: 'docs' });
  };
  const store = new ChromaStore({ baseUrl: 'http://chroma.local', fetchImpl });
  const res = await store.ensureCollection('docs', 128);
  assert.equal(res.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST');
  assert.match(
    calls[0].url,
    /\/api\/v2\/tenants\/default_tenant\/databases\/default_database\/collections$/,
  );
  const body = JSON.parse(calls[0].body);
  assert.equal(body.name, 'docs');
  assert.equal(body.get_or_create, true);
});

test('ChromaStore honours custom tenant + database options', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    return jsonResponse({ id: 'c', name: 'docs' });
  };
  const store = new ChromaStore({
    baseUrl: 'http://chroma.local',
    tenant: 'my-tenant',
    database: 'my-db',
    fetchImpl,
  });
  await store.ensureCollection('docs', 8);
  assert.match(
    calls[0],
    /\/api\/v2\/tenants\/my-tenant\/databases\/my-db\/collections$/,
  );
});

test('ChromaStore.upsert POSTs to v2 upsert endpoint and coerces numeric ids', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), body: init?.body });
    if (String(url).endsWith('/collections')) {
      return jsonResponse({ id: 'col-1', name: 'docs' });
    }
    return jsonResponse({});
  };
  const store = new ChromaStore({ baseUrl: 'http://chroma.local', fetchImpl });
  await store.ensureCollection('docs', 4);
  const res = await store.upsert('docs', [
    { id: 1, vector: [0.1, 0.2] },
    { id: 'b', vector: [0.3, 0.4], payload: { text: 'hello' } },
  ]);
  assert.equal(res.ok, true);
  const upsertCall = calls[1];
  assert.match(
    upsertCall.url,
    /\/api\/v2\/tenants\/default_tenant\/databases\/default_database\/collections\/col-1\/upsert$/,
  );
  const body = JSON.parse(upsertCall.body);
  assert.deepEqual(body.ids, ['1', 'b']);
  assert.deepEqual(body.embeddings, [[0.1, 0.2], [0.3, 0.4]]);
});

test('ChromaStore.search posts v2 query body with include list', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), body: init?.body });
    if (String(url).endsWith('/collections')) {
      return jsonResponse({ id: 'col-1', name: 'docs' });
    }
    return jsonResponse({
      ids: [['a']],
      distances: [[0.2]],
      metadatas: [[{}]],
      documents: [['doc-a']],
    });
  };
  const store = new ChromaStore({ baseUrl: 'http://chroma.local', fetchImpl });
  await store.ensureCollection('docs', 4);
  const res = await store.search('docs', { vector: [1, 0, 0, 0], limit: 3 });
  assert.equal(res.ok, true);
  assert.equal(res.matches.length, 1);
  const queryCall = calls[1];
  assert.match(queryCall.url, /\/collections\/col-1\/query$/);
  const body = JSON.parse(queryCall.body);
  assert.deepEqual(body.query_embeddings, [[1, 0, 0, 0]]);
  assert.equal(body.n_results, 3);
  assert.deepEqual(body.include, ['metadatas', 'distances', 'documents']);
});

test('ChromaStore.deleteByIds POSTs to v2 delete endpoint and stringifies ids', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), body: init?.body });
    if (String(url).endsWith('/collections')) {
      return jsonResponse({ id: 'col-1', name: 'docs' });
    }
    return jsonResponse({});
  };
  const store = new ChromaStore({ baseUrl: 'http://chroma.local', fetchImpl });
  await store.ensureCollection('docs', 4);
  const res = await store.deleteByIds('docs', [1, 'b', 3]);
  assert.equal(res.ok, true);
  const deleteCall = calls[1];
  assert.match(deleteCall.url, /\/collections\/col-1\/delete$/);
  const body = JSON.parse(deleteCall.body);
  assert.deepEqual(body.ids, ['1', 'b', '3']);
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
