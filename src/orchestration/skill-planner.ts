/**
 * Semantic Kernel-style skill planner.
 *
 * Microsoft's Semantic Kernel (https://github.com/microsoft/semantic-kernel)
 * introduces the idea of **skills** (named, self-describing capabilities) and
 * **planners** that turn a natural-language goal into an ordered list of skill
 * invocations. We port just that pattern into native TypeScript — no .NET
 * dependency — and keep the surface area tight:
 *
 *   - {@link Skill} describes a single capability (name, description, optional
 *     parameter list, async `run`).
 *   - {@link SkillPlanner} resolves a goal into a {@link SkillPlan} and can
 *     execute that plan, returning per-step results. The default resolver is
 *     a deterministic keyword matcher; users can inject any async resolver
 *     (including an LLM-backed one) via the constructor.
 */

export interface Skill<I extends Record<string, unknown> = Record<string, unknown>> {
  readonly name: string;
  readonly description: string;
  readonly parameters?: readonly string[];
  run(args: I): Promise<string>;
}

export interface SkillStep {
  readonly skill: string;
  readonly args: Record<string, unknown>;
  readonly rationale?: string;
}

export interface SkillPlan {
  readonly goal: string;
  readonly steps: SkillStep[];
  readonly warnings: string[];
}

export interface SkillStepResult {
  readonly skill: string;
  readonly ok: boolean;
  readonly output: string;
  readonly error?: string;
}

export interface SkillRunSummary {
  readonly goal: string;
  readonly results: SkillStepResult[];
  readonly failed: boolean;
}

export interface SkillResolverContext {
  readonly goal: string;
  readonly skills: readonly Skill[];
}

export type SkillResolver = (ctx: SkillResolverContext) => Promise<SkillPlan>;

export interface SkillPlannerOptions {
  readonly resolver?: SkillResolver;
}

export class SkillPlanner {
  private readonly skills = new Map<string, Skill>();
  private readonly resolver: SkillResolver;

  constructor(options: SkillPlannerOptions = {}) {
    this.resolver = options.resolver ?? keywordResolver;
  }

  register(skill: Skill): void {
    this.skills.set(skill.name, skill as Skill);
  }

  list(): Skill[] {
    return [...this.skills.values()];
  }

  async plan(goal: string): Promise<SkillPlan> {
    const trimmed = goal.trim();
    if (!trimmed) return { goal, steps: [], warnings: ['empty goal'] };
    const plan = await this.resolver({ goal: trimmed, skills: this.list() });
    const warnings: string[] = [...plan.warnings];
    const validSteps: SkillStep[] = [];
    for (const step of plan.steps) {
      if (!this.skills.has(step.skill)) {
        warnings.push(`unknown skill "${step.skill}" — skipped`);
        continue;
      }
      validSteps.push(step);
    }
    return { goal: trimmed, steps: validSteps, warnings };
  }

  async execute(goal: string): Promise<SkillRunSummary> {
    const plan = await this.plan(goal);
    const results: SkillStepResult[] = [];
    let failed = false;
    for (const step of plan.steps) {
      const skill = this.skills.get(step.skill);
      if (!skill) {
        results.push({ skill: step.skill, ok: false, output: '', error: 'unknown skill' });
        failed = true;
        continue;
      }
      try {
        const output = await skill.run(step.args);
        results.push({ skill: step.skill, ok: true, output });
      } catch (err) {
        failed = true;
        results.push({
          skill: step.skill,
          ok: false,
          output: '',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return { goal: plan.goal, results, failed };
  }
}

/**
 * Deterministic keyword resolver. Matches skills whose name or description
 * words appear in the goal, in the order they are registered.
 */
export const keywordResolver: SkillResolver = async ({ goal, skills }) => {
  const normalised = goal.toLowerCase();
  const steps: SkillStep[] = [];
  const warnings: string[] = [];
  for (const skill of skills) {
    const needles = [skill.name, ...skill.description.toLowerCase().split(/\s+/)].filter(Boolean);
    if (needles.some((n) => normalised.includes(n.toLowerCase()))) {
      steps.push({ skill: skill.name, args: {}, rationale: `matched "${skill.name}" keyword` });
    }
  }
  if (steps.length === 0) {
    warnings.push('no skills matched the goal — returning empty plan');
  }
  return { goal, steps, warnings };
};
