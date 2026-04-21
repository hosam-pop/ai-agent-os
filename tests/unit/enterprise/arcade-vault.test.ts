import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ArcadeVault, redactSecrets } from '../../../dist/vault/arcade-vault.js';

test('ArcadeVault without api key returns not-configured', async () => {
  const vault = new ArcadeVault();
  assert.equal(vault.isConfigured(), false);
  const result = await vault.executeTool('user1', 'github.star', {});
  assert.equal(result.ok, false);
  assert.equal(result.error, 'arcade-not-configured');
});

test('ArcadeVault.executeTool forwards input and user id', async () => {
  let seen: any = null;
  const vault = new ArcadeVault({
    apiKey: 'test',
    loader: async () => ({
      Arcade: class {
        tools = {
          execute: async (params: unknown) => {
            seen = params;
            return { status: 'completed', output: 'ok' };
          },
        };
      },
    }),
  });
  const result = await vault.executeTool('u42', 'slack.send', { channel: '#x' });
  assert.equal(result.ok, true);
  assert.equal(result.output, 'ok');
  assert.equal(seen.user_id, 'u42');
  assert.equal(seen.tool_name, 'slack.send');
  assert.deepEqual(seen.input, { channel: '#x' });
});

test('ArcadeVault redacts secrets in outputs and error messages', async () => {
  const vault = new ArcadeVault({
    apiKey: 'test',
    loader: async () => ({
      Arcade: class {
        tools = {
          execute: async () => ({ status: 'completed', output: 'api_key=sk-1234567890abcdef' }),
        };
      },
    }),
  });
  const result = await vault.executeTool('u1', 'x.y', {});
  assert.ok(result.ok);
  assert.ok(result.output.includes('sk-***') || result.output.includes('***'));
  assert.ok(!result.output.includes('sk-1234567890abcdef'));
});

test('redactSecrets strips bearer tokens and kv prefixes', () => {
  const sample = 'Authorization: Bearer abcdefghijklmnopqrstuv and kv_ABCDEFGHIJKLMN';
  const cleaned = redactSecrets(sample);
  assert.ok(!cleaned.includes('abcdefghijklmnopqrstuv'));
  assert.ok(cleaned.includes('kv_***'));
});

test('ArcadeVault.authorize returns url when SDK provides one', async () => {
  const vault = new ArcadeVault({
    apiKey: 'test',
    loader: async () => ({
      Arcade: class {
        tools = {
          authorize: async () => ({ url: 'https://arcade.example.com/oauth?x=1' }),
        };
      },
    }),
  });
  const url = await vault.authorize('u1', 'github.star');
  assert.equal(url, 'https://arcade.example.com/oauth?x=1');
});
