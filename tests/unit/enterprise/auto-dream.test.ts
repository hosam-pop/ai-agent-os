import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startAutoDream } from '../../../dist/core/auto-dream.js';
import { resetEnvCache } from '../../../dist/config/env-loader.js';

function makeProvider(summary: string) {
  return {
    name: 'fake',
    complete: async () => ({
      content: [{ type: 'text', text: summary }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 0, output_tokens: 0 },
    }),
  } as unknown as Parameters<typeof startAutoDream>[0];
}

test('startAutoDream stays inert when the flag is disabled', async () => {
  delete process.env.ENABLE_AUTO_DREAM;
  resetEnvCache();
  const handle = startAutoDream(
    makeProvider('x'),
    { snapshot: () => [], replace: () => undefined },
    { archive: () => undefined },
    { model: 'gpt-5' },
  );
  assert.equal(handle.isRunning, false);
  const r = await handle.tick();
  assert.equal(r.ran, false);
  assert.equal(r.reason, 'feature-disabled');
});

test('startAutoDream compresses buffer when length exceeds threshold', async () => {
  process.env.ENABLE_AUTO_DREAM = 'true';
  resetEnvCache();
  try {
    const buf = Array.from({ length: 20 }, (_, i) => ({
      role: 'user' as const,
      content: `turn ${i}`,
    }));
    const archived: unknown[] = [];
    let replaced: unknown[] | null = null;

    const fakeTimer = {
      setInterval: () => 0 as unknown as ReturnType<typeof setInterval>,
      clearInterval: () => undefined,
    };

    const handle = startAutoDream(
      makeProvider('compressed.'),
      {
        snapshot: () => buf,
        replace: (next) => {
          replaced = next as unknown[];
        },
      },
      { archive: (note, meta) => archived.push({ note, meta }) },
      { model: 'gpt-5', keepRecent: 4, minMessages: 5, intervalMs: 60_000, timer: fakeTimer },
    );
    const r = await handle.tick();
    assert.equal(r.ran, true);
    assert.equal(r.compressedFrom, 20);
    assert.equal(r.keptRecent, 4);
    assert.ok(replaced);
    assert.equal((replaced as unknown[]).length, 5);
    assert.equal(archived.length, 1);
    handle.stop();
    assert.equal(handle.isRunning, false);
  } finally {
    delete process.env.ENABLE_AUTO_DREAM;
    resetEnvCache();
  }
});

test('startAutoDream skips compression below the minimum threshold', async () => {
  process.env.ENABLE_AUTO_DREAM = 'true';
  resetEnvCache();
  try {
    const fakeTimer = {
      setInterval: () => 0 as unknown as ReturnType<typeof setInterval>,
      clearInterval: () => undefined,
    };
    const handle = startAutoDream(
      makeProvider('x'),
      {
        snapshot: () => [{ role: 'user' as const, content: 'hi' }],
        replace: () => undefined,
      },
      { archive: () => undefined },
      { model: 'gpt-5', minMessages: 10, intervalMs: 60_000, timer: fakeTimer },
    );
    const r = await handle.tick();
    assert.equal(r.ran, false);
    assert.equal(r.reason, 'below-threshold');
    handle.stop();
  } finally {
    delete process.env.ENABLE_AUTO_DREAM;
    resetEnvCache();
  }
});
