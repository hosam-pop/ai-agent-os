import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StagehandTool } from '../../../dist/integrations/browser/stagehand-tool.js';

function makeFakeModule() {
  const calls = [];
  const Stagehand = class {
    constructor(config) {
      this.config = config;
      this.page = {
        async goto(url) { calls.push(['goto', url]); },
      };
    }
    async init() { calls.push(['init']); }
    async close() { calls.push(['close']); }
    async act({ action }) { calls.push(['act', action]); return { performed: action }; }
    async extract({ instruction }) { calls.push(['extract', instruction]); return { field: instruction }; }
    async observe({ instruction }) { calls.push(['observe', instruction]); return [{ label: instruction }]; }
  };
  return { module: { Stagehand }, calls };
}

test('StagehandTool.navigate forwards url to page.goto', async () => {
  const { module, calls } = makeFakeModule();
  const tool = new StagehandTool({ moduleLoader: async () => module, config: {} });
  const res = await tool.run({ action: 'navigate', url: 'https://example.com' }, {});
  assert.equal(res.ok, true);
  assert.deepEqual(calls[0], ['init']);
  assert.deepEqual(calls[1], ['goto', 'https://example.com']);
});

test('StagehandTool.navigate rejects missing url', async () => {
  const { module } = makeFakeModule();
  const tool = new StagehandTool({ moduleLoader: async () => module, config: {} });
  const res = await tool.run({ action: 'navigate' }, {});
  assert.equal(res.ok, false);
  assert.match(res.error ?? '', /url/);
});

test('StagehandTool.act rejects missing instruction', async () => {
  const { module } = makeFakeModule();
  const tool = new StagehandTool({ moduleLoader: async () => module, config: {} });
  const res = await tool.run({ action: 'act' }, {});
  assert.equal(res.ok, false);
  assert.match(res.error ?? '', /instruction/);
});

test('StagehandTool.extract returns structured data', async () => {
  const { module, calls } = makeFakeModule();
  const tool = new StagehandTool({ moduleLoader: async () => module, config: {} });
  const res = await tool.run({ action: 'extract', instruction: 'headline' }, {});
  assert.equal(res.ok, true);
  assert.deepEqual(res.data, { field: 'headline' });
  assert.ok(calls.some((c) => c[0] === 'extract'));
});

test('StagehandTool.observe returns observation list', async () => {
  const { module } = makeFakeModule();
  const tool = new StagehandTool({ moduleLoader: async () => module, config: {} });
  const res = await tool.run({ action: 'observe', instruction: 'buttons' }, {});
  assert.equal(res.ok, true);
  assert.ok(Array.isArray(res.data));
});

test('StagehandTool reuses a single instance across calls and closes cleanly', async () => {
  const { module, calls } = makeFakeModule();
  const tool = new StagehandTool({ moduleLoader: async () => module, config: {} });
  await tool.run({ action: 'navigate', url: 'https://example.com' }, {});
  await tool.run({ action: 'act', instruction: 'click something' }, {});
  await tool.close();
  const inits = calls.filter((c) => c[0] === 'init').length;
  const closes = calls.filter((c) => c[0] === 'close').length;
  assert.equal(inits, 1);
  assert.equal(closes, 1);
});

test('StagehandTool.run soft-fails when module loader throws', async () => {
  const tool = new StagehandTool({
    moduleLoader: async () => { throw new Error('missing @browserbasehq/stagehand'); },
    config: {},
  });
  const res = await tool.run({ action: 'navigate', url: 'https://example.com' }, {});
  assert.equal(res.ok, false);
  assert.match(res.error ?? '', /stagehand/);
});
