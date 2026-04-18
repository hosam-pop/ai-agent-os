import { loadEnv } from './config/env-loader.js';
import { ensureDirs, paths } from './config/paths.js';
import { buildProvider, resolveDefaultModel } from './api/provider-factory.js';
import { ShortTermMemory } from './memory/short-term.js';
import { LongTermMemory } from './memory/long-term.js';
import { PolicyEngine } from './permissions/policy-engine.js';
import { Sandbox } from './tools/sandbox.js';
import { ToolRegistry } from './tools/registry.js';
import { BashTool } from './tools/bash-tool.js';
import { FileTool } from './tools/file-tool.js';
import { WebTool } from './tools/web-tool.js';
import { Executor } from './core/executor.js';
import { AgentLoop, type AgentLoopOptions } from './core/agent-loop.js';
import { Orchestrator } from './core/orchestrator.js';
import { PluginLoader } from './plugins/loader.js';
import { hooks } from './hooks/lifecycle-hooks.js';
import { logger } from './utils/logger.js';
import { listFeatures } from './config/feature-flags.js';

/**
 * Bootstrap: wire every subsystem into a cohesive runtime.
 *
 * Returns a pre-built AgentLoop that callers can `.run(goal)`, plus handles
 * to the Orchestrator (for decomposed multi-step goals) and the tool/long-
 * term-memory surfaces so features can plug in.
 */

const DEFAULT_SYSTEM_PROMPT = `You are AI Agent OS, an autonomous coding and research
agent. You operate a Think → Plan → Act → Observe loop with access to bash,
file, and web tools inside a sandboxed workspace. Be concise. When you need to
act, call the appropriate tool. When you are done, reply with the final answer
and stop calling tools.`;

export interface RuntimeHandles {
  agent: AgentLoop;
  orchestrator: Orchestrator;
  tools: ToolRegistry;
  longTermMemory: LongTermMemory;
  workspace: string;
  model: string;
  systemPrompt: string;
}

export async function bootstrap(): Promise<RuntimeHandles> {
  loadEnv();
  ensureDirs();

  logger.info('bootstrap.start', {
    workspace: paths.workspace,
    home: paths.home,
    features: listFeatures(),
  });

  const provider = buildProvider();
  const model = resolveDefaultModel();
  const policy = new PolicyEngine();
  const sandbox = new Sandbox(paths.workspace);

  const tools = new ToolRegistry();
  tools.register(new BashTool(policy));
  tools.register(new FileTool(policy, sandbox));
  tools.register(new WebTool(policy));

  const longTermMemory = new LongTermMemory();

  const pluginLoader = new PluginLoader({ tools, hooks, logger });
  await pluginLoader.loadAll().catch((err) => {
    logger.warn('bootstrap.plugins.error', { error: String(err) });
    return [];
  });

  const makeAgent = (override?: Partial<AgentLoopOptions>): AgentLoop => {
    const executor = new Executor(tools, { workspace: paths.workspace });
    return new AgentLoop({
      provider,
      tools,
      executor,
      model,
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
      memory: new ShortTermMemory(loadEnv().DOGE_CONTEXT_TOKEN_BUDGET),
      ...override,
    });
  };

  const agent = makeAgent();
  const orchestrator = new Orchestrator(provider, model, () => makeAgent());

  return {
    agent,
    orchestrator,
    tools,
    longTermMemory,
    workspace: paths.workspace,
    model,
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
  };
}
