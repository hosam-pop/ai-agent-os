/**
 * Unified AI provider interface.
 *
 * Abstracts over Anthropic / OpenAI / custom OpenAI-compatible endpoints so
 * the rest of the system is provider-agnostic. This is the "API Abstraction
 * Layer" spec'd in the integration plan, drawing from both Claude-Code's
 * pluggable provider model and doge-code's early custom-provider support.
 */

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface TextPart {
  type: 'text';
  text: string;
}

export interface ToolUsePart {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultPart {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export type ContentPart = TextPart | ToolUsePart | ToolResultPart;

export interface ChatMessage {
  role: ChatRole;
  content: string | ContentPart[];
}

export interface ToolSchema {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface CompletionRequest {
  model: string;
  system?: string;
  messages: ChatMessage[];
  tools?: ToolSchema[];
  maxTokens?: number;
  temperature?: number;
  stopSequences?: string[];
}

export interface CompletionUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface CompletionResponse {
  id: string;
  model: string;
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | 'error';
  content: ContentPart[];
  usage: CompletionUsage;
  raw?: unknown;
}

export interface AIProvider {
  readonly name: string;
  complete(req: CompletionRequest): Promise<CompletionResponse>;
}
