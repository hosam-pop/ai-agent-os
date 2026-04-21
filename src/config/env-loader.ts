import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

const EnvSchema = z.object({
  DOGE_PROVIDER: z
    .enum(['anthropic', 'openai', 'custom', 'router', 'octoroute'])
    .default('anthropic'),
  DOGE_MODEL: z.string().default('claude-3-5-sonnet-latest'),

  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_BASE_URL: z.string().url().default('https://api.anthropic.com'),

  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().url().default('https://api.openai.com/v1'),

  DOGE_CUSTOM_BASE_URL: z.string().url().optional(),
  DOGE_CUSTOM_API_KEY: z.string().optional(),
  DOGE_CUSTOM_MODEL: z.string().optional(),

  DOGE_HOME: z.string().optional(),
  DOGE_WORKSPACE: z.string().optional(),

  DOGE_PERMISSION_MODE: z.enum(['strict', 'default', 'permissive']).default('default'),
  DOGE_ALLOW_NETWORK: z.coerce.boolean().default(true),
  DOGE_ALLOW_WRITES: z.coerce.boolean().default(true),

  DOGE_LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  DOGE_FEATURE_BUDDY: z.coerce.boolean().default(false),
  DOGE_FEATURE_KAIROS: z.coerce.boolean().default(false),
  DOGE_FEATURE_ULTRAPLAN: z.coerce.boolean().default(false),
  DOGE_FEATURE_COORDINATOR: z.coerce.boolean().default(false),
  DOGE_FEATURE_BRIDGE: z.coerce.boolean().default(false),

  DOGE_FEATURE_ADMIN: z.coerce.boolean().default(true),
  DOGE_FEATURE_BROWSER: z.coerce.boolean().default(false),
  DOGE_FEATURE_MEM0: z.coerce.boolean().default(false),
  DOGE_FEATURE_MCP: z.coerce.boolean().default(false),
  DOGE_FEATURE_ROUTER: z.coerce.boolean().default(false),
  DOGE_FEATURE_SOCIAL: z.coerce.boolean().default(false),
  DOGE_FEATURE_OCTOROUTE: z.coerce.boolean().default(false),

  DOGE_FEATURE_SAST: z.coerce.boolean().default(false),
  DOGE_FEATURE_DAST: z.coerce.boolean().default(false),
  DOGE_FEATURE_LOG_ANALYSIS: z.coerce.boolean().default(false),
  DOGE_FEATURE_IDS: z.coerce.boolean().default(false),
  DOGE_FEATURE_CONTAINER_SCAN: z.coerce.boolean().default(false),
  DOGE_FEATURE_RUNTIME_MONITOR: z.coerce.boolean().default(false),
  DOGE_FEATURE_ORCHESTRATION: z.coerce.boolean().default(false),
  DOGE_FEATURE_LLM_GUARD: z.coerce.boolean().default(false),
  DOGE_FEATURE_THREAT_INTEL: z.coerce.boolean().default(false),
  DOGE_FEATURE_DETECTION_ENG: z.coerce.boolean().default(false),

  DOGE_FEATURE_MCP_GATEWAY: z.coerce.boolean().default(false),
  DOGE_FEATURE_LETTA: z.coerce.boolean().default(false),
  DOGE_FEATURE_ZEP: z.coerce.boolean().default(false),
  DOGE_FEATURE_VECTOR_STORES: z.coerce.boolean().default(false),
  DOGE_FEATURE_RAG: z.coerce.boolean().default(false),
  DOGE_FEATURE_SKILL_PLANNER: z.coerce.boolean().default(false),
  DOGE_FEATURE_STAGEHAND: z.coerce.boolean().default(false),
  DOGE_FEATURE_CODEQL_MCP: z.coerce.boolean().default(false),
  DOGE_FEATURE_SEMGREP_MCP: z.coerce.boolean().default(false),

  MCP_GATEWAY_ALLOW_TOOLS: z.string().optional(),
  MCP_GATEWAY_DENY_TOOLS: z.string().optional(),
  MCP_GATEWAY_RATE_LIMIT: z.coerce.number().int().positive().optional(),
  MCP_GATEWAY_WINDOW_MS: z.coerce.number().int().positive().optional(),
  MCP_GATEWAY_SCAN_RESPONSES: z.coerce.boolean().default(false),

  LETTA_URL: z.string().url().optional(),
  LETTA_TOKEN: z.string().optional(),
  LETTA_AGENT_ID: z.string().optional(),

  ZEP_URL: z.string().url().optional(),
  ZEP_API_KEY: z.string().optional(),
  ZEP_SESSION_ID: z.string().optional(),

  VECTOR_STORE_BACKEND: z.enum(['qdrant', 'chroma', 'lancedb']).optional(),
  QDRANT_URL: z.string().url().optional(),
  QDRANT_API_KEY: z.string().optional(),
  CHROMA_URL: z.string().url().optional(),
  CHROMA_TOKEN: z.string().optional(),
  LANCEDB_URI: z.string().optional(),

  BROWSERBASE_API_KEY: z.string().optional(),
  BROWSERBASE_PROJECT_ID: z.string().optional(),
  STAGEHAND_MODEL_NAME: z.string().optional(),

  CODEQL_MCP_URL: z.string().url().optional(),
  CODEQL_MCP_STDIO: z.string().optional(),
  SEMGREP_MCP_URL: z.string().url().optional(),
  SEMGREP_MCP_STDIO: z.string().optional(),

  MEM0_API_KEY: z.string().optional(),
  MEM0_ORG_ID: z.string().optional(),
  MEM0_PROJECT_ID: z.string().optional(),
  MEM0_USER_ID: z.string().default('ai-agent-os-default'),

  MCP_SERVER_URL: z.string().optional(),
  MCP_SERVER_TOKEN: z.string().optional(),
  MCP_SERVER_STDIO: z.string().optional(),

  DOGE_ROUTER_CONFIG: z.string().optional(),
  DOGE_ROUTER_STRATEGY: z
    .enum(['failover', 'round-robin', 'weighted', 'least-recent'])
    .default('failover'),

  OCTOROUTE_URL: z.string().optional(),
  OCTOROUTE_API_KEY: z.string().optional(),
  OCTOROUTE_MODEL: z.string().default('gpt-4o-mini'),

  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  SLACK_BOT_TOKEN: z.string().optional(),
  SLACK_WEBHOOK_URL: z.string().url().optional(),
  SLACK_SIGNING_SECRET: z.string().optional(),

  BROWSER_HEADLESS: z.coerce.boolean().default(true),
  BROWSER_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  BROWSER_EXECUTABLE_PATH: z.string().optional(),

  DOGE_MAX_ITERATIONS: z.coerce.number().int().positive().default(25),
  DOGE_MAX_PARALLEL_TASKS: z.coerce.number().int().positive().default(4),
  DOGE_CONTEXT_TOKEN_BUDGET: z.coerce.number().int().positive().default(120_000),

  SEMGREP_BIN: z.string().optional(),
  CODEQL_BIN: z.string().optional(),
  BEARER_BIN: z.string().optional(),
  NUCLEI_BIN: z.string().optional(),
  ZAP_BIN: z.string().optional(),
  GRYPE_BIN: z.string().optional(),
  TRIVY_BIN: z.string().optional(),
  FALCO_LOG_PATH: z.string().optional(),

  ELASTIC_URL: z.string().url().optional(),
  ELASTIC_API_KEY: z.string().optional(),
  ELASTIC_USERNAME: z.string().optional(),
  ELASTIC_PASSWORD: z.string().optional(),

  WAZUH_URL: z.string().url().optional(),
  WAZUH_USERNAME: z.string().optional(),
  WAZUH_PASSWORD: z.string().optional(),
  WAZUH_TOKEN: z.string().optional(),

  SURICATA_EVE_PATH: z.string().optional(),

  VIGIL_URL: z.string().url().optional(),
  VIGIL_TOKEN: z.string().optional(),

  OSV_URL: z.string().url().optional(),

  ATOMIC_RED_TEAM_PATH: z.string().optional(),

  // Enterprise integrations (feat/enterprise-integrations-real)
  DOGE_FEATURE_COMPOSIO: z.coerce.boolean().default(false),
  DOGE_FEATURE_ARCADE: z.coerce.boolean().default(false),
  DOGE_FEATURE_IRON_CURTAIN: z.coerce.boolean().default(false),
  DOGE_FEATURE_KAVACH: z.coerce.boolean().default(false),
  DOGE_FEATURE_LANGFUSE: z.coerce.boolean().default(false),
  DOGE_FEATURE_POSTHOG: z.coerce.boolean().default(false),
  DOGE_FEATURE_OPENLIT: z.coerce.boolean().default(false),
  DOGE_FEATURE_AGENTWATCH: z.coerce.boolean().default(false),
  DOGE_FEATURE_AGENTEST: z.coerce.boolean().default(false),
  DOGE_FEATURE_TOOL_DISCOVERY: z.coerce.boolean().default(false),

  COMPOSIO_API_KEY: z.string().optional(),
  COMPOSIO_BASE_URL: z.string().url().optional(),
  COMPOSIO_USER_ID: z.string().optional(),

  ARCADE_API_KEY: z.string().optional(),
  ARCADE_BASE_URL: z.string().url().optional(),
  ARCADE_USER_ID: z.string().optional(),

  KAVACH_SIGNING_KEY: z.string().optional(),
  KAVACH_ISSUER: z.string().optional(),

  LANGFUSE_PUBLIC_KEY: z.string().optional(),
  LANGFUSE_SECRET_KEY: z.string().optional(),
  LANGFUSE_BASE_URL: z.string().url().optional(),

  POSTHOG_API_KEY: z.string().optional(),
  POSTHOG_HOST: z.string().url().optional(),
  POSTHOG_DISTINCT_ID: z.string().optional(),

  OPENLIT_APPLICATION_NAME: z.string().optional(),
  OPENLIT_ENVIRONMENT: z.string().optional(),
  OPENLIT_OTLP_ENDPOINT: z.string().optional(),
  OPENLIT_OTLP_HEADERS: z.string().optional(),

  AGENTWATCH_ENDPOINT: z.string().url().optional(),
  AGENTWATCH_API_KEY: z.string().optional(),
  AGENTWATCH_SERVICE_NAME: z.string().optional(),

  AGENTEST_API_KEY: z.string().optional(),

  // enterprise-architecture-v1 gates — every one default false.
  ENABLE_OPENFANG: z.coerce.boolean().default(false),
  ENABLE_ARGENTOR: z.coerce.boolean().default(false),
  ENABLE_QUALIXAR: z.coerce.boolean().default(false),
  ENABLE_ASTERAI_SANDBOX: z.coerce.boolean().default(false),
  ENABLE_AUTO_DREAM: z.coerce.boolean().default(false),
  ENABLE_GRAPH_MEMORY: z.coerce.boolean().default(false),
  ENABLE_TEMPORAL_MEMORY: z.coerce.boolean().default(false),
  ENABLE_HYBRID_RETRIEVAL: z.coerce.boolean().default(false),

  OPENFANG_ENDPOINT: z.string().url().optional(),
  OPENFANG_API_KEY: z.string().optional(),
  OPENFANG_MCP_STDIO: z.string().optional(),

  ARGENTOR_ENDPOINT: z.string().url().optional(),
  ARGENTOR_API_KEY: z.string().optional(),
  ARGENTOR_MCP_STDIO: z.string().optional(),

  QUALIXAR_ENDPOINT: z.string().url().optional(),
  QUALIXAR_API_KEY: z.string().optional(),

  ASTERAI_WASM_DIR: z.string().optional(),
  ASTERAI_DEFAULT_FUEL: z.coerce.number().int().positive().optional(),

  AUTO_DREAM_INTERVAL_MS: z.coerce.number().int().positive().optional(),
  AUTO_DREAM_MIN_ENTRIES: z.coerce.number().int().positive().optional(),

  KUZU_DB_PATH: z.string().optional(),

  HYBRID_BM25_WEIGHT: z.coerce.number().optional(),
  HYBRID_VECTOR_WEIGHT: z.coerce.number().optional(),
});

export type AppEnv = z.infer<typeof EnvSchema>;

let cached: AppEnv | undefined;

export function loadEnv(opts: { path?: string; force?: boolean } = {}): AppEnv {
  if (cached && !opts.force) return cached;

  const candidate = opts.path ?? resolve(process.cwd(), '.env');
  if (existsSync(candidate)) {
    loadDotenv({ path: candidate, override: opts.force === true });
  }

  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  • ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export function resetEnvCache(): void {
  cached = undefined;
}
