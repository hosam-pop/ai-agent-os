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
import { ContainerScanTool } from './security/container/container-scan-tool.js';
import { RuntimeMonitorTool } from './security/runtime/runtime-monitor-tool.js';
import { LlmGuardTool } from './security/llm-guard/llm-guard-tool.js';
import { VigilClient } from './security/llm-guard/vigil-client.js';
import { CveLookupTool } from './security/threat-intel/cve-lookup-tool.js';
import { AtomicLookupTool } from './security/detection-eng/atomic-lookup-tool.js';
import { buildGatedMCPClient, type GatedMCPClient } from './integrations/mcp/mcp-gateway.js';
import { createLettaMemory } from './memory/letta/letta-memory.js';
import { createZepMemory } from './memory/zep/zep-memory.js';
import { VectorStoreTool } from './vector-stores/vector-store-tool.js';
import { RagTool } from './rag/rag-tool.js';
import { SkillPlanner } from './orchestration/skill-planner.js';
import { StagehandTool } from './integrations/browser/stagehand-tool.js';

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
  letta: Mem0Adapter | null;
  zep: Mem0Adapter | null;
  mcp: MCPClient | null;
  mcpGateway: GatedMCPClient | null;
  codeqlMcp: MCPClient | null;
  semgrepMcp: MCPClient | null;
  skillPlanner: SkillPlanner | null;
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
  let mcpGateway: GatedMCPClient | null = null;
  if (feature('MCP') && (env.MCP_SERVER_URL || env.MCP_SERVER_STDIO)) {
    try {
      mcp = new MCPClient();
      if (feature('MCP_GATEWAY')) {
        mcpGateway = buildGatedMCPClient({
          client: mcp,
          policy: {
            allowTools: parseCsv(env.MCP_GATEWAY_ALLOW_TOOLS),
            denyTools: parseCsv(env.MCP_GATEWAY_DENY_TOOLS),
            rateLimitPerTool: env.MCP_GATEWAY_RATE_LIMIT,
            rateWindowMs: env.MCP_GATEWAY_WINDOW_MS,
            scanResponses: env.MCP_GATEWAY_SCAN_RESPONSES,
            vigil:
              env.MCP_GATEWAY_SCAN_RESPONSES && env.VIGIL_URL
                ? new VigilClient({ baseUrl: env.VIGIL_URL, token: env.VIGIL_TOKEN })
                : undefined,
          },
        });
        tools.register(new MCPTool(mcpGateway as unknown as MCPClient));
      } else {
        tools.register(new MCPTool(mcp));
      }
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

  let codeqlMcp: MCPClient | null = null;
  if (feature('CODEQL_MCP') && (env.CODEQL_MCP_URL || env.CODEQL_MCP_STDIO)) {
    try {
      codeqlMcp = new MCPClient({ url: env.CODEQL_MCP_URL, stdio: env.CODEQL_MCP_STDIO });
      const codeqlTool = new MCPTool(codeqlMcp);
      (codeqlTool as { name: string }).name = 'codeql_mcp';
      tools.register(codeqlTool);
    } catch (err) {
      logger.warn('bootstrap.codeql_mcp.error', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  let semgrepMcp: MCPClient | null = null;
  if (feature('SEMGREP_MCP') && (env.SEMGREP_MCP_URL || env.SEMGREP_MCP_STDIO)) {
    try {
      semgrepMcp = new MCPClient({ url: env.SEMGREP_MCP_URL, stdio: env.SEMGREP_MCP_STDIO });
      const semgrepTool = new MCPTool(semgrepMcp);
      (semgrepTool as { name: string }).name = 'semgrep_mcp';
      tools.register(semgrepTool);
    } catch (err) {
      logger.warn('bootstrap.semgrep_mcp.error', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  let letta: Mem0Adapter | null = null;
  if (feature('LETTA')) {
    try {
      letta = await createLettaMemory();
    } catch (err) {
      logger.warn('bootstrap.letta.error', { error: err instanceof Error ? err.message : String(err) });
    }
  }

  let zep: Mem0Adapter | null = null;
  if (feature('ZEP')) {
    try {
      zep = await createZepMemory();
    } catch (err) {
      logger.warn('bootstrap.zep.error', { error: err instanceof Error ? err.message : String(err) });
    }
  }

  if (feature('VECTOR_STORES')) {
    tools.register(new VectorStoreTool());
  }
  if (feature('RAG')) {
    tools.register(new RagTool());
  }
  if (feature('STAGEHAND')) {
    tools.register(new StagehandTool());
  }

  const skillPlanner = feature('SKILL_PLANNER') ? new SkillPlanner() : null;

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
  if (feature('CONTAINER_SCAN')) {
    tools.register(new ContainerScanTool());
  }
  if (feature('RUNTIME_MONITOR')) {
    tools.register(new RuntimeMonitorTool());
  }
  if (feature('LLM_GUARD')) {
    tools.register(new LlmGuardTool());
  }
  if (feature('THREAT_INTEL')) {
    tools.register(new CveLookupTool());
  }
  if (feature('DETECTION_ENG')) {
    tools.register(new AtomicLookupTool());
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
    letta,
    zep,
    mcp,
    mcpGateway,
    codeqlMcp,
    semgrepMcp,
    skillPlanner,
    channels,
    workspace: paths.workspace,
    model,
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
  };
}

function parseCsv(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  const items = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}
