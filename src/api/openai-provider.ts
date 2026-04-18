import OpenAI from 'openai';
import type {
  AIProvider,
  ChatMessage,
  CompletionRequest,
  CompletionResponse,
  ContentPart,
  ToolUsePart,
} from './provider-interface.js';

interface OpenAIProviderOptions {
  apiKey: string;
  baseURL?: string;
  label?: string;
}

export class OpenAIProvider implements AIProvider {
  readonly name: string;
  private readonly client: OpenAI;

  constructor(opts: OpenAIProviderOptions) {
    this.name = opts.label ?? 'openai';
    this.client = new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseURL });
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const messages = this.convertMessages(req);

    const tools: OpenAI.Chat.ChatCompletionTool[] | undefined = req.tools?.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema as Record<string, unknown>,
      },
    }));

    const response = await this.client.chat.completions.create({
      model: req.model,
      messages,
      tools,
      max_tokens: req.maxTokens,
      temperature: req.temperature,
      stop: req.stopSequences,
    });

    const choice = response.choices[0];
    const msg = choice?.message;
    const content: ContentPart[] = [];
    if (msg?.content) content.push({ type: 'text', text: msg.content });
    for (const call of msg?.tool_calls ?? []) {
      if (call.type !== 'function') continue;
      let parsedInput: Record<string, unknown> = {};
      try {
        parsedInput = call.function.arguments ? JSON.parse(call.function.arguments) : {};
      } catch {
        parsedInput = { _raw: call.function.arguments };
      }
      const part: ToolUsePart = {
        type: 'tool_use',
        id: call.id,
        name: call.function.name,
        input: parsedInput,
      };
      content.push(part);
    }

    const stopReason: CompletionResponse['stopReason'] =
      choice?.finish_reason === 'tool_calls'
        ? 'tool_use'
        : choice?.finish_reason === 'length'
          ? 'max_tokens'
          : choice?.finish_reason === 'stop'
            ? 'end_turn'
            : 'end_turn';

    return {
      id: response.id,
      model: response.model,
      stopReason,
      content,
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
      },
      raw: response,
    };
  }

  private convertMessages(req: CompletionRequest): OpenAI.Chat.ChatCompletionMessageParam[] {
    const out: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    if (req.system) out.push({ role: 'system', content: req.system });
    for (const m of req.messages) {
      out.push(...this.convertOne(m));
    }
    return out;
  }

  private convertOne(m: ChatMessage): OpenAI.Chat.ChatCompletionMessageParam[] {
    if (m.role === 'system') {
      const text = typeof m.content === 'string' ? m.content : this.flattenText(m.content);
      return [{ role: 'system', content: text }];
    }

    if (m.role === 'tool') {
      const parts = typeof m.content === 'string' ? [] : m.content;
      return parts
        .filter((p): p is Extract<ContentPart, { type: 'tool_result' }> => p.type === 'tool_result')
        .map((p) => ({
          role: 'tool' as const,
          tool_call_id: p.tool_use_id,
          content: p.content,
        }));
    }

    if (typeof m.content === 'string') {
      return [{ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }];
    }

    // For assistant turns, split into a message with text + tool_calls.
    if (m.role === 'assistant') {
      const text = this.flattenText(m.content.filter((p) => p.type === 'text'));
      const toolCalls = m.content
        .filter((p): p is ToolUsePart => p.type === 'tool_use')
        .map((p) => ({
          id: p.id,
          type: 'function' as const,
          function: { name: p.name, arguments: JSON.stringify(p.input ?? {}) },
        }));
      const assistantMsg: OpenAI.Chat.ChatCompletionAssistantMessageParam = {
        role: 'assistant',
        content: text || null,
      };
      if (toolCalls.length > 0) assistantMsg.tool_calls = toolCalls;
      return [assistantMsg];
    }

    return [{ role: 'user', content: this.flattenText(m.content) }];
  }

  private flattenText(parts: ContentPart[]): string {
    return parts
      .map((p) => {
        if (p.type === 'text') return p.text;
        if (p.type === 'tool_result') return p.content;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
}
