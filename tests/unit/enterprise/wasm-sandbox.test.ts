import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WasmSandbox } from '../../../dist/security/wasm-sandbox.js';
import { resetEnvCache } from '../../../dist/config/env-loader.js';

test('WasmSandbox refuses execution when feature flag is disabled', async () => {
  delete process.env.ENABLE_ASTERAI_SANDBOX;
  resetEnvCache();
  const sb = new WasmSandbox();
  const r = await sb.execute({ modulePath: 'any.wasm', exportName: 'run', payload: '' });
  assert.equal(r.ok, false);
  assert.equal(r.sandbox, 'disabled');
  assert.equal(r.error, 'wasm-sandbox-disabled');
});

test('WasmSandbox enforces allow-list when flag is enabled', async () => {
  process.env.ENABLE_ASTERAI_SANDBOX = 'true';
  resetEnvCache();
  try {
    const sb = new WasmSandbox({ allowedModules: ['allowed.wasm'] });
    assert.equal(
      sb.canExecute({ modulePath: 'blocked.wasm', exportName: 'run', payload: '' }),
      false,
    );
    assert.equal(
      sb.canExecute({ modulePath: '/abs/allowed.wasm', exportName: 'run', payload: '' }),
      true,
    );
  } finally {
    delete process.env.ENABLE_ASTERAI_SANDBOX;
    resetEnvCache();
  }
});
