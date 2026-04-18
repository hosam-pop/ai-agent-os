import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
  appendFileSync,
  unlinkSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { jsonSchemaObject, type Tool, type ToolContext, type ToolResult } from './registry.js';
import { PolicyEngine } from '../permissions/policy-engine.js';
import { Sandbox } from './sandbox.js';

const Input = z.object({
  action: z.enum(['read', 'write', 'append', 'list', 'delete', 'exists']),
  path: z.string().min(1),
  content: z.string().optional(),
  encoding: z.enum(['utf8', 'base64']).default('utf8'),
  maxBytes: z.number().int().positive().max(2_000_000).optional(),
});

export class FileTool implements Tool<z.infer<typeof Input>> {
  readonly name = 'file';
  readonly description =
    'Read, write, append, list, delete, or check files in the workspace (sandboxed).';
  readonly schema = Input;
  readonly jsonSchema = jsonSchemaObject(
    {
      action: {
        type: 'string',
        enum: ['read', 'write', 'append', 'list', 'delete', 'exists'],
        description: 'Operation to perform',
      },
      path: { type: 'string', description: 'Path relative to the workspace root' },
      content: { type: 'string', description: 'Payload for write/append actions' },
      encoding: { type: 'string', enum: ['utf8', 'base64'], default: 'utf8' },
      maxBytes: { type: 'number', description: 'Max bytes to read (default 1MB)' },
    },
    ['action', 'path'],
  );

  constructor(
    private readonly policy: PolicyEngine,
    private readonly sandbox: Sandbox,
  ) {}

  async run(input: z.infer<typeof Input>, _ctx: ToolContext): Promise<ToolResult> {
    const decision = this.policy.evaluate({
      toolName: this.name,
      argsSignature: `${input.action}:${input.path}`,
      rawArgs: input,
    });
    if (decision.action === 'deny') {
      return { ok: false, output: '', error: `File op denied: ${decision.reason ?? 'policy'}` };
    }

    let full: string;
    try {
      full = this.sandbox.resolvePath(input.path);
    } catch (err) {
      return { ok: false, output: '', error: err instanceof Error ? err.message : String(err) };
    }

    switch (input.action) {
      case 'exists':
        return { ok: true, output: existsSync(full) ? 'true' : 'false', data: { exists: existsSync(full) } };
      case 'read': {
        if (!existsSync(full)) return { ok: false, output: '', error: 'File not found' };
        const stat = statSync(full);
        if (stat.isDirectory()) return { ok: false, output: '', error: 'Path is a directory' };
        const max = input.maxBytes ?? 1_000_000;
        const buf = readFileSync(full);
        const slice = buf.length > max ? buf.subarray(0, max) : buf;
        const text = input.encoding === 'base64' ? slice.toString('base64') : slice.toString('utf8');
        const truncated = buf.length > max;
        return { ok: true, output: text + (truncated ? '\n…[truncated]' : ''), data: { bytes: buf.length, truncated } };
      }
      case 'list': {
        if (!existsSync(full)) return { ok: false, output: '', error: 'Path not found' };
        const stat = statSync(full);
        if (!stat.isDirectory()) return { ok: false, output: '', error: 'Path is not a directory' };
        const entries = readdirSync(full, { withFileTypes: true }).map((e) => ({
          name: e.name,
          type: e.isDirectory() ? 'dir' : e.isFile() ? 'file' : 'other',
        }));
        return { ok: true, output: entries.map((e) => `${e.type === 'dir' ? '[D]' : '   '} ${e.name}`).join('\n'), data: entries };
      }
      case 'write': {
        if (input.content === undefined) return { ok: false, output: '', error: 'content required for write' };
        if (!existsSync(dirname(full))) mkdirSync(dirname(full), { recursive: true });
        const payload =
          input.encoding === 'base64' ? Buffer.from(input.content, 'base64') : Buffer.from(input.content, 'utf8');
        writeFileSync(full, payload);
        return { ok: true, output: `wrote ${payload.length} bytes to ${this.sandbox.relative(full)}` };
      }
      case 'append': {
        if (input.content === undefined) return { ok: false, output: '', error: 'content required for append' };
        if (!existsSync(dirname(full))) mkdirSync(dirname(full), { recursive: true });
        const payload =
          input.encoding === 'base64' ? Buffer.from(input.content, 'base64') : Buffer.from(input.content, 'utf8');
        appendFileSync(full, payload);
        return { ok: true, output: `appended ${payload.length} bytes to ${this.sandbox.relative(full)}` };
      }
      case 'delete': {
        if (!existsSync(full)) return { ok: false, output: '', error: 'File not found' };
        unlinkSync(full);
        return { ok: true, output: `deleted ${this.sandbox.relative(full)}` };
      }
    }
  }
}
