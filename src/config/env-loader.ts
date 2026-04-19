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
