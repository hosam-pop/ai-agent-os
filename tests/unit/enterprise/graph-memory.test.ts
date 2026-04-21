import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGraphMemory } from '../../../dist/memory/graph-memory.js';

test('createGraphMemory falls back to in-memory store when kuzu is unavailable', async () => {
  const g = await createGraphMemory({ kuzuLoader: async () => null });
  assert.equal(g.backend, 'memory');
});

test('in-memory graph memory stores nodes and walks edges', async () => {
  const g = await createGraphMemory();
  await g.addNode({ id: 'u1', label: 'User', properties: { name: 'hosam' } });
  await g.addNode({ id: 'p1', label: 'Project' });
  await g.addEdge({ from: 'u1', to: 'p1', relation: 'OWNS' });
  const nbrs = await g.neighbours('u1');
  assert.equal(nbrs.length, 1);
  assert.equal(nbrs[0]?.id, 'p1');
  const filtered = await g.neighbours('u1', 'COLLABORATES');
  assert.equal(filtered.length, 0);
});

test('in-memory graph memory supports a minimal MATCH...RETURN query', async () => {
  const g = await createGraphMemory();
  await g.addNode({ id: 'a', label: 'User' });
  await g.addNode({ id: 'b', label: 'User' });
  await g.addNode({ id: 'c', label: 'Bot' });
  const res = await g.query('MATCH (n:User) RETURN n');
  assert.equal(res.rows.length, 2);
});

test('createGraphMemory uses the kuzu binding when loader returns one', async () => {
  const executed: string[] = [];
  class FakeDatabase {
    path: string;
    constructor(path: string) {
      this.path = path;
    }
  }
  class FakeConnection {
    async execute(stmt: string) {
      executed.push(stmt);
      return { getAll: async () => [] };
    }
    close() {
      executed.push('close');
    }
  }
  const loader = async () => ({ Database: FakeDatabase, Connection: FakeConnection });
  const g = await createGraphMemory({ dbPath: '/tmp/kuzu-fake', kuzuLoader: loader });
  assert.equal(g.backend, 'kuzu');
  await g.addNode({ id: 'x', label: 'Lbl' });
  await g.close();
  assert.ok(executed.some((s) => s.includes('CREATE (:Lbl')));
  assert.ok(executed.includes('close'));
});
