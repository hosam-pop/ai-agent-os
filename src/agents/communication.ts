import { EventEmitter } from 'node:events';
import { logger } from '../utils/logger.js';

/**
 * Inter-agent messaging bus.
 *
 * Sub-agents (spawned by the COORDINATOR feature or by user plugins) exchange
 * structured messages through this bus. It's a simple in-process EventEmitter
 * with a typed surface; distributed transports (IPC, websocket) could plug in
 * later without changing callers.
 */

export interface AgentMessage<T = unknown> {
  id: string;
  from: string;
  to: string | 'broadcast';
  kind: 'task' | 'status' | 'result' | 'shutdown' | 'custom';
  payload: T;
  ts: number;
}

function genId(): string {
  return `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export class AgentBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  send<T>(msg: Omit<AgentMessage<T>, 'id' | 'ts'>): AgentMessage<T> {
    const full: AgentMessage<T> = { ...msg, id: genId(), ts: Date.now() };
    logger.debug('agent-bus.send', { from: full.from, to: full.to, kind: full.kind, id: full.id });
    this.emitter.emit(full.to, full);
    if (full.to !== 'broadcast') this.emitter.emit('broadcast', full);
    return full;
  }

  subscribe(recipient: string, handler: (msg: AgentMessage) => void | Promise<void>): () => void {
    const wrapped = (m: AgentMessage) => {
      Promise.resolve(handler(m)).catch((err) => {
        logger.warn('agent-bus.handler.error', {
          recipient,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    };
    this.emitter.on(recipient, wrapped);
    return () => this.emitter.off(recipient, wrapped);
  }
}

export const agentBus = new AgentBus();
