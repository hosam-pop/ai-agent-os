import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AdminTool, setRestartProviderCallback } from '../../dist/tools/admin-tool.js';

function makeWorkspace(): { workspace: string; envPath: string } {
  const root = mkdtempSync(join(tmpdir(), 'admin-test-'));
  const workspace = join(root, 'workspace');
  const envPath = join(root, '.env');
  return { workspace, envPath };
}

test('switch_provider writes DOGE_PROVIDER into the .env', async () => {
  const { workspace, envPath } = makeWorkspace();
  writeFileSync(envPath, 'DOGE_PROVIDER=anthropic\nOTHER=1\n', 'utf8');
  let restarts = 0;
  setRestartProviderCallback(() => {
    restarts += 1;
  });
  const tool = new AdminTool();
  const result = await tool.run(
    { action: 'switch_provider', provider: 'openai', apiKey: 'sk-test' },
    { workspace },
  );
  assert.equal(result.ok, true);
  const after = readFileSync(envPath, 'utf8');
  assert.match(after, /DOGE_PROVIDER=openai/);
  assert.match(after, /OPENAI_API_KEY=sk-test/);
  assert.equal(restarts, 1);
  setRestartProviderCallback(null);
});

test('toggle_feature flips an existing flag', async () => {
  const { workspace, envPath } = makeWorkspace();
  writeFileSync(envPath, 'DOGE_FEATURE_BUDDY=false\n', 'utf8');
  setRestartProviderCallback(null);
  const tool = new AdminTool();
  const result = await tool.run(
    { action: 'toggle_feature', feature: 'BUDDY' },
    { workspace },
  );
  assert.equal(result.ok, true);
  assert.match(readFileSync(envPath, 'utf8'), /DOGE_FEATURE_BUDDY=true/);
});

test('list_config redacts secrets', async () => {
  const { workspace, envPath } = makeWorkspace();
  writeFileSync(
    envPath,
    'DOGE_PROVIDER=openai\nOPENAI_API_KEY=sk-super-secret-value\n',
    'utf8',
  );
  setRestartProviderCallback(null);
  const tool = new AdminTool();
  const result = await tool.run({ action: 'list_config' }, { workspace });
  assert.equal(result.ok, true);
  assert.match(result.output, /DOGE_PROVIDER=openai/);
  assert.match(result.output, /OPENAI_API_KEY=sk-s…/);
  assert.ok(!result.output.includes('sk-super-secret-value'));
});

test('add_api_key inserts a new variable', async () => {
  const { workspace, envPath } = makeWorkspace();
  writeFileSync(envPath, '', 'utf8');
  setRestartProviderCallback(null);
  const tool = new AdminTool();
  const result = await tool.run(
    { action: 'add_api_key', keyName: 'MEM0_API_KEY', apiKey: 'mem0-abc' },
    { workspace },
  );
  assert.equal(result.ok, true);
  assert.match(readFileSync(envPath, 'utf8'), /MEM0_API_KEY=mem0-abc/);
});
