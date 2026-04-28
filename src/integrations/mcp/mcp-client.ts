import { loadEnv } from '../../config/env-loader.js';
import { logger } from '../../utils/logger.js';

/**
 * Generic {@link https://modelcontextprotocol.io Model Context Protocol}
 * client that can speak to any MCP server — Dicklesworthstone's
 * `ultimate_mcp_server`, `isteamhq/mcp-servers`, `0nork/0nMCP`, etc. The
 * server is selected through environment configuration so one unified
 * {@link MCPTool} covers all three upstream projects.
 *
 * Two transports are supported:
 *   - `stdio`: launch a child process via `MCP_SERVER_STDIO` (e.g. `"uvx
 *              ultimate-mcp-server --stdio"`).
 *   - `http`/streamable: connect to `MCP_SERVER_URL` using the SDK's
 *              `StreamableHTTPClientTransport`.
 *
 * `@modelcontextprotocol/sdk` is imported dynamically so builds succeed even
 * when the optional dependency is absent at runtime.
 */

export interface MCPToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface MCPCallResult {
  ok: boolean;
  output: string;
  data?: unknown;
  isError?: boolean;
}

interface SdkClient {
  connect(transport: unknown): Promise<void>;
  listTools(): Promise<{ tools: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }> }>;
  callTool(request: { name: string; arguments?: Record<string, unknown> }): Promise<{
    isError?: boolean;
    content?: Array<{ type: string; text?: string }>;
  }>;
  close?(): Promise<void>;
}

interface SdkModuleShape {
  Client: new (info: { name: string; version: string }) => SdkClient;
}

interface StdioModuleShape {
  StdioClientTransport: new (init: {
    command: string;
    args?: string[];
    env?: Record<string, string>;
  }) => unknown;
}

interface StreamableModuleShape {
  StreamableHTTPClientTransport: new (
    url: URL,
    init?: { requestInit?: RequestInit },
  ) => unknown;
}

export class MCPClient {
  private client: SdkClient | null = null;
  private tools: MCPToolDescriptor[] = [];
  private readonly transport: 'stdio' | 'http';
  private readonly target: string;
  private readonly token?: string;

  constructor(options: { url?: string; stdio?: string; token?: string } = {}) {
    const env = loadEnv();
    const url = options.url ?? env.MCP_SERVER_URL;
    const stdio = options.stdio ?? env.MCP_SERVER_STDIO;
    this.token = options.token ?? env.MCP_SERVER_TOKEN;
    if (stdio) {
      this.transport = 'stdio';
      this.target = stdio;
    } else if (url) {
      this.transport = 'http';
      this.target = url;
    } else {
      throw new Error('MCPClient requires MCP_SERVER_URL or MCP_SERVER_STDIO');
    }
  }

  async connect(): Promise<void> {
    if (this.client) return;
    const sdkMod = (await import('@modelcontextprotocol/sdk/client/index.js')) as unknown as SdkModuleShape;
    const client = new sdkMod.Client({ name: 'ai-agent-os', version: '1.1.0' });
    const transport = await this.buildTransport();
    await client.connect(transport);
    this.client = client;
    const tools = await client.listTools();
    this.tools = tools.tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
    logger.info('mcp.connect', { transport: this.transport, tools: this.tools.length });
  }

  async listTools(): Promise<MCPToolDescriptor[]> {
    if (!this.client) await this.connect();
    return this.tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<MCPCallResult> {
    if (!this.client) await this.connect();
    if (!this.client) return { ok: false, output: '', isError: true };
    try {
      const result = await this.client.callTool({ name, arguments: args });
      const parts = result.content ?? [];
      const text = parts
        .map((p) => (p.type === 'text' && p.text ? p.text : JSON.stringify(p)))
        .join('\n');
      return {
        ok: !result.isError,
        output: text,
        data: result,
        isError: result.isError === true,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn('mcp.call.error', { name, error: message });
      return { ok: false, output: '', data: null, isError: true };
    }
  }

  async close(): Promise<void> {
    if (!this.client) return;
    try {
      if (this.client.close) await this.client.close();
    } catch (err) {
      logger.warn('mcp.close.error', { error: err instanceof Error ? err.message : String(err) });
    } finally {
      this.client = null;
    }
  }

  private async buildTransport(): Promise<unknown> {
    if (this.transport === 'stdio') {
      const stdioMod = (await import(
        '@modelcontextprotocol/sdk/client/stdio.js'
      )) as unknown as StdioModuleShape;
      const [command, ...args] = parseCommand(this.target);
      if (!command) throw new Error('MCP_SERVER_STDIO command is empty');
      return new stdioMod.StdioClientTransport({ command, args });
    }
    const streamableMod = (await import(
      '@modelcontextprotocol/sdk/client/streamableHttp.js'
    )) as unknown as StreamableModuleShape;
    const headers: Record<string, string> = {};
    if (this.token) headers['authorization'] = `Bearer ${this.token}`;
    return new streamableMod.StreamableHTTPClientTransport(new URL(this.target), {
      requestInit: { headers },
    });
  }
}

function parseCommand(cmd: string): string[] {
  const out: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  for (const ch of cmd) {
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        out.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }
  if (current) out.push(current);
  return out;
}
