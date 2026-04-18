import type { AIProvider, ChatMessage } from '../api/provider-interface.js';
import { logger } from '../utils/logger.js';

/**
 * Context compression.
 *
 * When the running conversation exceeds the context budget, collapse the
 * older portion into an assistant-authored summary while preserving the
 * most recent exchanges verbatim. Modeled on the "Consolidate" stage of
 * Claude-Code's KAIROS autoDream pipeline (Orient → Gather → Consolidate →
 * Prune), generalized for any agent session.
 */
export interface SummarizeOptions {
  /** How many recent messages to keep as-is at the end of the conversation. */
  keepRecent?: number;
  /** Model to use for summarization (defaults to the agent's default model). */
  model: string;
  /** Max tokens for the generated summary. */
  maxSummaryTokens?: number;
}

const SUMMARY_SYSTEM = `You are a context compression module. Summarize the earlier
portion of an agent-user conversation so it can be dropped while preserving all
decisions, user preferences, tool results, file paths, identifiers, and
open questions. Output a dense bullet-style summary, no preamble, no fluff.`;

export async function summarize(
  provider: AIProvider,
  messages: ChatMessage[],
  opts: SummarizeOptions,
): Promise<ChatMessage[]> {
  const keep = Math.max(0, opts.keepRecent ?? 6);
  if (messages.length <= keep + 2) return messages;

  const head = messages.slice(0, messages.length - keep);
  const tail = messages.slice(messages.length - keep);

  const serialized = head
    .map((m) => {
      const text =
        typeof m.content === 'string'
          ? m.content
          : m.content
              .map((p) =>
                p.type === 'text'
                  ? p.text
                  : p.type === 'tool_use'
                    ? `[tool:${p.name} ${JSON.stringify(p.input)}]`
                    : p.type === 'tool_result'
                      ? `[tool_result ${p.tool_use_id}]\n${p.content}`
                      : '',
              )
              .join('\n');
      return `## ${m.role}\n${text}`;
    })
    .join('\n\n');

  const completion = await provider.complete({
    model: opts.model,
    system: SUMMARY_SYSTEM,
    maxTokens: opts.maxSummaryTokens ?? 1500,
    messages: [
      {
        role: 'user',
        content: `Summarize the following transcript into a compact context note.\n\n${serialized}`,
      },
    ],
  });

  const summaryText = completion.content
    .filter((p) => p.type === 'text')
    .map((p) => (p.type === 'text' ? p.text : ''))
    .join('\n')
    .trim();

  logger.info('memory.summarize', {
    compressedMessages: head.length,
    keptRecent: tail.length,
    summaryChars: summaryText.length,
  });

  const note: ChatMessage = {
    role: 'assistant',
    content: `[context-summary]\n${summaryText}`,
  };

  return [note, ...tail];
}
