import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OpenFangBridge } from '../../../dist/integrations/openfang/openfang-bridge.js';

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

test('OpenFangBridge soft-fails when endpoint is not configured', async () => {
  const b = new OpenFangBridge();
  assert.equal(b.isConfigured(), false);
  assert.deepEqual(await b.listHands(), []);
  const run = await b.runHand('noop', {});
  assert.equal(run.ok, false);
  assert.equal(run.error, 'openfang-not-configured');
});

test('OpenFangBridge.listHands parses hand objects from HTTP response', async () => {
  const b = new OpenFangBridge({
    endpoint: 'http://openfang.test',
    fetchImpl: makeFetch(() => ({
      body: { hands: [{ id: 'h1', name: 'First', description: 'd' }] },
    })),
  });
  const hands = await b.listHands();
  assert.equal(hands.length, 1);
  assert.equal(hands[0]?.id, 'h1');
});

test('OpenFangBridge.runHand forwards payload and returns run id', async () => {
  let seenBody: string | undefined;
  const b = new OpenFangBridge({
    endpoint: 'http://openfang.test/',
    apiKey: 'secret',
    fetchImpl: makeFetch((url, init) => {
      seenBody = init.body as string;
      assert.equal(url, 'http://openfang.test/api/hands/h1/run');
      assert.equal(
        (init.headers as Record<string, string>)['authorization'],
        'Bearer secret',
      );
      return { body: { run_id: 'r1', output: { ok: true } } };
    }),
  });
  const r = await b.runHand('h1', { hello: 'world' });
  assert.equal(r.ok, true);
  assert.equal(r.runId, 'r1');
  assert.deepEqual(r.output, { ok: true });
  assert.equal(JSON.parse(seenBody ?? '{}').hello, 'world');
});

test('OpenFangBridge.runHand surfaces upstream error payload', async () => {
  const b = new OpenFangBridge({
    endpoint: 'http://openfang.test',
    fetchImpl: makeFetch(() => ({ body: { error: 'policy-violation', run_id: 'r2' } })),
  });
  const r = await b.runHand('h1', {});
  assert.equal(r.ok, false);
  assert.equal(r.error, 'policy-violation');
  assert.equal(r.runId, 'r2');
});

test('OpenFangBridge.listHands returns [] on HTTP failure', async () => {
  const b = new OpenFangBridge({
    endpoint: 'http://openfang.test',
    fetchImpl: makeFetch(() => ({ status: 500, body: {} })),
  });
  const hands = await b.listHands();
  assert.deepEqual(hands, []);
});
