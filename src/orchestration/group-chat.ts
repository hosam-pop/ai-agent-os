import { logger } from '../utils/logger.js';

/**
 * AutoGen-inspired group chat orchestration.
 *
 * A GroupChat coordinates N agents taking turns. A selector function picks
 * the next speaker from the current transcript — either round-robin, based
 * on a keyword match, or anything the caller wires up. The conversation
 * stops when a termination predicate returns true or the max-turns budget
 * is exhausted.
 */

export interface ChatMessage {
  readonly from: string;
  readonly content: string;
  readonly timestamp: number;
}

export interface ChatAgent {
  readonly name: string;
  readonly systemPrompt?: string;
  respond(transcript: ChatMessage[], group: GroupChat): Promise<string>;
}

export interface GroupChatOptions {
  readonly agents: ChatAgent[];
  readonly maxTurns?: number;
  readonly selector?: (transcript: ChatMessage[], group: GroupChat) => string;
  readonly terminate?: (transcript: ChatMessage[]) => boolean;
  readonly initiator?: string;
}

export interface GroupChatRunOptions {
  readonly task: string;
}

export interface GroupChatResult {
  readonly transcript: ChatMessage[];
  readonly reason: 'terminated' | 'max-turns' | 'empty';
}

export class GroupChat {
  readonly agents: ChatAgent[];
  readonly maxTurns: number;
  private readonly selector: (transcript: ChatMessage[], group: GroupChat) => string;
  private readonly terminate: (transcript: ChatMessage[]) => boolean;
  private readonly initiator?: string;

  constructor(opts: GroupChatOptions) {
    if (opts.agents.length === 0) throw new Error('group chat needs at least one agent');
    this.agents = opts.agents;
    this.maxTurns = opts.maxTurns ?? 10;
    this.selector = opts.selector ?? roundRobinSelector;
    this.terminate = opts.terminate ?? (() => false);
    this.initiator = opts.initiator;
  }

  findAgent(name: string): ChatAgent | undefined {
    return this.agents.find((a) => a.name === name);
  }

  async run(opts: GroupChatRunOptions): Promise<GroupChatResult> {
    const transcript: ChatMessage[] = [
      { from: 'user', content: opts.task, timestamp: Date.now() },
    ];

    for (let turn = 0; turn < this.maxTurns; turn += 1) {
      const nextName = turn === 0 && this.initiator ? this.initiator : this.selector(transcript, this);
      const speaker = this.findAgent(nextName);
      if (!speaker) {
        logger.warn('group-chat.selector.unknown', { name: nextName });
        return { transcript, reason: 'empty' };
      }
      const reply = await speaker.respond(transcript, this);
      const message: ChatMessage = { from: speaker.name, content: reply, timestamp: Date.now() };
      transcript.push(message);
      if (this.terminate(transcript)) {
        return { transcript, reason: 'terminated' };
      }
    }
    return { transcript, reason: 'max-turns' };
  }
}

export function roundRobinSelector(transcript: ChatMessage[], group: GroupChat): string {
  const spoken = transcript.filter((m) => m.from !== 'user');
  const index = spoken.length % group.agents.length;
  const agent = group.agents[index];
  if (!agent) throw new Error('group chat has no agents to pick from');
  return agent.name;
}

export function keywordSelector(map: Record<string, string>, fallback: string): GroupChatOptions['selector'] {
  return (transcript) => {
    const last = transcript[transcript.length - 1];
    const content = (last?.content ?? '').toLowerCase();
    for (const [keyword, name] of Object.entries(map)) {
      if (content.includes(keyword.toLowerCase())) return name;
    }
    return fallback;
  };
}

export function terminatesOn(marker: string): (transcript: ChatMessage[]) => boolean {
  return (transcript) => {
    const last = transcript[transcript.length - 1];
    return !!last && last.content.toLowerCase().includes(marker.toLowerCase());
  };
}
