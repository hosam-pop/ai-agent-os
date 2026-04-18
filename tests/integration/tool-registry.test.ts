import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ToolRegistry } from '../../dist/tools/registry.js';
import { FileTool } from '../../dist/tools/file-tool.js';
import { PolicyEngine } from '../../dist/permissions/policy-engine.js';
import { Sandbox } from '../../dist/tools/sandbox.js';

test('FileTool write + read through registry', async () => {
  const root = mkdtempSync(join(tmpdir(), 'iot-'));
  const policy = new PolicyEngine('permissive');
  const sandbox = new Sandbox(root);
  const registry = new ToolRegistry();
  registry.register(new FileTool(policy, sandbox));

  const writeResult = await registry.invoke(
    'file',
    { action: 'write', path: 'hello.txt', content: 'world' },
    { workspace: root },
  );
  assert.equal(writeResult.ok, true);
  assert.equal(readFileSync(join(root, 'hello.txt'), 'utf8'), 'world');

  const readResult = await registry.invoke(
    'file',
    { action: 'read', path: 'hello.txt' },
    { workspace: root },
  );
  assert.equal(readResult.ok, true);
  assert.equal(readResult.output.includes('world'), true);
});

test('FileTool denies path escape', async () => {
  const root = mkdtempSync(join(tmpdir(), 'iot-'));
  const policy = new PolicyEngine('permissive');
  const sandbox = new Sandbox(root);
  const registry = new ToolRegistry();
  registry.register(new FileTool(policy, sandbox));

  const result = await registry.invoke(
    'file',
    { action: 'read', path: '../etc/passwd' },
    { workspace: root },
  );
  assert.equal(result.ok, false);
});
