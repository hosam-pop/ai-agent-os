import { z } from 'zod';
import type { Tool, ToolContext, ToolResult } from '../../tools/registry.js';
import type { Mem0Adapter } from './mem0-memory.js';

/**
 * Expose the mem0-backed memory to the agent as a first-class tool.
 *
 * Actions:
 *   - `remember`: store a fact keyed by the configured user
 *   - `recall`:   semantic search
 *   - `list`:     chronological list
 *   - `forget`:   delete by id
 */

export type Mem0Action = 'remember' | 'recall' | 'list' | 'forget';

export interface Mem0Input {
  action: Mem0Action;
  text?: string;
  query?: string;
  id?: string;
  limit?: number;
  tags?: string[];
}

const Mem0Schema: z.ZodType<Mem0Input> = z.object({
  action: z.enum(['remember', 'recall', 'list', 'forget']),
  text: z.string().min(1).optional(),
  query: z.string().min(1).optional(),
  id: z.string().min(1).optional(),
  limit: z.number().int().positive().max(500).optional(),
  tags: z.array(z.string()).optional(),
});

export class Mem0Tool implements Tool<Mem0Input> {
  readonly name = 'memory';
  readonly description =
    'Long-term semantic memory (mem0 or local fallback): remember, recall, list, forget.';
  readonly schema: z.ZodType<Mem0Input, z.ZodTypeDef, unknown> = Mem0Schema;
  readonly jsonSchema = {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['remember', 'recall', 'list', 'forget'] },
      text: { type: 'string', description: 'Text to remember (required for `remember`)' },
      query: { type: 'string', description: 'Search query (required for `recall`)' },
      id: { type: 'string', description: 'Record id (required for `forget`)' },
      limit: { type: 'number', description: 'Result limit for recall/list (default 10/50)' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags for remember' },
    },
    required: ['action'],
    additionalProperties: false,
  } as const;
  readonly dangerous = false;

  constructor(private readonly memory: Mem0Adapter) {}

  async run(input: Mem0Input, _ctx: ToolContext): Promise<ToolResult> {
    switch (input.action) {
      case 'remember': {
        if (!input.text) return { ok: false, output: '', error: 'text is required for remember' };
        const record = await this.memory.add(input.text, { tags: input.tags });
        return { ok: true, output: `remembered as ${record.id}`, data: record };
      }
      case 'recall': {
        if (!input.query) return { ok: false, output: '', error: 'query is required for recall' };
        const hits = await this.memory.search(input.query, input.limit ?? 10);
        return {
          ok: true,
          output: hits.length
            ? hits.map((h) => `- [${h.id}] ${h.text.slice(0, 200)}`).join('\n')
            : '(no matches)',
          data: { backend: this.memory.backend, hits },
        };
      }
      case 'list': {
        const records = await this.memory.list(input.limit ?? 50);
        return {
          ok: true,
          output: records.length
            ? records.map((r) => `- [${r.id}] ${r.text.slice(0, 160)}`).join('\n')
            : '(empty)',
          data: { backend: this.memory.backend, records },
        };
      }
      case 'forget': {
        if (!input.id) return { ok: false, output: '', error: 'id is required for forget' };
        const ok = await this.memory.delete(input.id);
        return ok
          ? { ok: true, output: `forgot ${input.id}` }
          : { ok: false, output: '', error: `delete is not supported or failed (${this.memory.backend})` };
      }
      default: {
        const exhaustive: never = input.action;
        return { ok: false, output: '', error: `unknown memory action: ${String(exhaustive)}` };
      }
    }
  }
}
