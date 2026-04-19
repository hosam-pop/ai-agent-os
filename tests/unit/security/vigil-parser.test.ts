import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVigilResponse, VigilClient } from '../../../dist/security/llm-guard/vigil-client.js';

test('parseVigilResponse handles an array of results with explicit verdict', () => {
  const raw = {
    verdict: 'malicious',
    latency: 42,
    results: [
      { scanner: 'transformer', score: 0.97, message: 'prompt-injection detected', rule: 'jailbreak' },
      { scanner: 'yara', score: 0.3, message: 'weak YARA match' },
    ],
  };
  const out = parseVigilResponse(raw);
  assert.equal(out.verdict, 'malicious');
  assert.equal(out.total, 2);
  assert.equal(out.byScanner.transformer, 1);
  assert.equal(out.byScanner.yara, 1);
  assert.equal(out.matches[0].rule, 'jailbreak');
  assert.equal(out.latencyMs, 42);
  assert.deepEqual(out.errors, []);
});

test('parseVigilResponse infers verdict from scores when server omits it', () => {
  const clean = parseVigilResponse({ results: [] });
  assert.equal(clean.verdict, 'clean');
  const suspicious = parseVigilResponse({ results: [{ scanner: 'transformer', score: 0.4, message: 'low signal' }] });
  assert.equal(suspicious.verdict, 'suspicious');
  const malicious = parseVigilResponse({ results: [{ scanner: 'transformer', score: 0.9, message: 'hot match' }] });
  assert.equal(malicious.verdict, 'malicious');
});

test('parseVigilResponse accepts legacy keyed-results shape', () => {
  const raw = {
    results: {
      transformer: { matches: [{ score: 0.55, message: 'legacy match' }] },
      similarity: { matches: [{ description: 'cosine hit' }] },
    },
  };
  const out = parseVigilResponse(raw);
  assert.equal(out.total, 2);
  assert.equal(out.matches[0].scanner, 'transformer');
  assert.equal(out.matches[1].message, 'cosine hit');
});

test('parseVigilResponse tolerates malformed payloads', () => {
  assert.equal(parseVigilResponse(null).errors.length, 1);
  assert.equal(parseVigilResponse('nope').total, 0);
  const mixedErrors = parseVigilResponse({ errors: ['upstream down', { message: 'rate limit' }] });
  assert.deepEqual(mixedErrors.errors, ['upstream down', 'rate limit']);
});

test('VigilClient.scan soft-fails on rejected prompt without touching fetch', async () => {
  let called = false;
  const client = new VigilClient({
    baseUrl: 'http://vigil.invalid',
    fetchImpl: (async () => {
      called = true;
      return new Response('{}');
    }) as typeof fetch,
  });
  const summary = await client.scan({ prompt: '' });
  assert.equal(called, false);
  assert.equal(summary.total, 0);
  assert.ok(summary.errors[0].includes('prompt is required'));
});

test('VigilClient.scan returns parsed summary on HTTP 200', async () => {
  const fetchImpl: typeof fetch = async (_url, _init) => {
    return new Response(
      JSON.stringify({ verdict: 'suspicious', results: [{ scanner: 'yara', score: 0.5, message: 'rule hit' }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
  const client = new VigilClient({ baseUrl: 'http://vigil.local', fetchImpl });
  const summary = await client.scan({ prompt: 'hello' });
  assert.equal(summary.verdict, 'suspicious');
  assert.equal(summary.total, 1);
  assert.equal(summary.matches[0].scanner, 'yara');
});

test('VigilClient.scan reports HTTP errors as soft failures', async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response('boom', { status: 500, statusText: 'Server Error' });
  const client = new VigilClient({ baseUrl: 'http://vigil.local', fetchImpl });
  const summary = await client.scan({ prompt: 'hi' });
  assert.equal(summary.total, 0);
  assert.ok(summary.errors[0].includes('HTTP 500'));
});
