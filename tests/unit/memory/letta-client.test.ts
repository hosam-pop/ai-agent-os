import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LettaClient, parseArchivalRow } from '../../../dist/memory/letta/letta-client.js';

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  });
}

test('parseArchivalRow handles common shapes', () => {
  const r = parseArchivalRow({ id: 'r1', text: 'hello', score: 0.9, created_at: '2024-01-01' });
  assert.equal(r.id, 'r1');
  assert.equal(r.text, 'hello');
  assert.equal(r.score, 0.9);
  assert.equal(r.createdAt, '2024-01-01');
});

test('parseArchivalRow falls back to content key', () => {
  const r = parseArchivalRow({ id: 'r2', content: 'body text' });
  assert.equal(r.text, 'body text');
});

test('parseArchivalRow generates an id when missing', () => {
  const r = parseArchivalRow({});
  assert.ok(r.id.startsWith('letta-'));
  assert.equal(r.text, '');
});

test('LettaClient.appendArchival posts and parses the record', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), method: init?.method });
    return jsonResponse({ id: 'arch-1', text: 'remember me' });
  };
  const client = new LettaClient({ baseUrl: 'http://letta.local/', token: 't', fetchImpl });
  const res = await client.appendArchival('agent-1', 'remember me', { tag: 'a' });
  assert.equal(res.ok, true);
  assert.equal(res.record?.id, 'arch-1');
  assert.equal(calls[0].url, 'http://letta.local/v1/agents/agent-1/archival-memory');
  assert.equal(calls[0].method, 'POST');
});

test('LettaClient.appendArchival soft-fails on HTTP errors', async () => {
  const fetchImpl = async () => new Response('nope', { status: 503 });
  const client = new LettaClient({ fetchImpl });
  const res = await client.appendArchival('agent-1', 'x');
  assert.equal(res.ok, false);
  assert.match(res.error ?? '', /letta 503/);
});

test('LettaClient.searchArchival parses results', async () => {
  const fetchImpl = async () =>
    jsonResponse({
      results: [
        { id: 'a', text: 'foo', score: 0.7 },
        { id: 'b', content: 'bar' },
      ],
    });
  const client = new LettaClient({ fetchImpl });
  const res = await client.searchArchival('agent-1', 'query');
  assert.equal(res.ok, true);
  assert.equal(res.records.length, 2);
  assert.equal(res.records[0].id, 'a');
  assert.equal(res.records[1].text, 'bar');
});

test('LettaClient.appendArchival rejects empty agentId', async () => {
  const client = new LettaClient({ fetchImpl: async () => jsonResponse({}) });
  const res = await client.appendArchival('', 'x');
  assert.equal(res.ok, false);
  assert.match(res.error ?? '', /agentId/);
});
