import Anthropic from '@anthropic-ai/sdk';
import type {
  AIProvider,
  ChatMessage,
  CompletionRequest,
  CompletionResponse,
  ContentPart,
} from './provider-interface.js';

interface AnthropicProviderOptions {
  apiKey: string;
  baseURL?: string;
}

export class AnthropicProvider implements AIProvider {
  readonly name = 'anthropic';
  private readonly client: Anthropic;

  constructor(opts: AnthropicProviderOptions) {
    this.client = new Anthropic({ apiKey: opts.apiKey, baseURL: opts.baseURL });
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const messages = req.messages
      .filter((m) => m.role !== 'system')
      .map((m) => this.convertMessage(m));

    const joinedSystem = req.messages
      .filter((m) => m.role === 'system')
      .map((m) => (typeof m.content === 'string' ? m.content : this.flattenText(m.content)))
      .join('\n\n');
    const systemText = req.system ?? (joinedSystem.length > 0 ? joinedSystem : undefined);

    // Apply Prompt Caching for Anthropic if the system prompt is available.
    const systemParam: Anthropic.MessageCreateParams['system'] = systemText 
      ? [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }]
      : undefined;

    const response = await this.client.messages.create({
      model: req.model,
      max_tokens: req.maxTokens ?? 4096,
      temperature: req.temperature,
      stop_sequences: req.stopSequences,
      system: systemParam,
      messages,
      tools: req.tools?.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema as Anthropic.Tool.InputSchema,
      })),
    }, {
      headers: { 'anthropic-beta': 'prompt-caching-2024-07-31' }
    });

    const content: ContentPart[] = response.content.map((block) => {
      if (block.type === 'text') {
        return { type: 'text', text: block.text };
      }
      if (block.type === 'tool_use') {
        return {
          type: 'tool_use',
          id: block.id,
          name: block.name,
          input: (block.input as Record<string, unknown>) ?? {},
        };
      }
      return { type: 'text', text: '' };
    });

    const stopReason: CompletionResponse['stopReason'] =
      response.stop_reason === 'tool_use'
        ? 'tool_use'
        : response.stop_reason === 'max_tokens'
          ? 'max_tokens'
          : response.stop_reason === 'stop_sequence'
            ? 'stop_sequence'
            : response.stop_reason === 'end_turn'
              ? 'end_turn'
              : 'end_turn';

    return {
      id: response.id,
      model: response.model,
      stopReason,
      content,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
      raw: response,
    };
  }

  private convertMessage(m: ChatMessage): Anthropic.MessageParam {
    if (m.role === 'tool') {
      // Tool results are folded into user messages as tool_result blocks.
      const parts = typeof m.content === 'string' ? [] : m.content;
      return {
        role: 'user',
        content: parts.map((p) => {
          if (p.type === 'tool_result') {
            return {
              type: 'tool_result' as const,
              tool_use_id: p.tool_use_id,
              content: p.content,
              is_error: p.is_error,
            };
          }
          return { type: 'text' as const, text: this.flattenText([p]) };
        }),
      };
    }

    if (typeof m.content === 'string') {
      return {
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      };
    }

    const blocks = m.content.map((p): Anthropic.TextBlockParam | Anthropic.ToolUseBlockParam | Anthropic.ToolResultBlockParam => {
      if (p.type === 'text') return { type: 'text', text: p.text };
      if (p.type === 'tool_use') {
        return { type: 'tool_use', id: p.id, name: p.name, input: p.input };
      }
      return { type: 'tool_result', tool_use_id: p.tool_use_id, content: p.content, is_error: p.is_error };
    });

    return {
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: blocks,
    };
  }

  private flattenText(parts: ContentPart[]): string {
    return parts
      .map((p) => {
        if (p.type === 'text') return p.text;
        if (p.type === 'tool_result') return p.content;
        if (p.type === 'tool_use') return `[tool_use:${p.name}]`;
        return '';
      })
      .join('\n');
  }
}
