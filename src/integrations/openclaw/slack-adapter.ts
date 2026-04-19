import { logger } from '../../utils/logger.js';
import {
  ChannelAdapter,
  type ChannelIncomingMessage,
  type ChannelOutgoingMessage,
} from './channel-adapter.js';

/**
 * Slack channel adapter.
 *
 * Sending goes through either (a) a single incoming webhook URL (simple,
 * anonymous, useful for alerting), or (b) Slack's `chat.postMessage` API
 * when a bot token is provided. Receiving is handled through Slack's Events
 * API webhook (see {@link handleEvent}) — the BRIDGE feature gate's HTTP
 * server can forward POSTs to this method to surface inbound Slack messages
 * as {@link ChannelIncomingMessage} events.
 */

export interface SlackConfig {
  botToken?: string;
  webhookUrl?: string;
  signingSecret?: string;
}

export class SlackAdapter extends ChannelAdapter<SlackConfig> {
  readonly channel = 'slack';

  async connect(): Promise<void> {
    if (!this.config.botToken && !this.config.webhookUrl) {
      throw new Error('SlackAdapter requires botToken or webhookUrl');
    }
    logger.info('slack.connected', {
      mode: this.config.botToken ? 'bot' : 'webhook',
    });
  }

  async send(msg: ChannelOutgoingMessage): Promise<void> {
    if (this.config.botToken) {
      await this.postApi('chat.postMessage', {
        channel: msg.userId,
        text: msg.text,
        thread_ts: msg.threadId,
      });
      return;
    }
    if (!this.config.webhookUrl) {
      throw new Error('SlackAdapter: no botToken or webhookUrl configured');
    }
    const res = await fetch(this.config.webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: msg.text }),
    });
    if (!res.ok) {
      throw new Error(`slack webhook ${res.status}`);
    }
  }

  async disconnect(): Promise<void> {
    /* stateless */
  }

  async handleEvent(event: unknown): Promise<'url_verification' | 'handled' | 'ignored'> {
    if (!event || typeof event !== 'object') return 'ignored';
    const payload = event as Record<string, unknown>;
    if (payload.type === 'url_verification' && typeof payload.challenge === 'string') {
      return 'url_verification';
    }
    if (payload.type === 'event_callback' && payload.event && typeof payload.event === 'object') {
      const inner = payload.event as Record<string, unknown>;
      if (inner.type === 'message' && typeof inner.text === 'string') {
        const ts = typeof inner.ts === 'string' ? inner.ts : `${Date.now()}`;
        const user = typeof inner.user === 'string' ? inner.user : 'unknown';
        const channel = typeof inner.channel === 'string' ? inner.channel : 'unknown';
        await this.emitMessage({
          id: ts,
          userId: channel,
          channel: this.channel,
          text: inner.text,
          raw: event,
          receivedAt: Math.floor(Number(ts) * 1000) || Date.now(),
        });
        logger.debug('slack.message', { user, channel });
        return 'handled';
      }
    }
    return 'ignored';
  }

  private async postApi(method: string, body: Record<string, unknown>): Promise<void> {
    if (!this.config.botToken) throw new Error('SlackAdapter.postApi requires botToken');
    const res = await fetch(`https://slack.com/api/${method}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=utf-8',
        authorization: `Bearer ${this.config.botToken}`,
      },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || json.ok === false) {
      throw new Error(`slack ${method} failed: ${json.error ?? res.statusText}`);
    }
  }
}
