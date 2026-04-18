import { feature } from '../config/feature-flags.js';
import type { AIProvider } from '../api/provider-interface.js';
import { logger } from '../utils/logger.js';

/**
 * ULTRAPLAN — long-horizon deep-research planner.
 *
 * Port of Claude-Code's ULTRAPLAN module (src/commands/ultraplan.tsx). The
 * original kicks off a high-capability model (Opus) on a remote CCR session
 * for up to 30 minutes. Here we just offer the planning surface itself —
 * callers pass a more capable model explicitly.
 *
 * Gated by DOGE_FEATURE_ULTRAPLAN=true.
 */

export interface UltraPlanOptions {
  goal: string;
  heavyModel?: string;
  maxTokens?: number;
}

export interface UltraPlanResult {
  goal: string;
  strategy: string;
  milestones: string[];
  risks: string[];
  nextAction: string;
}

const SYSTEM = `You are ULTRAPLAN, a long-horizon strategy planner. Given a hard
goal, produce:
STRATEGY: <2-3 sentence overall approach>
MILESTONES:
- <milestone 1>
- <milestone 2>
RISKS:
- <risk 1>
- <risk 2>
NEXT_ACTION: <the single most valuable next action to take now>

No markdown fences.`;

export async function ultraplan(
  provider: AIProvider,
  opts: UltraPlanOptions,
): Promise<UltraPlanResult | null> {
  if (!feature('ULTRAPLAN')) {
    logger.debug('ultraplan.skip.gated-off');
    return null;
  }
  const completion = await provider.complete({
    model: opts.heavyModel ?? 'claude-3-5-sonnet-latest',
    system: SYSTEM,
    maxTokens: opts.maxTokens ?? 2000,
    messages: [{ role: 'user', content: opts.goal }],
  });
  const text = completion.content
    .filter((p) => p.type === 'text')
    .map((p) => (p.type === 'text' ? p.text : ''))
    .join('\n');

  const strategy = /STRATEGY:\s*([\s\S]*?)(?:\nMILESTONES:|$)/i.exec(text)?.[1]?.trim() ?? '';
  const milestonesBlock = /MILESTONES:\s*([\s\S]*?)(?:\nRISKS:|$)/i.exec(text)?.[1]?.trim() ?? '';
  const risksBlock = /RISKS:\s*([\s\S]*?)(?:\nNEXT_ACTION:|$)/i.exec(text)?.[1]?.trim() ?? '';
  const nextAction = /NEXT_ACTION:\s*([\s\S]*)$/i.exec(text)?.[1]?.trim() ?? '';

  const bullets = (block: string): string[] =>
    block
      .split(/\n+/)
      .map((l) => l.replace(/^\s*[-*]\s*/, '').trim())
      .filter((l) => l.length > 0);

  return {
    goal: opts.goal,
    strategy,
    milestones: bullets(milestonesBlock),
    risks: bullets(risksBlock),
    nextAction,
  };
}
