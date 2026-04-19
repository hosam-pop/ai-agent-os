import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ChannelAdapter,
  ChannelRegistry,
} from '../../dist/integrations/openclaw/channel-adapter.js';
import { SlackAdapter } from '../../dist/integrations/openclaw/slack-adapter.js';

function makeAdapter(name) {
  class DummyAdapter extends ChannelAdapter {
    channel = name;
    sent = [];
    connected = false;
    async connect() {
      this.connected = true;
    }
    async send(msg) {
      this.sent.push(msg);
    }
    async disconnect() {
      this.connected = false;
    }
    async inject(text) {
      await this.emitMessage({
        id: '1',
        userId: 'u',
        channel: name,
        text,
        raw: {},
        receivedAt: Date.now(),
      });
    }
  }
  return new DummyAdapter({});
}

test('ChannelRegistry connects and disconnects every registered adapter', async () => {
  const registry = new ChannelRegistry();
  const a = makeAdapter('dummy-a');
  const b = makeAdapter('dummy-b');
  registry.register(a);
  registry.register(b);
  await registry.connectAll();
  assert.equal(a.connected, true);
  assert.equal(b.connected, true);
  await registry.disconnectAll();
  assert.equal(a.connected, false);
  assert.equal(b.connected, false);
});

test('ChannelAdapter fans incoming messages to every listener', async () => {
  const adapter = makeAdapter('dummy');
  const received = [];
  adapter.onMessage((msg) => {
    received.push(msg.text);
  });
  await adapter.inject('hi');
  await adapter.inject('again');
  assert.deepEqual(received, ['hi', 'again']);
});

test('SlackAdapter recognises url_verification events', async () => {
  const adapter = new SlackAdapter({ webhookUrl: 'https://hooks.example/test' });
  const outcome = await adapter.handleEvent({
    type: 'url_verification',
    challenge: 'abc123',
  });
  assert.equal(outcome, 'url_verification');
});

test('SlackAdapter surfaces message events via onMessage', async () => {
  const adapter = new SlackAdapter({ webhookUrl: 'https://hooks.example/test' });
  const received = [];
  adapter.onMessage((m) => received.push(m.text));
  const outcome = await adapter.handleEvent({
    type: 'event_callback',
    event: { type: 'message', text: 'hello', channel: 'C1', user: 'U1', ts: '1700000000.0001' },
  });
  assert.equal(outcome, 'handled');
  assert.deepEqual(received, ['hello']);
});
