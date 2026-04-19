import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMem0Memory } from '../../dist/integrations/mem0/mem0-memory.js';
import { resetEnvCache } from '../../dist/config/env-loader.js';

test('createMem0Memory falls back to local backend when MEM0_API_KEY is absent', async () => {
  const home = mkdtempSync(join(tmpdir(), 'agentos-mem0-'));
  process.env.DOGE_HOME = home;
  delete process.env.MEM0_API_KEY;
  resetEnvCache();
  const mem = await createMem0Memory();
  assert.equal(mem.backend, 'local');
  const added = await mem.add('hello world', { tags: ['smoke'] });
  assert.match(added.id, /^mem-/);
  const hits = await mem.search('hello');
  assert.equal(hits.length, 1);
  assert.match(hits[0].text, /hello/);
});
