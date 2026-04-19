import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LanceDBStore, parseLanceDBRow } from '../../../dist/vector-stores/lancedb-store.js';

function makeFakeModule() {
  const tables = new Map();
  const connection = {
    async tableNames() { return [...tables.keys()]; },
    async openTable(name) {
      const t = tables.get(name);
      if (!t) throw new Error('no such table');
      return t;
    },
    async createTable(name, rows) {
      const table = makeFakeTable(rows);
      tables.set(name, table);
      return table;
    },
  };
  return {
    tables,
    async connect() { return connection; },
  };
}

function makeFakeTable(initialRows = []) {
  const rows = [...initialRows];
  return {
    rows,
    async add(newRows) { rows.push(...newRows); },
    async delete(filter) {
      const remaining = rows.filter((r) => !filterMatches(filter, r));
      rows.length = 0;
      rows.push(...remaining);
    },
    search(vector) {
      return makeSearchChain(rows, vector);
    },
  };
}

function filterMatches(filter, row) {
  const idInMatch = /id IN \((.+)\)/.exec(filter);
  if (idInMatch) {
    const ids = idInMatch[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
    return ids.includes(row.id);
  }
  const idEqMatch = /id = '([^']+)'/.exec(filter);
  if (idEqMatch) return row.id === idEqMatch[1];
  return false;
}

function makeSearchChain(rows, vector) {
  let limit = rows.length;
  let whereClause = null;
  const chain = {
    limit(n) { limit = n; return chain; },
    where(clause) { whereClause = clause; return chain; },
    async toArray() {
      let out = [...rows];
      if (whereClause) out = out.filter((r) => !filterMatches(whereClause, r) === false);
      return out.slice(0, limit).map((r) => ({ id: r.id, _distance: 0.1, payload: r.payload }));
    },
  };
  return chain;
}

test('parseLanceDBRow converts _distance to score', () => {
  const m = parseLanceDBRow({ id: 'x', _distance: 0.2, payload: { k: 1 } });
  assert.equal(m.id, 'x');
  assert.ok(Math.abs(m.score - 0.8) < 1e-9);
  assert.deepEqual(m.payload, { k: 1 });
});

test('parseLanceDBRow handles missing distance and numeric id', () => {
  const m = parseLanceDBRow({ id: 7, score: 0.5 });
  assert.equal(m.id, '7');
  assert.equal(m.score, 0.5);
});

test('LanceDBStore.ensureCollection creates table via injected module loader', async () => {
  const mod = makeFakeModule();
  const store = new LanceDBStore({ moduleLoader: async () => mod });
  const res = await store.ensureCollection('docs', 4);
  assert.equal(res.ok, true);
  assert.ok(mod.tables.has('docs'));
});

test('LanceDBStore.ensureCollection soft-fails when module loader throws', async () => {
  const store = new LanceDBStore({ moduleLoader: async () => { throw new Error('no native binding'); } });
  const res = await store.ensureCollection('docs', 4);
  assert.equal(res.ok, false);
  assert.match(res.error ?? '', /no native binding/);
});

test('LanceDBStore.upsert then search returns typed matches', async () => {
  const mod = makeFakeModule();
  const store = new LanceDBStore({ moduleLoader: async () => mod });
  await store.ensureCollection('docs', 3);
  const u = await store.upsert('docs', [
    { id: 'a', vector: [1, 0, 0], payload: { k: 1 } },
    { id: 'b', vector: [0, 1, 0], payload: { k: 2 } },
  ]);
  assert.equal(u.ok, true);
  const s = await store.search('docs', { vector: [1, 0, 0], limit: 5 });
  assert.equal(s.ok, true);
  assert.ok(s.matches.length >= 1);
  assert.equal(s.matches[0].id, 'a');
});

test('LanceDBStore.deleteByIds short-circuits on empty ids', async () => {
  const mod = makeFakeModule();
  const store = new LanceDBStore({ moduleLoader: async () => mod });
  await store.ensureCollection('docs', 2);
  const res = await store.deleteByIds('docs', []);
  assert.equal(res.ok, true);
});
