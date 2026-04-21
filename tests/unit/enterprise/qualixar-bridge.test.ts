import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QualixarBridge } from '../../../dist/integrations/qualixar/qualixar-bridge.js';

function makeFetch(
  handler: (url: string, init: RequestInit) => { status?: number; body: unknown },
): typeof fetch {
  return (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input.toString();
    const { status = 200, body } = handler(url, init);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as unknown as Response;
  }) as typeof fetch;
}

test('QualixarBridge soft-fails with empty tool list when endpoint is missing', async () => {
  const b = new QualixarBridge();
  assert.equal(b.isConfigured(), false);
  assert.deepEqual(await b.listTools(), []);
});

test('QualixarBridge.listTools decodes the federated tool list', async () => {
  const b = new QualixarBridge({
    endpoint: 'http://qualixar.test',
    fetchImpl: makeFetch(() => ({
      body: {
        tools: [
          { name: 'git.status', server: 'git-mcp', description: '' },
          { name: 'web.fetch', server: 'http-mcp' },
        ],
      },
    })),
  });
  const tools = await b.listTools();
  assert.equal(tools.length, 2);
  assert.equal(tools[0]?.server, 'git-mcp');
});

test('QualixarBridge.invoke returns ok + output on success', async () => {
  const b = new QualixarBridge({
    endpoint: 'http://qualixar.test',
    fetchImpl: makeFetch((url) => {
      assert.equal(url, 'http://qualixar.test/tools/git.status/invoke');
      return { body: { output: { branch: 'main' } } };
    }),
  });
  const r = await b.invoke('git.status', {});
  assert.equal(r.ok, true);
  assert.deepEqual(r.output, { branch: 'main' });
});

test('QualixarBridge.invoke returns error on HTTP failure', async () => {
  const b = new QualixarBridge({
    endpoint: 'http://qualixar.test',
    fetchImpl: makeFetch(() => ({ status: 404, body: {} })),
  });
  const r = await b.invoke('missing', {});
  assert.equal(r.ok, false);
});
