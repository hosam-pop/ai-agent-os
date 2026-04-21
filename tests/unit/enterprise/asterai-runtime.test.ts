import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AsteraiRuntime } from '../../../dist/integrations/asterai/asterai-runtime.js';

test('AsteraiRuntime.run reports missing module cleanly', async () => {
  const rt = new AsteraiRuntime({ timeoutMs: 200 });
  const r = await rt.run('/nonexistent/module.wasm', 'run', 'hi');
  assert.equal(r.ok, false);
  assert.ok(r.error?.startsWith('wasm-module-missing:'));
});

test('AsteraiRuntime.run reports ABI mismatch when alloc/memory missing', async () => {
  // Minimal WASM module: exports a `noop` function but no memory/alloc.
  // Handcrafted bytes: a module with one function that returns 0 (i32).
  const wat =
    '\x00asm\x01\x00\x00\x00' +
    // type section: (func) -> i32
    '\x01\x05\x01\x60\x00\x01\x7f' +
    // function section
    '\x03\x02\x01\x00' +
    // export section: export "run" func 0
    '\x07\x07\x01\x03\x72\x75\x6e\x00\x00' +
    // code section: one function body: i32.const 0; end
    '\x0a\x06\x01\x04\x00\x41\x00\x0b';
  const dir = mkdtempSync(join(tmpdir(), 'asterai-rt-'));
  const modPath = join(dir, 'noop.wasm');
  writeFileSync(modPath, Buffer.from(wat, 'binary'));
  const rt = new AsteraiRuntime({ timeoutMs: 200 });
  const r = await rt.run(modPath, 'run', 'payload');
  assert.equal(r.ok, false);
  assert.ok(r.error?.includes('wasm-abi-mismatch') || r.error?.includes('wasm'));
});
