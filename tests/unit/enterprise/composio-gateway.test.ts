import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ComposioGateway } from '../../../dist/gateway/composio-gateway.js';

test('ComposioGateway without api key is not configured and returns stubs', async () => {
  const gw = new ComposioGateway();
  assert.equal(gw.isConfigured(), false);
  assert.deepEqual(await gw.listTools(), []);
  const exec = await gw.executeTool('u1', 'slack.send', {});
  assert.equal(exec.ok, false);
  assert.equal(exec.error, 'composio-not-configured');
});

test('ComposioGateway.listTools normalizes SDK response shapes', async () => {
  const gw = new ComposioGateway({
    apiKey: 'test',
    loader: async () => ({
      Composio: class {
        tools = {
          list: async () => ({
            items: [
              { slug: 'gmail.send', display_name: 'Send Gmail', description: 'Send an email' },
              { slug: 'slack.post', name: 'Post to Slack', summary: 'Send a chat message to a Slack channel' },
              { nosluggy: true },
            ],
          }),
        };
      },
    }),
  });
  const tools = await gw.listTools();
  assert.equal(tools.length, 2);
  assert.equal(tools[0].slug, 'gmail.send');
  assert.equal(tools[1].description, 'Send a chat message to a Slack channel');
});

test('ComposioGateway.suggestBetterTool picks highest keyword overlap', async () => {
  const gw = new ComposioGateway({
    apiKey: 'test',
    loader: async () => ({
      Composio: class {
        tools = {
          list: async () => ({
            items: [
              { slug: 'gmail.send', description: 'Send an email using Gmail' },
              { slug: 'slack.post', description: 'Send a chat message to a Slack channel' },
              { slug: 'calendar.add', description: 'Add an event to Google Calendar' },
            ],
          }),
        };
      },
    }),
  });
  const best = await gw.suggestBetterTool(
    'notify the customer via email about their order update',
    'local.email',
  );
  assert.ok(best);
  assert.equal(best!.candidate.slug, 'gmail.send');
  assert.ok(best!.score >= 2);
});

test('ComposioGateway.executeTool surfaces normalized success', async () => {
  const gw = new ComposioGateway({
    apiKey: 'test',
    loader: async () => ({
      Composio: class {
        tools = {
          execute: async (slug: string, params: any) => ({
            successful: true,
            data: { slug, echo: params.arguments },
          }),
        };
      },
    }),
  });
  const result = await gw.executeTool('u1', 'slack.post', { channel: '#ops' });
  assert.equal(result.ok, true);
  assert.ok(result.output.includes('#ops'));
});

test('ComposioGateway.executeTool wraps SDK throws without leaking', async () => {
  const gw = new ComposioGateway({
    apiKey: 'test',
    loader: async () => ({
      Composio: class {
        tools = {
          execute: async () => {
            throw new Error('network down');
          },
        };
      },
    }),
  });
  const result = await gw.executeTool('u1', 'slack.post', {});
  assert.equal(result.ok, false);
  assert.equal(result.error, 'network down');
});
