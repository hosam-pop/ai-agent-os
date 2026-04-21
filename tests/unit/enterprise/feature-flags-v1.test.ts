import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feature, listFeatures } from '../../../dist/config/feature-flags.js';
import { resetEnvCache } from '../../../dist/config/env-loader.js';

const NEW_FLAGS = [
  'OPENFANG',
  'ARGENTOR',
  'QUALIXAR',
  'ASTERAI_SANDBOX',
  'AUTO_DREAM',
  'GRAPH_MEMORY',
  'TEMPORAL_MEMORY',
  'HYBRID_RETRIEVAL',
] as const;

const ENV_NAMES: Record<(typeof NEW_FLAGS)[number], string> = {
  OPENFANG: 'ENABLE_OPENFANG',
  ARGENTOR: 'ENABLE_ARGENTOR',
  QUALIXAR: 'ENABLE_QUALIXAR',
  ASTERAI_SANDBOX: 'ENABLE_ASTERAI_SANDBOX',
  AUTO_DREAM: 'ENABLE_AUTO_DREAM',
  GRAPH_MEMORY: 'ENABLE_GRAPH_MEMORY',
  TEMPORAL_MEMORY: 'ENABLE_TEMPORAL_MEMORY',
  HYBRID_RETRIEVAL: 'ENABLE_HYBRID_RETRIEVAL',
};

test('new enterprise-architecture-v1 flags default to false', () => {
  for (const f of NEW_FLAGS) delete process.env[ENV_NAMES[f]];
  resetEnvCache();
  for (const f of NEW_FLAGS) {
    assert.equal(feature(f), false, `expected ${f} default=false`);
  }
});

test('listFeatures exposes every new flag exactly once', () => {
  const list = listFeatures();
  for (const f of NEW_FLAGS) {
    const hits = list.filter((x) => x.name === f);
    assert.equal(hits.length, 1, `expected ${f} to appear once`);
  }
});

test('setting the env var to "true" flips the flag', () => {
  for (const f of NEW_FLAGS) {
    process.env[ENV_NAMES[f]] = 'true';
    resetEnvCache();
    assert.equal(feature(f), true, `expected ${f} to be true after env set`);
    delete process.env[ENV_NAMES[f]];
    resetEnvCache();
  }
});
