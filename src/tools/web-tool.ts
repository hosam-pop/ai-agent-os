import { z } from 'zod';
import { jsonSchemaObject, type Tool, type ToolContext, type ToolResult } from './registry.js';
import { PolicyEngine } from '../permissions/policy-engine.js';
import { logger } from '../utils/logger.js';

const Input = z.object({
  url: z.string().url(),
  method: z.enum(['GET', 'POST', 'HEAD']).default('GET'),
  headers: z.record(z.string()).optional(),
  body: z.string().optional(),
  timeoutMs: z.number().int().positive().max(60_000).default(15_000),
  maxBytes: z.number().int().positive().max(2_000_000).default(500_000),
});

export class WebTool implements Tool<z.infer<typeof Input>> {
  readonly name = 'web';
  readonly description = 'Fetch text content from a URL (subject to network policy).';
  readonly schema = Input;
  readonly jsonSchema = jsonSchemaObject(
    {
      url: { type: 'string', description: 'Absolute URL to fetch' },
      method: { type: 'string', enum: ['GET', 'POST', 'HEAD'], default: 'GET' },
      headers: { type: 'object', description: 'Request headers' },
      body: { type: 'string', description: 'Request body for POST' },
      timeoutMs: { type: 'number', default: 15000 },
      maxBytes: { type: 'number', default: 500000 },
    },
    ['url'],
  );

  constructor(private readonly policy: PolicyEngine) {}

  async run(input: z.infer<typeof Input>, _ctx: ToolContext): Promise<ToolResult> {
    const decision = this.policy.evaluate({
      toolName: this.name,
      argsSignature: `${input.method} ${input.url}`,
      rawArgs: input,
    });
    if (decision.action === 'deny') {
      return { ok: false, output: '', error: `Web request denied: ${decision.reason ?? 'policy'}` };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.timeoutMs);
    try {
      const res = await fetch(input.url, {
        method: input.method,
        headers: input.headers,
        body: input.method === 'POST' ? input.body : undefined,
        signal: controller.signal,
      });
      const reader = res.body?.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;
      if (reader) {
        while (received < input.maxBytes) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            chunks.push(value);
            received += value.byteLength;
          }
        }
      }
      const buf = Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength)));
      const text = buf.toString('utf8');
      const truncated = received >= input.maxBytes;
      return {
        ok: res.ok,
        output: `HTTP ${res.status} ${res.statusText}\n\n${text}${truncated ? '\n…[truncated]' : ''}`,
        error: res.ok ? undefined : `HTTP ${res.status}`,
        data: { status: res.status, truncated, bytes: received },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn('web.error', { url: input.url, error: message });
      return { ok: false, output: '', error: message };
    } finally {
      clearTimeout(timer);
    }
  }
}
