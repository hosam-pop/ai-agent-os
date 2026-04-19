import { loadEnv } from './config/env-loader.js';
import { ensureDirs, paths } from './config/paths.js';
import { buildProvider, resolveDefaultModel } from './api/provider-factory.js';
import { ShortTermMemory } from './memory/short-term.js';
import { LongTermMemory } from './memory/long-term.js';
import { PolicyEngine } from './permissions/policy-engine.js';
import { Sandbox } from './tools/sandbox.js';
import { ToolRegistry, type Tool } from './tools/registry.js';
import { BashTool } from './tools/bash-tool.js';
import { FileTool } from './tools/file-tool.js';
import { WebTool } from './tools/web-tool.js';
import { AdminTool } from './tools/admin-tool.js';
import { Executor } from './core/executor.js';
import { AgentLoop, type AgentLoopOptions } from './core/agent-loop.js';
import { Orchestrator } from './core/orchestrator.js';
import { PluginLoader } from './plugins/loader.js';
import { hooks } from './hooks/lifecycle-hooks.js';
import { logger } from './utils/logger.js';
import { feature, listFeatures } from './config/feature-flags.js';
import { BrowserTool } from './integrations/browser/browser-tool.js';
import { MCPClient } from './integrations/mcp/mcp-client.js';
import { MCPTool } from './integrations/mcp/mcp-tool.js';
import { buildSocialTools } from './integrations/social/social-tools.js';
import { createMem0Memory, type Mem0Adapter } from './integrations/mem0/mem0-memory.js';
import { Mem0Tool } from './integrations/mem0/mem0-tool.js';
import { ChannelRegistry } from './integrations/openclaw/channel-adapter.js';
import { TelegramAdapter } from './integrations/openclaw/telegram-adapter.js';
import { SlackAdapter } from './integrations/openclaw/slack-adapter.js';
import { SastTool } from './security/sast/sast-tool.js';
import { DastTool } from './security/dast/dast-tool.js';
import { LogAnalysisTool } from './security/log-analysis/log-analysis-tool.js';
import { IdsTool } from './security/ids/ids-tool.js';

/**
 * Bootstrap: wire every subsystem into a cohesive runtime.
 *
 * Each integration is gated by its feature flag (see
 * {@link feature-flags.ts}) so the default footprint stays small and
 * predictable. The returned {@link RuntimeHandles} exposes the wired pieces
 * so the CLI, TUI, and plugins can reach into them without re-wiring.
 */

const DEFAULT_SYSTEM_PROMPT = `You are AI Agent OS, an autonomous coding and research
agent. You operate a Think → Plan → Act → Observe loop with access to bash,
file, web, and — when enabled — browser, memory, MCP, and social tools inside
a sandboxed workspace. Be concise. When you need to act, call the appropriate
tool. When you are done, reply with the final answer and stop calling tools.`;

export interface RuntimeHandles {
  agent: AgentLoop;
  orchestrator: Orchestrator;
  tools: ToolRegistry;
  longTermMemory: LongTermMemory;
  mem0: Mem0Adapter | null;
  mcp: MCPClient | null;
  channels: ChannelRegistry;
  workspace: string;
  model: string;
  systemPrompt: string;
}

export async function bootstrap(): Promise<RuntimeHandles> {
  const env = loadEnv();
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

  if (feature('ADMIN')) {
    tools.register(new AdminTool());
  }

  if (feature('BROWSER')) {
    tools.register(new BrowserTool());
  }

  const longTermMemory = new LongTermMemory();

  let mem0: Mem0Adapter | null = null;
  if (feature('MEM0')) {
    try {
      mem0 = await createMem0Memory();
      tools.register(new Mem0Tool(mem0));
    } catch (err) {
      logger.warn('bootstrap.mem0.error', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  let mcp: MCPClient | null = null;
  if (feature('MCP') && (env.MCP_SERVER_URL || env.MCP_SERVER_STDIO)) {
    try {
      mcp = new MCPClient();
      tools.register(new MCPTool(mcp));
      if (feature('SOCIAL')) {
        for (const tool of buildSocialTools(mcp)) {
          tools.register(tool as Tool<unknown>);
        }
      }
    } catch (err) {
      logger.warn('bootstrap.mcp.error', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (feature('SAST')) {
    tools.register(new SastTool());
  }
  if (feature('DAST')) {
    tools.register(new DastTool());
  }
  if (feature('LOG_ANALYSIS')) {
    tools.register(new LogAnalysisTool());
  }
  if (feature('IDS')) {
    tools.register(new IdsTool());
  }

  const channels = new ChannelRegistry();
  if (feature('SOCIAL')) {
    if (env.TELEGRAM_BOT_TOKEN) {
      channels.register(new TelegramAdapter({ botToken: env.TELEGRAM_BOT_TOKEN }));
    }
    if (env.SLACK_BOT_TOKEN || env.SLACK_WEBHOOK_URL) {
      channels.register(
        new SlackAdapter({
          botToken: env.SLACK_BOT_TOKEN,
          webhookUrl: env.SLACK_WEBHOOK_URL,
          signingSecret: env.SLACK_SIGNING_SECRET,
        }),
      );
    }
  }

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
    mem0,
    mcp,
    channels,
    workspace: paths.workspace,
    model,
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
  };
}
