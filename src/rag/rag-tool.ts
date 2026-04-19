/**
 * Agent-facing `rag` tool. Wraps {@link LlamaIndexEngine} with index-,
 * query-, and answer-oriented actions. One LlamaIndex engine instance is
 * kept per tool lifetime, so indexes persist between calls for the lifetime
 * of the agent process.
 */

import { z } from 'zod';
import type { Tool, ToolContext, ToolResult } from '../tools/registry.js';
import { LlamaIndexEngine, type RagDocument } from './llamaindex-engine.js';

export type RagAction = 'index' | 'query' | 'answer';

export interface RagInput {
  readonly action: RagAction;
  readonly indexName: string;
  readonly documents?: readonly RagDocument[];
  readonly question?: string;
  readonly topK?: number;
}

const RagDocumentSchema: z.ZodType<RagDocument> = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  metadata: z.record(z.unknown()).optional(),
});

const RagSchema: z.ZodType<RagInput> = z.object({
  action: z.enum(['index', 'query', 'answer']),
  indexName: z.string().min(1),
  documents: z.array(RagDocumentSchema).optional(),
  question: z.string().min(1).optional(),
  topK: z.number().int().positive().max(50).optional(),
});

export class RagTool implements Tool<RagInput> {
  readonly name = 'rag';
  readonly description =
    'Build a LlamaIndex-backed retrieval-augmented index and query it. Actions: index (add documents), query (return top-K chunks), answer (synthesise an answer).';
  readonly schema: z.ZodType<RagInput, z.ZodTypeDef, unknown> = RagSchema;
  readonly jsonSchema = {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['index', 'query', 'answer'] },
      indexName: { type: 'string' },
      documents: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            text: { type: 'string' },
            metadata: { type: 'object', additionalProperties: true },
          },
          required: ['id', 'text'],
        },
      },
      question: { type: 'string' },
      topK: { type: 'number' },
    },
    required: ['action', 'indexName'],
    additionalProperties: false,
  } as const;
  readonly dangerous = false;

  constructor(private readonly engine: LlamaIndexEngine = new LlamaIndexEngine()) {}

  async run(input: RagInput, _ctx: ToolContext): Promise<ToolResult> {
    switch (input.action) {
      case 'index': {
        const docs = input.documents ?? [];
        const res = await this.engine.indexDocuments(input.indexName, docs);
        return res.ok
          ? { ok: true, output: `indexed ${res.indexed} document(s) into "${input.indexName}"`, data: res }
          : { ok: false, output: '', error: res.error };
      }
      case 'query': {
        if (!input.question) return { ok: false, output: '', error: 'question is required for query' };
        const res = await this.engine.query(input.indexName, input.question, input.topK);
        if (!res.ok) return { ok: false, output: '', error: res.error };
        return {
          ok: true,
          output:
            res.chunks.length === 0
              ? '(no relevant chunks)'
              : res.chunks.map((c, i) => `${i + 1}. [${c.score.toFixed(3)}] ${c.text.slice(0, 200)}`).join('\n'),
          data: res,
        };
      }
      case 'answer': {
        if (!input.question) return { ok: false, output: '', error: 'question is required for answer' };
        const res = await this.engine.answer(input.indexName, input.question);
        if (!res.ok) return { ok: false, output: '', error: res.error };
        return {
          ok: true,
          output: res.answer || '(empty answer)',
          data: res,
        };
      }
    }
  }
}
