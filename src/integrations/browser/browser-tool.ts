import { z } from 'zod';
import type { Browser, BrowserContext, Page } from 'playwright';
import type { Tool, ToolContext, ToolResult } from '../../tools/registry.js';
import { loadEnv } from '../../config/env-loader.js';
import { logger } from '../../utils/logger.js';

/**
 * Playwright-powered browser automation tool.
 *
 * Equivalent in spirit to the Python {@link https://github.com/browser-use/browser-use
 * browser-use} project: the agent can drive a real browser to navigate the web,
 * click elements, type into form fields, extract page content, and capture
 * screenshots. The entire implementation is native TypeScript, so no Python
 * runtime is required at the target machine.
 *
 * The browser instance is lazily launched on first use and reused between
 * actions through a single {@link BrowserSession}. Callers should invoke
 * {@link shutdownBrowser} during graceful shutdown (handled by `setup.ts`).
 */

export type BrowserAction =
  | 'navigate'
  | 'click'
  | 'type'
  | 'extract'
  | 'screenshot'
  | 'evaluate'
  | 'wait_for'
  | 'close';

export interface BrowserInput {
  action: BrowserAction;
  url?: string;
  selector?: string;
  text?: string;
  script?: string;
  fullPage?: boolean;
  timeoutMs?: number;
  clear?: boolean;
  attribute?: string;
  waitFor?: 'load' | 'domcontentloaded' | 'networkidle';
}

const BrowserSchema: z.ZodType<BrowserInput> = z.object({
  action: z.enum(['navigate', 'click', 'type', 'extract', 'screenshot', 'evaluate', 'wait_for', 'close']),
  url: z.string().url().optional(),
  selector: z.string().min(1).optional(),
  text: z.string().optional(),
  script: z.string().optional(),
  fullPage: z.boolean().optional(),
  timeoutMs: z.number().int().positive().optional(),
  clear: z.boolean().optional(),
  attribute: z.string().optional(),
  waitFor: z.enum(['load', 'domcontentloaded', 'networkidle']).optional(),
});

interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

let session: BrowserSession | null = null;

async function ensureSession(): Promise<BrowserSession> {
  if (session) return session;
  const env = loadEnv();
  const playwright = await import('playwright');
  const browser = await playwright.chromium.launch({
    headless: env.BROWSER_HEADLESS,
    executablePath: env.BROWSER_EXECUTABLE_PATH || undefined,
  });
  const context = await browser.newContext();
  context.setDefaultTimeout(env.BROWSER_TIMEOUT_MS);
  const page = await context.newPage();
  session = { browser, context, page };
  logger.info('browser.session.launched', {
    headless: env.BROWSER_HEADLESS,
    timeoutMs: env.BROWSER_TIMEOUT_MS,
  });
  return session;
}

export async function shutdownBrowser(): Promise<void> {
  if (!session) return;
  const s = session;
  session = null;
  try {
    await s.context.close();
    await s.browser.close();
    logger.info('browser.session.closed');
  } catch (err) {
    logger.warn('browser.session.close-error', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export class BrowserTool implements Tool<BrowserInput> {
  readonly name = 'browser';
  readonly description =
    'Drive a real browser: navigate, click, type, extract text/HTML, evaluate JS, screenshot, wait_for, close.';
  readonly schema: z.ZodType<BrowserInput, z.ZodTypeDef, unknown> = BrowserSchema;
  readonly jsonSchema = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['navigate', 'click', 'type', 'extract', 'screenshot', 'evaluate', 'wait_for', 'close'],
      },
      url: { type: 'string', description: 'URL for navigate' },
      selector: { type: 'string', description: 'CSS selector for click/type/extract/wait_for' },
      text: { type: 'string', description: 'Text to type for `type`' },
      script: { type: 'string', description: 'JS expression for `evaluate` (runs in page context)' },
      fullPage: { type: 'boolean', description: 'If true, screenshot captures full scroll height' },
      timeoutMs: { type: 'number', description: 'Action timeout in ms (default 30000)' },
      clear: { type: 'boolean', description: 'For `type`, clear existing text first' },
      attribute: {
        type: 'string',
        description: 'For `extract`, return a specific attribute instead of text',
      },
      waitFor: {
        type: 'string',
        enum: ['load', 'domcontentloaded', 'networkidle'],
        description: 'Wait state for navigate',
      },
    },
    required: ['action'],
    additionalProperties: false,
  } as const;
  readonly dangerous = false;

  async run(input: BrowserInput, _ctx: ToolContext): Promise<ToolResult> {
    try {
      if (input.action === 'close') {
        await shutdownBrowser();
        return { ok: true, output: 'browser closed' };
      }
      const s = await ensureSession();
      const timeout = input.timeoutMs;
      switch (input.action) {
        case 'navigate': {
          if (!input.url) throw new Error('url is required for navigate');
          const response = await s.page.goto(input.url, {
            waitUntil: input.waitFor ?? 'domcontentloaded',
            timeout,
          });
          return {
            ok: true,
            output: `navigated to ${input.url} (status=${response?.status() ?? 'n/a'})`,
            data: { url: s.page.url(), status: response?.status() ?? null },
          };
        }
        case 'click': {
          if (!input.selector) throw new Error('selector is required for click');
          await s.page.click(input.selector, { timeout });
          return { ok: true, output: `clicked ${input.selector}` };
        }
        case 'type': {
          if (!input.selector) throw new Error('selector is required for type');
          if (input.text === undefined) throw new Error('text is required for type');
          if (input.clear) await s.page.fill(input.selector, '', { timeout });
          await s.page.type(input.selector, input.text, { timeout });
          return { ok: true, output: `typed ${input.text.length} chars into ${input.selector}` };
        }
        case 'extract': {
          if (!input.selector) {
            const html = await s.page.content();
            return { ok: true, output: html.slice(0, 200_000), data: { bytes: html.length } };
          }
          if (input.attribute) {
            const value = await s.page.getAttribute(input.selector, input.attribute, { timeout });
            return { ok: true, output: value ?? '', data: { attribute: input.attribute } };
          }
          const text = await s.page.textContent(input.selector, { timeout });
          return { ok: true, output: text ?? '', data: { selector: input.selector } };
        }
        case 'screenshot': {
          const buffer = await s.page.screenshot({ fullPage: input.fullPage ?? false, timeout });
          const base64 = buffer.toString('base64');
          return {
            ok: true,
            output: `screenshot bytes=${buffer.length}`,
            data: { base64, bytes: buffer.length, url: s.page.url() },
          };
        }
        case 'evaluate': {
          if (!input.script) throw new Error('script is required for evaluate');
          const value = await s.page.evaluate(input.script);
          return {
            ok: true,
            output: typeof value === 'string' ? value : JSON.stringify(value),
            data: { raw: value },
          };
        }
        case 'wait_for': {
          if (!input.selector) throw new Error('selector is required for wait_for');
          await s.page.waitForSelector(input.selector, { timeout });
          return { ok: true, output: `selector ${input.selector} ready` };
        }
        default: {
          const exhaustive: never = input.action;
          throw new Error(`unknown browser action: ${String(exhaustive)}`);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn('browser.action.error', { action: input.action, error: message });
      return { ok: false, output: '', error: message };
    }
  }
}
