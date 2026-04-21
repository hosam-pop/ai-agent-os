import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeHealthReport, probeUpstream } from '../../../dist/api-gateway/routes/health.js';

function fakeFetch(map: Record<string, { ok: boolean; status?: number; delay?: number; error?: string }>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    const entry = map[url];
    if (!entry) throw new Error(`unexpected fetch: ${url}`);
    if (entry.delay) await new Promise(r => setTimeout(r, entry.delay));
    if (entry.error) throw new Error(entry.error);
    return {
      ok: entry.ok,
      status: entry.status ?? (entry.ok ? 200 : 500),
      arrayBuffer: async () => new ArrayBuffer(0),
      headers: new Headers(),
    } as unknown as Response;
  }) as typeof fetch;
}

test('probeUpstream reports configured=false when no URL', async () => {
  const res = await probeUpstream(
    { key: 'x', name: 'X', healthPath: '/health' },
    fetchImplNever(),
    100,
  );
  assert.equal(res.configured, false);
  assert.equal(res.ok, false);
});

function fetchImplNever(): typeof fetch {
  return (async () => {
    throw new Error('should not be called');
  }) as typeof fetch;
}

test('probeUpstream captures 200', async () => {
  const res = await probeUpstream(
    { key: 'a', name: 'A', url: 'http://a', healthPath: '/h' },
    fakeFetch({ 'http://a/h': { ok: true, status: 200 } }),
    500,
  );
  assert.equal(res.ok, true);
  assert.equal(res.statusCode, 200);
  assert.equal(typeof res.latencyMs, 'number');
});

test('probeUpstream captures upstream error', async () => {
  const res = await probeUpstream(
    { key: 'b', name: 'B', url: 'http://b', healthPath: '/h' },
    fakeFetch({ 'http://b/h': { ok: false, error: 'ECONNREFUSED' } }),
    500,
  );
  assert.equal(res.ok, false);
  assert.match(res.error ?? '', /ECONNREFUSED/);
});

test('computeHealthReport is ok when all configured upstreams ok', async () => {
  const report = await computeHealthReport({
    upstreams: [
      { key: 'a', name: 'A', url: 'http://a', healthPath: '/h' },
      { key: 'b', name: 'B', url: 'http://b', healthPath: '/h' },
    ],
    version: '1.0.0',
    startedAt: new Date(Date.now() - 1000),
    fetchImpl: fakeFetch({
      'http://a/h': { ok: true },
      'http://b/h': { ok: true },
    }),
    timeoutMs: 500,
  });
  assert.equal(report.status, 'ok');
  assert.equal(report.upstreams.length, 2);
});

test('computeHealthReport degrades when one upstream down', async () => {
  const report = await computeHealthReport({
    upstreams: [
      { key: 'a', name: 'A', url: 'http://a', healthPath: '/h' },
      { key: 'b', name: 'B', url: 'http://b', healthPath: '/h' },
    ],
    version: '1.0.0',
    startedAt: new Date(),
    fetchImpl: fakeFetch({
      'http://a/h': { ok: true },
      'http://b/h': { ok: false },
    }),
    timeoutMs: 500,
  });
  assert.equal(report.status, 'degraded');
});

test('computeHealthReport is down when every configured upstream fails', async () => {
  const report = await computeHealthReport({
    upstreams: [{ key: 'a', name: 'A', url: 'http://a', healthPath: '/h' }],
    version: '1.0.0',
    startedAt: new Date(),
    fetchImpl: fakeFetch({
      'http://a/h': { ok: false, error: 'boom' },
    }),
    timeoutMs: 500,
  });
  assert.equal(report.status, 'down');
});

test('computeHealthReport is ok when no upstreams configured', async () => {
  const report = await computeHealthReport({
    upstreams: [{ key: 'a', name: 'A', healthPath: '/h' }],
    version: '1.0.0',
    startedAt: new Date(),
    fetchImpl: fetchImplNever(),
    timeoutMs: 500,
  });
  assert.equal(report.status, 'ok');
  assert.equal(report.upstreams[0]!.configured, false);
});
