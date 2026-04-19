/**
 * Stagehand (https://github.com/browserbase/stagehand) integration.
 *
 * Stagehand extends Playwright with three natural-language primitives — `act`,
 * `extract`, and `observe` — so the agent can script a browser with
 * instructions instead of selectors. We load the package dynamically so the
 * build never requires `@browserbasehq/stagehand` to be installed. Tests
 * inject an in-memory `moduleLoader` instead of installing the real package.
 */

import { z } from 'zod';
import type { Tool, ToolContext, ToolResult } from '../../tools/registry.js';
import { loadEnv } from '../../config/env-loader.js';

export type StagehandAction = 'act' | 'extract' | 'observe' | 'navigate';

export interface StagehandInput {
  readonly action: StagehandAction;
  readonly url?: string;
  readonly instruction?: string;
  readonly schema?: Record<string, unknown>;
}

const StagehandSchema: z.ZodType<StagehandInput> = z.object({
  action: z.enum(['act', 'extract', 'observe', 'navigate']),
  url: z.string().url().optional(),
  instruction: z.string().min(1).optional(),
  schema: z.record(z.unknown()).optional(),
});

export interface StagehandPageLike {
  goto(url: string): Promise<unknown>;
}

export interface StagehandInstanceLike {
  init(): Promise<unknown>;
  close(): Promise<unknown>;
  page: StagehandPageLike;
  act(args: { action: string }): Promise<unknown>;
  extract<T>(args: { instruction: string; schema?: unknown }): Promise<T>;
  observe(args: { instruction: string }): Promise<unknown>;
}

export interface StagehandModuleLike {
  Stagehand: new (config: Record<string, unknown>) => StagehandInstanceLike;
}

export interface StagehandToolOptions {
  readonly moduleLoader?: () => Promise<StagehandModuleLike>;
  readonly config?: Record<string, unknown>;
}

export class StagehandTool implements Tool<StagehandInput> {
  readonly name = 'stagehand';
  readonly description =
    'Drive a browser with natural-language steps via Stagehand (Playwright + LLM). Actions: navigate (open URL), act (execute an instruction), extract (pull structured data), observe (list candidate actions).';
  readonly schema: z.ZodType<StagehandInput, z.ZodTypeDef, unknown> = StagehandSchema;
  readonly jsonSchema = {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['act', 'extract', 'observe', 'navigate'] },
      url: { type: 'string' },
      instruction: { type: 'string' },
      schema: { type: 'object', additionalProperties: true },
    },
    required: ['action'],
    additionalProperties: false,
  } as const;
  readonly dangerous = true;

  private instance: StagehandInstanceLike | null = null;
  private readonly moduleLoader: () => Promise<StagehandModuleLike>;
  private readonly config: Record<string, unknown>;

  constructor(options: StagehandToolOptions = {}) {
    this.moduleLoader =
      options.moduleLoader ??
      (async () => {
        const spec = '@browserbasehq/stagehand';
        return (await import(spec)) as unknown as StagehandModuleLike;
      });
    this.config = options.config ?? buildDefaultConfig();
  }

  async run(input: StagehandInput, _ctx: ToolContext): Promise<ToolResult> {
    try {
      const instance = await this.ensureInstance();
      switch (input.action) {
        case 'navigate': {
          if (!input.url) return { ok: false, output: '', error: 'url is required for navigate' };
          await instance.page.goto(input.url);
          return { ok: true, output: `navigated to ${input.url}` };
        }
        case 'act': {
          if (!input.instruction) return { ok: false, output: '', error: 'instruction is required for act' };
          const data = await instance.act({ action: input.instruction });
          return { ok: true, output: `acted: ${input.instruction}`, data };
        }
        case 'extract': {
          if (!input.instruction) return { ok: false, output: '', error: 'instruction is required for extract' };
          const data = await instance.extract({ instruction: input.instruction, schema: input.schema });
          return { ok: true, output: safeStringify(data), data };
        }
        case 'observe': {
          if (!input.instruction) return { ok: false, output: '', error: 'instruction is required for observe' };
          const data = await instance.observe({ instruction: input.instruction });
          return { ok: true, output: safeStringify(data), data };
        }
      }
    } catch (err) {
      return { ok: false, output: '', error: err instanceof Error ? err.message : String(err) };
    }
  }

  async close(): Promise<void> {
    if (!this.instance) return;
    try {
      await this.instance.close();
    } finally {
      this.instance = null;
    }
  }

  private async ensureInstance(): Promise<StagehandInstanceLike> {
    if (this.instance) return this.instance;
    const mod = await this.moduleLoader();
    const instance = new mod.Stagehand(this.config);
    await instance.init();
    this.instance = instance;
    return instance;
  }
}

function buildDefaultConfig(): Record<string, unknown> {
  const env = loadEnv();
  const cfg: Record<string, unknown> = {
    env: env.BROWSERBASE_API_KEY ? 'BROWSERBASE' : 'LOCAL',
    headless: env.BROWSER_HEADLESS,
  };
  if (env.BROWSERBASE_API_KEY) cfg.apiKey = env.BROWSERBASE_API_KEY;
  if (env.BROWSERBASE_PROJECT_ID) cfg.projectId = env.BROWSERBASE_PROJECT_ID;
  if (env.STAGEHAND_MODEL_NAME) cfg.modelName = env.STAGEHAND_MODEL_NAME;
  return cfg;
}

function safeStringify(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
