import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseElasticResponse,
  ElasticClient,
} from '../../../dist/security/log-analysis/elastic-client.js';
import {
  parseWazuhResponse,
  WazuhClient,
} from '../../../dist/security/log-analysis/wazuh-client.js';

test('parseElasticResponse normalises total shapes and hits', () => {
  const body = {
    hits: {
      total: { value: 47 },
      hits: [
        {
          _id: 'abc',
          _index: 'filebeat-2025.04.18',
          _score: 1.5,
          _source: { 'source.ip': '10.0.0.1', message: 'auth failed' },
        },
      ],
    },
    aggregations: { byCategory: { buckets: [] } },
  };
  const out = parseElasticResponse(body);
  assert.equal(out.total, 47);
  assert.equal(out.hits.length, 1);
  assert.equal(out.hits[0].id, 'abc');
  assert.equal(out.hits[0].source['source.ip'], '10.0.0.1');
  assert.ok(out.aggregations);
});

test('parseElasticResponse handles the legacy numeric total shape', () => {
  const body = { hits: { total: 3, hits: [] } };
  const out = parseElasticResponse(body);
  assert.equal(out.total, 3);
  assert.equal(out.hits.length, 0);
});

test('ElasticClient.search hits the _search endpoint with auth headers', async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ hits: { total: 0, hits: [] } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const client = new ElasticClient({
    baseUrl: 'https://elk.example',
    apiKey: 'my-key',
    fetchImpl: fakeFetch,
  });
  await client.search('filebeat-*', { query: { match_all: {} } });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/filebeat-[^/]+\/_search$/);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.authorization, 'ApiKey my-key');
});

test('ElasticClient.search surfaces non-2xx responses as structured errors', async () => {
  const fakeFetch = async () =>
    new Response('server exploded', {
      status: 500,
      headers: { 'content-type': 'text/plain' },
    });
  const client = new ElasticClient({ baseUrl: 'https://elk.example', fetchImpl: fakeFetch });
  const out = await client.search('logs', { query: { match_all: {} } });
  assert.equal(out.total, 0);
  assert.equal(out.hits.length, 0);
  assert.match(out.errors[0], /elastic 500/);
});

test('parseWazuhResponse maps affected_items to alerts', () => {
  const body = {
    data: {
      total_affected_items: 1,
      affected_items: [
        {
          id: 'a1',
          timestamp: '2025-04-18T22:00:00Z',
          rule: { id: '5501', level: 7, description: 'SSH authentication failed' },
          agent: { id: '001', name: 'server-01' },
        },
      ],
    },
  };
  const out = parseWazuhResponse(body);
  assert.equal(out.total, 1);
  assert.equal(out.alerts[0].level, 7);
  assert.equal(out.alerts[0].ruleId, '5501');
  assert.equal(out.alerts[0].agent.name, 'server-01');
});

test('WazuhClient caches token from options and issues Bearer auth', async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(
      JSON.stringify({ data: { total_affected_items: 0, affected_items: [] } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
  const client = new WazuhClient({
    baseUrl: 'https://wazuh.example',
    token: 'preloaded-token',
    fetchImpl: fakeFetch,
  });
  await client.listAlerts({ limit: 10 });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/security\/alerts\?limit=10$/);
  assert.equal(calls[0].init.headers.authorization, 'Bearer preloaded-token');
});
