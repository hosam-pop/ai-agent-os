import { z } from 'zod';
import type { Tool, ToolContext, ToolResult } from '../../tools/registry.js';
import type { MCPClient } from '../mcp/mcp-client.js';

/**
 * Thin wrappers that expose the canonical MCP social-platform tools
 * (from {@link https://github.com/isteamhq/mcp-servers isteamhq/mcp-servers}
 * and friends) as first-class Tools with well-typed inputs. Each wrapper
 * forwards to the shared {@link MCPClient} by remote tool name, so the
 * actual implementations live on the MCP side.
 */

export interface MCPProxyOptions {
  client: MCPClient;
  remoteToolName: string;
}

class MCPProxyTool<I extends Record<string, unknown>> implements Tool<I> {
  readonly name: string;
  readonly description: string;
  readonly schema: z.ZodType<I, z.ZodTypeDef, unknown>;
  readonly jsonSchema: Record<string, unknown>;
  readonly dangerous: boolean;

  constructor(
    def: {
      name: string;
      description: string;
      schema: z.ZodType<I, z.ZodTypeDef, unknown>;
      jsonSchema: Record<string, unknown>;
      dangerous?: boolean;
    },
    private readonly opts: MCPProxyOptions,
  ) {
    this.name = def.name;
    this.description = def.description;
    this.schema = def.schema;
    this.jsonSchema = def.jsonSchema;
    this.dangerous = def.dangerous ?? true;
  }

  async run(input: I, _ctx: ToolContext): Promise<ToolResult> {
    const result = await this.opts.client.callTool(
      this.opts.remoteToolName,
      input as Record<string, unknown>,
    );
    return {
      ok: result.ok,
      output: result.output,
      error: result.isError ? 'remote MCP tool returned an error' : undefined,
      data: result.data,
    };
  }
}

const TwitterPostSchema = z.object({
  text: z.string().min(1).max(4000),
  replyTo: z.string().optional(),
  mediaUrls: z.array(z.string().url()).optional(),
});
type TwitterPostInput = z.infer<typeof TwitterPostSchema>;

export function twitterPostTool(client: MCPClient, remoteToolName = 'twitter_post'): Tool<TwitterPostInput> {
  return new MCPProxyTool<TwitterPostInput>(
    {
      name: 'twitter_post',
      description: 'Publish a tweet (via MCP). Body max 4000 chars, optional reply target and media URLs.',
      schema: TwitterPostSchema,
      jsonSchema: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          replyTo: { type: 'string' },
          mediaUrls: { type: 'array', items: { type: 'string' } },
        },
        required: ['text'],
        additionalProperties: false,
      },
      dangerous: true,
    },
    { client, remoteToolName },
  );
}

const TwitterSearchSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().positive().max(100).optional(),
});
type TwitterSearchInput = z.infer<typeof TwitterSearchSchema>;

export function twitterSearchTool(
  client: MCPClient,
  remoteToolName = 'twitter_search',
): Tool<TwitterSearchInput> {
  return new MCPProxyTool<TwitterSearchInput>(
    {
      name: 'twitter_search',
      description: 'Search recent tweets (via MCP).',
      schema: TwitterSearchSchema,
      jsonSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          limit: { type: 'number' },
        },
        required: ['query'],
        additionalProperties: false,
      },
      dangerous: false,
    },
    { client, remoteToolName },
  );
}

const LinkedInPostSchema = z.object({
  text: z.string().min(1).max(3000),
  visibility: z.enum(['public', 'connections']).optional(),
});
type LinkedInPostInput = z.infer<typeof LinkedInPostSchema>;

export function linkedinPostTool(
  client: MCPClient,
  remoteToolName = 'linkedin_post',
): Tool<LinkedInPostInput> {
  return new MCPProxyTool<LinkedInPostInput>(
    {
      name: 'linkedin_post',
      description: 'Publish a LinkedIn post (via MCP).',
      schema: LinkedInPostSchema,
      jsonSchema: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          visibility: { type: 'string', enum: ['public', 'connections'] },
        },
        required: ['text'],
        additionalProperties: false,
      },
      dangerous: true,
    },
    { client, remoteToolName },
  );
}

const SlackSendSchema = z.object({
  channel: z.string().min(1),
  text: z.string().min(1),
  threadTs: z.string().optional(),
});
type SlackSendInput = z.infer<typeof SlackSendSchema>;

export function slackSendTool(
  client: MCPClient,
  remoteToolName = 'slack_send',
): Tool<SlackSendInput> {
  return new MCPProxyTool<SlackSendInput>(
    {
      name: 'slack_send',
      description: 'Send a Slack message to a channel or thread (via MCP).',
      schema: SlackSendSchema,
      jsonSchema: {
        type: 'object',
        properties: {
          channel: { type: 'string' },
          text: { type: 'string' },
          threadTs: { type: 'string' },
        },
        required: ['channel', 'text'],
        additionalProperties: false,
      },
      dangerous: true,
    },
    { client, remoteToolName },
  );
}

const CalendarCreateSchema = z.object({
  title: z.string().min(1),
  start: z.string().min(1),
  end: z.string().min(1),
  attendees: z.array(z.string().email()).optional(),
  description: z.string().optional(),
});
type CalendarCreateInput = z.infer<typeof CalendarCreateSchema>;

export function calendarCreateTool(
  client: MCPClient,
  remoteToolName = 'calendar_create',
): Tool<CalendarCreateInput> {
  return new MCPProxyTool<CalendarCreateInput>(
    {
      name: 'calendar_create',
      description: 'Create a calendar event (via MCP). ISO-8601 timestamps.',
      schema: CalendarCreateSchema,
      jsonSchema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          start: { type: 'string', description: 'ISO-8601 start' },
          end: { type: 'string', description: 'ISO-8601 end' },
          attendees: { type: 'array', items: { type: 'string' } },
          description: { type: 'string' },
        },
        required: ['title', 'start', 'end'],
        additionalProperties: false,
      },
      dangerous: true,
    },
    { client, remoteToolName },
  );
}

export function buildSocialTools(client: MCPClient): Array<Tool<Record<string, unknown>>> {
  return [
    twitterPostTool(client),
    twitterSearchTool(client),
    linkedinPostTool(client),
    slackSendTool(client),
    calendarCreateTool(client),
  ] as unknown as Array<Tool<Record<string, unknown>>>;
}
