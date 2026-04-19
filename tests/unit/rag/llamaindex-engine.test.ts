import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LlamaIndexEngine,
  parseRetrievedNode,
} from '../../../dist/rag/llamaindex-engine.js';

function makeFakeModule() {
  const Document = class {
    constructor(init) { Object.assign(this, init); }
  };
  const VectorStoreIndex = {
    async fromDocuments(docs) {
      const store = docs.slice();
      return {
        docs: store,
        asRetriever({ similarityTopK } = {}) {
          return {
            async retrieve(query) {
              const q = query.toLowerCase();
              const ranked = store
                .map((d, i) => ({
                  node: {
                    id_: d.id_,
                    metadata: d.metadata,
                    getText: () => d.text,
                  },
                  score: d.text.toLowerCase().includes(q) ? 0.9 - i * 0.01 : 0.1,
                }))
                .sort((a, b) => b.score - a.score)
                .slice(0, similarityTopK ?? 5);
              return ranked;
            },
          };
        },
        asQueryEngine() {
          return {
            async query({ query }) { return { response: `answer-for:${query}` }; },
          };
        },
      };
    },
  };
  return { Document, VectorStoreIndex };
}

test('parseRetrievedNode extracts id, text, and score', () => {
  const chunk = parseRetrievedNode({
    node: { id_: 'n1', metadata: { k: 1 }, getText: () => 'body' },
    score: 0.5,
  });
  assert.equal(chunk.id, 'n1');
  assert.equal(chunk.text, 'body');
  assert.equal(chunk.score, 0.5);
  assert.deepEqual(chunk.metadata, { k: 1 });
});

test('parseRetrievedNode handles nodes without getText', () => {
  const chunk = parseRetrievedNode({ node: { id_: 'n2' }, score: 0.2 });
  assert.equal(chunk.text, '');
});

test('LlamaIndexEngine.indexDocuments then query returns ranked chunks', async () => {
  const engine = new LlamaIndexEngine({ moduleLoader: async () => makeFakeModule() });
  const ix = await engine.indexDocuments('kb', [
    { id: 'a', text: 'the quick brown fox' },
    { id: 'b', text: 'lazy dog' },
  ]);
  assert.equal(ix.ok, true);
  assert.equal(ix.indexed, 2);

  const q = await engine.query('kb', 'fox');
  assert.equal(q.ok, true);
  assert.ok(q.chunks.length > 0);
  assert.equal(q.chunks[0].id, 'a');
});

test('LlamaIndexEngine.query returns error when index missing', async () => {
  const engine = new LlamaIndexEngine({ moduleLoader: async () => makeFakeModule() });
  const q = await engine.query('nonexistent', 'whatever');
  assert.equal(q.ok, false);
  assert.match(q.error ?? '', /does not exist/);
});

test('LlamaIndexEngine.answer returns answer string plus chunks', async () => {
  const engine = new LlamaIndexEngine({ moduleLoader: async () => makeFakeModule() });
  await engine.indexDocuments('kb', [{ id: 'a', text: 'hello world' }]);
  const q = await engine.answer('kb', 'what is there?');
  assert.equal(q.ok, true);
  assert.match(q.answer ?? '', /answer-for:what is there\?/);
});

test('LlamaIndexEngine.indexDocuments soft-fails when loader throws', async () => {
  const engine = new LlamaIndexEngine({
    moduleLoader: async () => { throw new Error('no llamaindex package'); },
  });
  const ix = await engine.indexDocuments('kb', [{ id: 'a', text: 'x' }]);
  assert.equal(ix.ok, false);
  assert.match(ix.error ?? '', /llamaindex/);
});

test('LlamaIndexEngine.indexDocuments returns early on empty documents', async () => {
  let loaderCalled = false;
  const engine = new LlamaIndexEngine({
    moduleLoader: async () => { loaderCalled = true; return makeFakeModule(); },
  });
  const ix = await engine.indexDocuments('kb', []);
  assert.equal(ix.ok, true);
  assert.equal(ix.indexed, 0);
  assert.equal(loaderCalled, false);
});
