import { feature } from '../config/feature-flags.js';
import { SubAgentManager, type SubAgentHandle } from '../agents/sub-agent-manager.js';
import { agentBus } from '../agents/communication.js';
import type { AgentLoopOptions } from '../core/agent-loop.js';
import { AgentLoop } from '../core/agent-loop.js';
import { logger } from '../utils/logger.js';

/**
 * COORDINATOR mode.
 *
 * Port of Claude-Code's COORDINATOR pattern (src/coordinator/). The main
 * Claude becomes a pure dispatcher that can only (1) spawn a worker via
 * `agent`, (2) send a message via `sendMessage`, or (3) shut down via
 * `shutdown`. Workers hold the actual tools.
 *
 * Gated by DOGE_FEATURE_COORDINATOR=true.
 */

export interface DispatchRequest {
  name: string;
  goal: string;
  loopOptions: AgentLoopOptions;
}

export class Coordinator {
  private readonly manager: SubAgentManager;
  private readonly workers = new Map<string, SubAgentHandle>();

  constructor() {
    if (!feature('COORDINATOR')) {
      logger.debug('coordinator.disabled');
    }
    this.manager = new SubAgentManager((opts) => new AgentLoop(opts));
  }

  dispatch(req: DispatchRequest): SubAgentHandle {
    if (!feature('COORDINATOR')) {
      throw new Error('COORDINATOR feature is disabled (set DOGE_FEATURE_COORDINATOR=true)');
    }
    const worker = this.manager.spawn({ ...req.loopOptions, name: req.name });
    this.workers.set(worker.id, worker);
    // Fire and observe — caller can await worker.run(req.goal) separately.
    logger.info('coordinator.dispatch', { id: worker.id, name: req.name });
    return worker;
  }

  sendMessage(to: string, kind: 'task' | 'custom', payload: unknown): void {
    agentBus.send({ from: 'coordinator', to, kind, payload });
  }

  shutdown(): void {
    for (const worker of this.workers.values()) worker.shutdown();
    this.workers.clear();
    this.manager.shutdownAll();
  }

  workerList(): SubAgentHandle[] {
    return [...this.workers.values()];
  }
}
