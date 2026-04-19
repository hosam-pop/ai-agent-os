import { logger } from '../../utils/logger.js';

/**
 * Multi-channel messaging scaffolding inspired by {@link
 * https://github.com/openclaw/openclaw openclaw}, an open-source personal
 * assistant that normalises WhatsApp/Telegram/Slack/Discord chats into a
 * unified conversation model. We port the adapter shape — `connect`,
 * `send`, `receive` — and provide two production-ready concrete
 * implementations (Telegram + Slack). WhatsApp and Discord adapters can be
 * added by extending {@link ChannelAdapter} with their vendor APIs.
 */

export interface ChannelIncomingMessage {
  id: string;
  userId: string;
  channel: string;
  text: string;
  raw: unknown;
  receivedAt: number;
}

export interface ChannelOutgoingMessage {
  userId: string;
  text: string;
  threadId?: string;
  metadata?: Record<string, unknown>;
}

export type ChannelListener = (msg: ChannelIncomingMessage) => void | Promise<void>;

export abstract class ChannelAdapter<Config = unknown> {
  abstract readonly channel: string;

  protected readonly listeners: ChannelListener[] = [];

  constructor(public readonly config: Config) {}

  abstract connect(): Promise<void>;
  abstract send(msg: ChannelOutgoingMessage): Promise<void>;
  abstract disconnect(): Promise<void>;

  onMessage(listener: ChannelListener): void {
    this.listeners.push(listener);
  }

  protected async emitMessage(msg: ChannelIncomingMessage): Promise<void> {
    for (const l of this.listeners) {
      try {
        await l(msg);
      } catch (err) {
        logger.warn('channel.listener.error', {
          channel: this.channel,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
}

export class ChannelRegistry {
  private readonly adapters = new Map<string, ChannelAdapter>();

  register(adapter: ChannelAdapter): void {
    if (this.adapters.has(adapter.channel)) {
      logger.warn('channel.register.override', { channel: adapter.channel });
    }
    this.adapters.set(adapter.channel, adapter);
    logger.info('channel.register', { channel: adapter.channel });
  }

  get(name: string): ChannelAdapter | undefined {
    return this.adapters.get(name);
  }

  list(): ChannelAdapter[] {
    return [...this.adapters.values()];
  }

  async connectAll(): Promise<void> {
    for (const a of this.adapters.values()) {
      try {
        await a.connect();
      } catch (err) {
        logger.warn('channel.connect.error', {
          channel: a.channel,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  async disconnectAll(): Promise<void> {
    for (const a of this.adapters.values()) {
      try {
        await a.disconnect();
      } catch (err) {
        logger.warn('channel.disconnect.error', {
          channel: a.channel,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
}
