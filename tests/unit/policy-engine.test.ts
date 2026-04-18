import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PolicyEngine } from '../../dist/permissions/policy-engine.js';

test('denies destructive bash rm -rf /', () => {
  const engine = new PolicyEngine('default');
  const decision = engine.evaluate({
    toolName: 'bash',
    argsSignature: 'rm -rf /',
    rawArgs: { command: 'rm -rf /' },
  });
  assert.equal(decision.action, 'deny');
});

test('allows harmless bash echo', () => {
  const engine = new PolicyEngine('default');
  const decision = engine.evaluate({
    toolName: 'bash',
    argsSignature: 'echo hello',
    rawArgs: { command: 'echo hello' },
  });
  assert.equal(decision.action, 'allow');
});

test('strict mode prompts for bash', () => {
  const engine = new PolicyEngine('strict');
  const decision = engine.evaluate({
    toolName: 'bash',
    argsSignature: 'ls',
    rawArgs: { command: 'ls' },
  });
  assert.ok(decision.action === 'prompt' || decision.action === 'deny');
});
