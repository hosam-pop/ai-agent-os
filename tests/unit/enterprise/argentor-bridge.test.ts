import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ArgentorBridge } from '../../../dist/integrations/argentor/argentor-bridge.js';

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

test('ArgentorBridge allows actions when endpoint is not configured (soft-fail)', async () => {
  const b = new ArgentorBridge();
  const r = await b.checkPolicy('tool:file:write', { path: '/tmp/x' });
  assert.equal(r.allowed, true);
  assert.equal(r.rationale, 'argentor-not-configured');
});

test('ArgentorBridge.checkPolicy decodes allow/deny responses', async () => {
  const allowBridge = new ArgentorBridge({
    endpoint: 'http://argentor.test',
    fetchImpl: makeFetch(() => ({
      body: { allowed: true, rationale: 'ok', risk_score: 0.1 },
    })),
  });
  const a = await allowBridge.checkPolicy('x', {});
  assert.equal(a.allowed, true);
  assert.equal(a.riskScore, 0.1);

  const denyBridge = new ArgentorBridge({
    endpoint: 'http://argentor.test',
    fetchImpl: makeFetch(() => ({
      body: {
        allowed: false,
        rationale: 'pii-in-prompt',
        violations: ['pii.email'],
      },
    })),
  });
  const d = await denyBridge.checkPolicy('x', {});
  assert.equal(d.allowed, false);
  assert.deepEqual(d.violations, ['pii.email']);
});

test('ArgentorBridge denies on HTTP error', async () => {
  const b = new ArgentorBridge({
    endpoint: 'http://argentor.test',
    fetchImpl: makeFetch(() => ({ status: 500, body: {} })),
  });
  const r = await b.checkPolicy('x', {});
  assert.equal(r.allowed, false);
});
