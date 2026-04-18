import { logger } from '../utils/logger.js';

/**
 * Lifecycle hooks.
 *
 * Plugins and user code can register listeners for key moments in the agent
 * lifecycle. Mirrors Claude-Code's costHook / preTask / postTask style hooks
 * but without the bundler-specific plumbing.
 */

export type HookEvent = 'preTask' | 'postTask' | 'preToolCall' | 'postToolCall' | 'onError';

export interface HookPayloads {
  preTask: { taskId: string; goal: string };
  postTask: { taskId: string; success: boolean; output?: string };
  preToolCall: { tool: string; args: unknown };
  postToolCall: { tool: string; ok: boolean; output?: string; error?: string };
  onError: { scope: string; error: string };
}

export type HookHandler<E extends HookEvent> = (payload: HookPayloads[E]) => void | Promise<void>;

type HandlerMap = {
  [E in HookEvent]: Set<HookHandler<E>>;
};

export class LifecycleHooks {
  private readonly handlers: HandlerMap = {
    preTask: new Set(),
    postTask: new Set(),
    preToolCall: new Set(),
    postToolCall: new Set(),
    onError: new Set(),
  };

  on<E extends HookEvent>(event: E, handler: HookHandler<E>): () => void {
    (this.handlers[event] as Set<HookHandler<E>>).add(handler);
    return () => {
      (this.handlers[event] as Set<HookHandler<E>>).delete(handler);
    };
  }

  async emit<E extends HookEvent>(event: E, payload: HookPayloads[E]): Promise<void> {
    const set = this.handlers[event] as Set<HookHandler<E>>;
    for (const handler of set) {
      try {
        await handler(payload);
      } catch (err) {
        logger.warn('hook.error', { event, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  clear(): void {
    for (const set of Object.values(this.handlers)) set.clear();
  }
}

export const hooks = new LifecycleHooks();
