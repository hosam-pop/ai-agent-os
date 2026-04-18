import type { ChatMessage } from '../api/provider-interface.js';

/**
 * Short-term conversational memory.
 *
 * Holds the running message list for an agent session. Provides a cheap token
 * estimate so the summarizer can decide when to compress.
 */
export class ShortTermMemory {
  private readonly messages: ChatMessage[] = [];
  private readonly tokenBudget: number;

  constructor(tokenBudget = 120_000) {
    this.tokenBudget = tokenBudget;
  }

  append(message: ChatMessage): void {
    this.messages.push(message);
  }

  extend(messages: ChatMessage[]): void {
    for (const m of messages) this.messages.push(m);
  }

  snapshot(): ChatMessage[] {
    return this.messages.map((m) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : [...m.content],
    }));
  }

  clear(): void {
    this.messages.length = 0;
  }

  replace(messages: ChatMessage[]): void {
    this.messages.length = 0;
    for (const m of messages) this.messages.push(m);
  }

  /**
   * Rough token estimate using 4-chars-per-token heuristic. Good enough to
   * decide when to trigger summarization without pulling in a tokenizer dep.
   */
  estimateTokens(): number {
    let chars = 0;
    for (const m of this.messages) {
      if (typeof m.content === 'string') {
        chars += m.content.length;
      } else {
        for (const p of m.content) {
          if (p.type === 'text') chars += p.text.length;
          else if (p.type === 'tool_result') chars += p.content.length;
          else if (p.type === 'tool_use') chars += JSON.stringify(p.input).length + p.name.length;
        }
      }
    }
    return Math.ceil(chars / 4);
  }

  overBudget(): boolean {
    return this.estimateTokens() > this.tokenBudget;
  }

  length(): number {
    return this.messages.length;
  }
}
