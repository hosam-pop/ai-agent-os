import { z } from 'zod';
import type { Tool, ToolContext, ToolResult } from '../../tools/registry.js';
import type { MCPClient } from './mcp-client.js';

/**
 * Thin bridge that exposes a configured {@link MCPClient} to the agent as a
 * single tool. One tool handles an arbitrary catalog of remote MCP tools —
 * Dicklesworthstone's `ultimate_mcp_server`, `isteamhq/mcp-servers`,
 * `0nork/0nMCP`, etc. — selected by name at call time.
 */

export type MCPAction = 'list' | 'call';

export interface MCPInput {
  action: MCPAction;
  toolName?: string;
  arguments?: Record<string, unknown>;
}

const MCPSchema: z.ZodType<MCPInput> = z.object({
  action: z.enum(['list', 'call']),
  toolName: z.string().min(1).optional(),
  arguments: z.record(z.unknown()).optional(),
});

export class MCPTool implements Tool<MCPInput> {
  readonly name = 'mcp';
  readonly description =
    'Interact with an MCP server. Actions: `list` (enumerate remote tools) or `call` (invoke a named tool with JSON arguments).';
  readonly schema: z.ZodType<MCPInput, z.ZodTypeDef, unknown> = MCPSchema;
  readonly jsonSchema = {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['list', 'call'] },
      toolName: { type: 'string', description: 'MCP tool name for `call`' },
      arguments: {
        type: 'object',
        description: 'Arguments passed verbatim to the remote MCP tool',
        additionalProperties: true,
      },
    },
    required: ['action'],
    additionalProperties: false,
  } as const;
  readonly dangerous = true;

  constructor(private readonly client: MCPClient) {}

  async run(input: MCPInput, _ctx: ToolContext): Promise<ToolResult> {
    try {
      if (input.action === 'list') {
        const tools = await this.client.listTools();
        if (tools.length === 0) return { ok: true, output: '(no tools advertised)', data: { tools } };
        return {
          ok: true,
          output: tools.map((t) => `- ${t.name}${t.description ? ' — ' + t.description : ''}`).join('\n'),
          data: { tools },
        };
      }
      if (!input.toolName) {
        return { ok: false, output: '', error: 'toolName is required for call' };
      }
      const result = await this.client.callTool(input.toolName, input.arguments ?? {});
      return {
        ok: result.ok,
        output: result.output,
        error: result.isError ? 'remote tool returned an error' : undefined,
        data: result.data,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, output: '', error: message };
    }
  }
}
