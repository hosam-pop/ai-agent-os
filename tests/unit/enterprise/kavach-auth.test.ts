import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KavachAuth } from '../../../dist/security/kavach-auth.js';

test('KavachAuth mints a credential per agent and caches it', async () => {
  const k = new KavachAuth();
  const a1 = await k.createAgentIdentity('agent-a', ['tool:file', 'tool:web:*']);
  const a2 = await k.createAgentIdentity('agent-a');
  assert.equal(a1.agentId, 'agent-a');
  assert.equal(a1.credentialId, a2.credentialId);
  assert.ok(a1.credentialId.startsWith('kv_agent-a_'));
});

test('KavachAuth.authorize honors exact scope and wildcard scope', async () => {
  const k = new KavachAuth();
  await k.createAgentIdentity('agent-b', ['tool:file', 'tool:web:*']);
  const okExact = await k.authorize('agent-b', 'tool:file', '/tmp');
  assert.equal(okExact.allowed, true);
  const okWild = await k.authorize('agent-b', 'tool:web:fetch', 'https://x');
  assert.equal(okWild.allowed, true);
  const bad = await k.authorize('agent-b', 'tool:shell', '/tmp');
  assert.equal(bad.allowed, false);
  assert.ok(bad.reason?.startsWith('scope-denied'));
});

test('KavachAuth denies unknown agent and logs an audit event', async () => {
  const k = new KavachAuth();
  const d = await k.authorize('ghost', 'tool:file', '/tmp');
  assert.equal(d.allowed, false);
  assert.equal(d.reason, 'unknown-agent');
  const events = k.auditEvents();
  assert.equal(events.at(-1)?.allowed, false);
  assert.equal(events.at(-1)?.agentId, 'ghost');
});

test('KavachAuth wildcard-all scope allows everything', async () => {
  const k = new KavachAuth();
  await k.createAgentIdentity('root', ['*']);
  const d = await k.authorize('root', 'tool:anything', 'any');
  assert.equal(d.allowed, true);
});
