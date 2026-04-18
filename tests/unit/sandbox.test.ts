import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { Sandbox } from '../../dist/tools/sandbox.js';

test('resolves paths inside the root', () => {
  const root = mkdtempSync(join(tmpdir(), 'sbx-'));
  const s = new Sandbox(root);
  const resolved = s.resolvePath('foo/bar.txt');
  assert.ok(resolved.startsWith(root));
  assert.equal(s.relative(resolved), join('foo', 'bar.txt'));
});

test('rejects escape via ..', () => {
  const root = mkdtempSync(join(tmpdir(), 'sbx-'));
  const s = new Sandbox(root);
  assert.throws(() => s.resolvePath('../etc/passwd'), /escapes sandbox/);
});

test('rejects absolute paths outside the root', () => {
  const root = mkdtempSync(join(tmpdir(), 'sbx-'));
  const s = new Sandbox(root);
  assert.throws(() => s.resolvePath('/etc/passwd'), /escapes sandbox/);
});
