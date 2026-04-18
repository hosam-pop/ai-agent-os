import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

const EnvSchema = z.object({
  DOGE_PROVIDER: z.enum(['anthropic', 'openai', 'custom']).default('anthropic'),
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
    loadDotenv({ path: candidate, override: false });
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
