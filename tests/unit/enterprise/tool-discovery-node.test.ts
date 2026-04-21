import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildToolDiscoveryNode } from '../../../dist/orchestration/tool-discovery-node.js';
import { ComposioGateway } from '../../../dist/gateway/composio-gateway.js';

function gatewayWithTools(tools: Array<{ slug: string; description: string }>) {
  return new ComposioGateway({
    apiKey: 'test',
    loader: async () => ({
      Composio: class {
        tools = {
          list: async () => ({ items: tools }),
        };
      },
    }),
  });
}

test('ToolDiscoveryNode swaps planned tool when gateway has a better match', async () => {
  const gateway = gatewayWithTools([
    { slug: 'gmail.send', description: 'Send an email using Gmail' },
    { slug: 'slack.post', description: 'Send a Slack message to a channel' },
  ]);
  const node = buildToolDiscoveryNode({ gateway });
  const next = await node({
    intent: 'send an email notification to the customer about the order',
    plannedTool: 'local.send',
  });
  assert.equal(next.selectedTool, 'gmail.send');
  assert.ok(next.discoverySuggestion);
  assert.ok(next.discoverySuggestion!.score >= 2);
});

test('ToolDiscoveryNode keeps planned tool when no match beats threshold', async () => {
  const gateway = gatewayWithTools([{ slug: 'calendar.add', description: 'Add to calendar' }]);
  const node = buildToolDiscoveryNode({ gateway, minScore: 5 });
  const next = await node({
    intent: 'run a local filesystem search',
    plannedTool: 'file',
  });
  assert.equal(next.selectedTool, 'file');
  assert.equal(next.discoverySuggestion, null);
});

test('ToolDiscoveryNode leaves state alone when gateway unconfigured', async () => {
  const gateway = new ComposioGateway();
  const node = buildToolDiscoveryNode({ gateway });
  const next = await node({ intent: 'anything', plannedTool: 'file' });
  assert.equal(next.selectedTool, 'file');
  assert.equal(next.discoverySuggestion, null);
});
