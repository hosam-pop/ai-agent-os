import { logger } from '../../utils/logger.js';
import {
  ChannelAdapter,
  type ChannelIncomingMessage,
  type ChannelOutgoingMessage,
} from './channel-adapter.js';

/**
 * Telegram channel adapter.
 *
 * Uses the Telegram Bot HTTP API for both sending (`sendMessage`) and
 * receiving (`getUpdates` long-poll). Production deployments may prefer
 * the webhook variant; see {@link handleTelegramWebhook} on the same
 * module which can be mounted under `BridgeServer` if the BRIDGE feature
 * gate is enabled.
 */

export interface TelegramConfig {
  botToken: string;
  pollIntervalMs?: number;
  disableWebPagePreview?: boolean;
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; username?: string };
    chat: { id: number };
    date: number;
    text?: string;
  };
}

interface TelegramSendOptions {
  chat_id: number | string;
  text: string;
  reply_to_message_id?: number;
  disable_web_page_preview?: boolean;
}

export class TelegramAdapter extends ChannelAdapter<TelegramConfig> {
  readonly channel = 'telegram';
  private timer: NodeJS.Timeout | null = null;
  private lastUpdateId = 0;
  private closed = false;

  private get apiRoot(): string {
    return `https://api.telegram.org/bot${this.config.botToken}`;
  }

  async connect(): Promise<void> {
    if (!this.config.botToken) throw new Error('TelegramAdapter requires botToken');
    const interval = this.config.pollIntervalMs ?? 2500;
    this.closed = false;
    const loop = async (): Promise<void> => {
      if (this.closed) return;
      try {
        const updates = await this.fetchUpdates();
        for (const u of updates) await this.handleUpdate(u);
      } catch (err) {
        logger.warn('telegram.poll.error', {
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        if (!this.closed) {
          this.timer = setTimeout(() => void loop(), interval);
        }
      }
    };
    void loop();
    logger.info('telegram.connected', { pollMs: interval });
  }

  async send(msg: ChannelOutgoingMessage): Promise<void> {
    const chatId = Number(msg.userId);
    if (!Number.isFinite(chatId)) throw new Error(`telegram: invalid chat id ${msg.userId}`);
    const payload: TelegramSendOptions = {
      chat_id: chatId,
      text: msg.text,
      disable_web_page_preview: this.config.disableWebPagePreview,
    };
    if (msg.threadId) {
      const replyId = Number(msg.threadId);
      if (Number.isFinite(replyId)) payload.reply_to_message_id = replyId;
    }
    await this.post('sendMessage', payload);
  }

  async disconnect(): Promise<void> {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  async handleWebhook(update: unknown): Promise<void> {
    if (update && typeof update === 'object' && 'update_id' in update) {
      await this.handleUpdate(update as TelegramUpdate);
    }
  }

  private async fetchUpdates(): Promise<TelegramUpdate[]> {
    const res = await fetch(
      `${this.apiRoot}/getUpdates?offset=${this.lastUpdateId + 1}&timeout=0`,
    );
    if (!res.ok) throw new Error(`telegram getUpdates ${res.status}`);
    const body = (await res.json()) as { ok: boolean; result?: TelegramUpdate[] };
    return body.result ?? [];
  }

  private async handleUpdate(update: TelegramUpdate): Promise<void> {
    if (update.update_id > this.lastUpdateId) this.lastUpdateId = update.update_id;
    const m = update.message;
    if (!m?.text) return;
    const incoming: ChannelIncomingMessage = {
      id: String(m.message_id),
      userId: String(m.chat.id),
      channel: this.channel,
      text: m.text,
      raw: update,
      receivedAt: m.date * 1000,
    };
    await this.emitMessage(incoming);
  }

  private async post(method: string, body: unknown): Promise<unknown> {
    const res = await fetch(`${this.apiRoot}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`telegram ${method} ${res.status}: ${text}`);
    }
    return res.json();
  }
}
