import { AgentLoop, type AgentLoopOptions, type AgentRunResult } from '../core/agent-loop.js';
import { agentBus } from './communication.js';
import { logger } from '../utils/logger.js';

export interface SubAgentHandle {
  id: string;
  name: string;
  status: 'idle' | 'running' | 'done' | 'error';
  run(goal: string): Promise<AgentRunResult>;
  shutdown(): void;
}

/**
 * Sub-agent manager.
 *
 * Implements Claude-Code's COORDINATOR pattern: a main loop can spawn
 * specialized worker agents (each with its own AgentLoop + memory) and
 * exchange status/result messages via the bus. Workers all run in-process.
 */
export class SubAgentManager {
  private readonly agents = new Map<string, SubAgentHandle>();

  constructor(private readonly makeAgent: (opts: AgentLoopOptions) => AgentLoop) {}

  spawn(opts: AgentLoopOptions & { name: string }): SubAgentHandle {
    const id = `sub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const agent = this.makeAgent(opts);
    const handle: SubAgentHandle = {
      id,
      name: opts.name,
      status: 'idle',
      run: async (goal) => {
        handle.status = 'running';
        agentBus.send({ from: id, to: 'broadcast', kind: 'status', payload: { status: 'running', goal } });
        try {
          const r = await agent.run(goal);
          handle.status = 'done';
          agentBus.send({ from: id, to: 'broadcast', kind: 'result', payload: { output: r.finalText } });
          return r;
        } catch (err) {
          handle.status = 'error';
          agentBus.send({
            from: id,
            to: 'broadcast',
            kind: 'status',
            payload: { status: 'error', error: err instanceof Error ? err.message : String(err) },
          });
          throw err;
        }
      },
      shutdown: () => {
        handle.status = 'done';
        agentBus.send({ from: id, to: 'broadcast', kind: 'shutdown', payload: {} });
        this.agents.delete(id);
      },
    };
    this.agents.set(id, handle);
    logger.info('sub-agent.spawn', { id, name: opts.name });
    return handle;
  }

  list(): SubAgentHandle[] {
    return [...this.agents.values()];
  }

  get(id: string): SubAgentHandle | undefined {
    return this.agents.get(id);
  }

  shutdownAll(): void {
    for (const h of this.agents.values()) h.shutdown();
    this.agents.clear();
  }
}
