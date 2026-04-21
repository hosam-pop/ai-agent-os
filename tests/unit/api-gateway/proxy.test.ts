import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildForwardUrl, filterRequestHeaders } from '../../../dist/api-gateway/routes/proxy.js';

test('buildForwardUrl strips mount path and preserves query', () => {
  const url = buildForwardUrl(
    { mountPath: '/api/agent', upstreamUrl: 'http://aaos:3100', name: 'ai-agent-os' },
    '/api/agent/tasks/list?limit=10',
  );
  assert.equal(url, 'http://aaos:3100/tasks/list?limit=10');
});

test('buildForwardUrl normalises trailing slash and empty path', () => {
  const url = buildForwardUrl(
    { mountPath: '/api/chat', upstreamUrl: 'http://librechat:3080/', name: 'librechat' },
    '/api/chat',
  );
  assert.equal(url, 'http://librechat:3080/');
});

test('buildForwardUrl applies custom rewrite', () => {
  const url = buildForwardUrl(
    {
      mountPath: '/api/orchestrate',
      upstreamUrl: 'http://qualixar:3004',
      name: 'qualixar',
      rewritePath: p => `/v1/tasks${p}`,
    },
    '/api/orchestrate/run?sync=1',
  );
  assert.equal(url, 'http://qualixar:3004/v1/tasks/run?sync=1');
});

test('buildForwardUrl throws when upstream missing', () => {
  assert.throws(() =>
    buildForwardUrl(
      { mountPath: '/api/agent', upstreamUrl: undefined, name: 'missing' },
      '/api/agent/x',
    ),
  );
});

test('filterRequestHeaders drops hop-by-hop + authorization', () => {
  const out = filterRequestHeaders({
    connection: 'keep-alive',
    'transfer-encoding': 'chunked',
    host: 'gateway.local',
    authorization: 'Bearer abc',
    'x-custom': 'keep',
    cookie: 'sid=1',
  } as any);
  assert.equal(out.connection, undefined);
  assert.equal(out['transfer-encoding'], undefined);
  assert.equal(out.host, undefined);
  assert.equal(out.authorization, undefined);
  assert.equal(out['x-custom'], 'keep');
  assert.equal(out.cookie, 'sid=1');
});

test('filterRequestHeaders joins array values', () => {
  const out = filterRequestHeaders({
    'x-multi': ['a', 'b', 'c'],
  } as any);
  assert.equal(out['x-multi'], 'a, b, c');
});
