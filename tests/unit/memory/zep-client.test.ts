import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ZepClient, parseZepRow } from '../../../dist/memory/zep/zep-client.js';

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  });
}

test('parseZepRow reads content or message keys', () => {
  assert.equal(parseZepRow('s', { content: 'hi' }).text, 'hi');
  assert.equal(parseZepRow('s', { message: 'hello' }).text, 'hello');
  assert.equal(parseZepRow('s', {}).text, '');
});

test('parseZepRow uses uuid when no id present', () => {
  const r = parseZepRow('s', { uuid: 'x-1', content: 'abc' });
  assert.equal(r.id, 'x-1');
});

test('ZepClient.addMemory returns ok on HTTP 200', async () => {
  let capturedUrl = '';
  const fetchImpl = async (url, init) => {
    capturedUrl = String(url);
    return jsonResponse({});
  };
  const client = new ZepClient({ baseUrl: 'http://zep.local', token: 'k', fetchImpl });
  const res = await client.addMemory('session-a', [{ role: 'user', content: 'hello' }]);
  assert.equal(res.ok, true);
  assert.match(capturedUrl, /\/api\/v2\/sessions\/session-a\/memory$/);
});

test('ZepClient.addMemory soft-fails on HTTP 401', async () => {
  const fetchImpl = async () => new Response('unauthorized', { status: 401 });
  const client = new ZepClient({ fetchImpl });
  const res = await client.addMemory('s', [{ role: 'user', content: 'x' }]);
  assert.equal(res.ok, false);
  assert.match(res.error ?? '', /zep 401/);
});

test('ZepClient.addMemory accepts empty messages without calling network', async () => {
  let called = false;
  const client = new ZepClient({ fetchImpl: async () => { called = true; return jsonResponse({}); } });
  const res = await client.addMemory('s', []);
  assert.equal(res.ok, true);
  assert.equal(called, false);
});

test('ZepClient.searchMemory parses result rows with sessionId', async () => {
  const fetchImpl = async () =>
    jsonResponse({
      results: [
        { uuid_: 'u-1', content: 'foo', score: 0.5 },
        { message: 'bar' },
      ],
    });
  const client = new ZepClient({ fetchImpl });
  const res = await client.searchMemory('s-1', 'query');
  assert.equal(res.ok, true);
  assert.equal(res.records.length, 2);
  assert.equal(res.records[0].sessionId, 's-1');
  assert.equal(res.records[1].text, 'bar');
});
