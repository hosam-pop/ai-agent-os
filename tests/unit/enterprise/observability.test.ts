import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LangfuseTracer } from '../../../dist/observability/langfuse-tracer.js';
import { PostHogAnalytics } from '../../../dist/observability/posthog-analytics.js';
import { OpenLITTracer } from '../../../dist/observability/openlit-tracer.js';
import { AgentWatchAdapter } from '../../../dist/observability/agentwatch-adapter.js';

test('LangfuseTracer returns a no-op handle when unconfigured', async () => {
  const t = new LangfuseTracer();
  assert.equal(t.isConfigured(), false);
  const handle = await t.startTrace('demo');
  assert.ok(handle.id);
  await handle.event('noop');
  await handle.end('done');
  await t.flush();
});

test('LangfuseTracer forwards to SDK when configured', async () => {
  const calls: string[] = [];
  const t = new LangfuseTracer({
    publicKey: 'pk',
    secretKey: 'sk',
    loader: async () => ({
      Langfuse: class {
        trace(params: any) {
          calls.push('trace:' + params.name);
          return {
            id: 't1',
            event: (ev: any) => calls.push('event:' + ev.name),
            update: (u: any) => calls.push('end:' + JSON.stringify(u.output)),
          };
        }
        async flushAsync() {
          calls.push('flush');
        }
      },
    }),
  });
  assert.equal(t.isConfigured(), true);
  const h = await t.startTrace('run', { goal: 'demo' });
  await h.event('iter', { i: 1 });
  await h.end({ done: true });
  await t.flush();
  assert.deepEqual(calls, [
    'trace:run',
    'event:iter',
    'end:{"done":true}',
    'flush',
  ]);
});

test('PostHogAnalytics no-op when unconfigured', async () => {
  const p = new PostHogAnalytics();
  assert.equal(p.isConfigured(), false);
  await p.capture({ event: 'agent.test', properties: { x: 1 } });
  await p.shutdown();
});

test('PostHogAnalytics captures events via SDK', async () => {
  const events: any[] = [];
  const p = new PostHogAnalytics({
    apiKey: 'phc',
    distinctId: 'default-user',
    loader: async () => ({
      PostHog: class {
        capture(e: any) {
          events.push(e);
        }
        async shutdown() {
          events.push('shutdown');
        }
      },
    }),
  });
  await p.capture({ event: 'agent.tool_call', properties: { tool: 'file' } });
  await p.capture({ event: 'agent.tool_call', distinctId: 'u7', properties: { tool: 'web' } });
  await p.shutdown();
  assert.equal(events.length, 3);
  assert.equal(events[0].distinctId, 'default-user');
  assert.equal(events[1].distinctId, 'u7');
  assert.equal(events[2], 'shutdown');
});

test('OpenLITTracer is idempotent', async () => {
  let calls = 0;
  const t = new OpenLITTracer({
    applicationName: 'test-app',
    loader: async () => ({
      default: {
        init: (_opts: unknown) => {
          calls += 1;
        },
      },
    }),
  });
  assert.equal(await t.init(), true);
  assert.equal(await t.init(), true);
  assert.equal(calls, 1);
  assert.equal(t.isInitialized(), true);
});

test('AgentWatchAdapter heartbeat reaches recorder', async () => {
  const events: any[] = [];
  const a = new AgentWatchAdapter({
    endpoint: 'http://localhost:9999',
    loader: async () => ({
      AgentWatch: class {
        recordEvent(e: any) {
          events.push(e);
        }
        async flush() {
          events.push('flush');
        }
      },
    }),
  });
  await a.heartbeat({
    agentId: 'a1',
    iteration: 1,
    goalPreview: 'demo',
    tokenUsage: { inputTokens: 10, outputTokens: 5 },
    status: 'running',
  });
  await a.flush();
  assert.equal(events.length, 2);
  assert.equal(events[0].type, 'agent.heartbeat');
  assert.equal(events[0].payload.iteration, 1);
});

test('AgentWatchAdapter without endpoint is no-op', async () => {
  const a = new AgentWatchAdapter();
  assert.equal(a.isConfigured(), false);
  await a.heartbeat({
    agentId: 'a1',
    iteration: 0,
    goalPreview: '-',
    tokenUsage: { inputTokens: 0, outputTokens: 0 },
    status: 'running',
  });
});
