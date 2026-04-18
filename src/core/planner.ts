import type { AIProvider } from '../api/provider-interface.js';

/**
 * High-level plan generator.
 *
 * Produces a human-readable multi-step plan for a goal. Planning is
 * intentionally cheap and non-authoritative — the agent loop still decides,
 * step by step, what to do next. This mirrors the "Plan" phase in the classic
 * Think → Plan → Act → Observe loop.
 */

export interface Plan {
  goal: string;
  steps: string[];
  rationale: string;
}

const PLANNER_SYSTEM = `You are a concise planning assistant. Given a goal, produce a
short ordered plan (3–8 steps) a coding agent can follow. Output strictly as:
RATIONALE:
<one short paragraph>
STEPS:
1. ...
2. ...
No markdown fences, no extra prose.`;

export async function plan(
  provider: AIProvider,
  goal: string,
  model: string,
): Promise<Plan> {
  const completion = await provider.complete({
    model,
    system: PLANNER_SYSTEM,
    maxTokens: 800,
    messages: [{ role: 'user', content: goal }],
  });
  const text = completion.content
    .filter((p) => p.type === 'text')
    .map((p) => (p.type === 'text' ? p.text : ''))
    .join('\n');

  const rationaleMatch = text.match(/RATIONALE:\s*([\s\S]*?)\nSTEPS:/i);
  const stepsMatch = text.match(/STEPS:\s*([\s\S]*)/i);
  const rationale = rationaleMatch?.[1]?.trim() ?? '';
  const stepsBlock = stepsMatch?.[1]?.trim() ?? text.trim();
  const steps = stepsBlock
    .split(/\n+/)
    .map((line) => line.replace(/^\s*\d+\.\s*/, '').trim())
    .filter((line) => line.length > 0);

  return { goal, rationale, steps };
}
