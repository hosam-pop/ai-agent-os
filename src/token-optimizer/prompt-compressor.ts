import { ChatMessage, ContentPart } from '../api/provider-interface.js';
import { logger } from '../utils/logger.js';

/**
 * Prompt Compressor
 * Removes redundant tokens, whitespace, and non-essential parts of the context.
 */
export class PromptCompressor {
  static compress(messages: ChatMessage[]): ChatMessage[] {
    const originalLength = JSON.stringify(messages).length;
    
    const compressed = messages.map((msg, index) => {
      if (index >= messages.length - 2) return msg;

      let content = msg.content;
      if (typeof content === 'string') {
        content = this.cleanText(content);
      } else {
        content = content.map(part => {
          if (part.type === 'text') {
            return { ...part, text: this.cleanText(part.text) };
          }
          if (part.type === 'tool_result' && part.content.length > 2000) {
            return { ...part, content: part.content.substring(0, 1000) + "\n... [truncated for brevity] ..." };
          }
          return part;
        });
      }

      return { ...msg, content };
    });

    const newLength = JSON.stringify(compressed).length;
    return compressed;
  }

  private static cleanText(text: string): string {
    return text
      .replace(/\n\s*\n/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .trim();
  }
}
