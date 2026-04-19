import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SkillPlanner, keywordResolver } from '../../../dist/orchestration/skill-planner.js';

function makeSkill(name, description, run) {
  return { name, description, run: run ?? (async () => `${name}:done`) };
}

test('keywordResolver picks skills whose name appears in the goal', async () => {
  const plan = await keywordResolver({
    goal: 'please fetch the weather',
    skills: [
      makeSkill('weather', 'query weather service'),
      makeSkill('email', 'send email'),
    ],
  });
  assert.equal(plan.steps.length, 1);
  assert.equal(plan.steps[0].skill, 'weather');
});

test('keywordResolver returns warning when nothing matches', async () => {
  const plan = await keywordResolver({
    goal: 'unrelated goal',
    skills: [makeSkill('alpha', 'foo bar')],
  });
  assert.deepEqual(plan.steps, []);
  assert.equal(plan.warnings.length, 1);
});

test('SkillPlanner.plan drops unknown skill references emitted by resolver', async () => {
  const planner = new SkillPlanner({
    resolver: async () => ({
      goal: 'g',
      steps: [
        { skill: 'known', args: {} },
        { skill: 'phantom', args: {} },
      ],
      warnings: [],
    }),
  });
  planner.register(makeSkill('known', 'known skill'));
  const plan = await planner.plan('g');
  assert.equal(plan.steps.length, 1);
  assert.equal(plan.steps[0].skill, 'known');
  assert.match(plan.warnings.join('|'), /phantom/);
});

test('SkillPlanner.execute runs steps in order and captures results', async () => {
  const planner = new SkillPlanner({
    resolver: async () => ({
      goal: 'g',
      steps: [{ skill: 'a', args: {} }, { skill: 'b', args: {} }],
      warnings: [],
    }),
  });
  planner.register(makeSkill('a', 'first'));
  planner.register(makeSkill('b', 'second'));
  const summary = await planner.execute('g');
  assert.equal(summary.failed, false);
  assert.equal(summary.results.length, 2);
  assert.equal(summary.results[0].output, 'a:done');
});

test('SkillPlanner.execute captures exceptions without throwing', async () => {
  const planner = new SkillPlanner({
    resolver: async () => ({ goal: 'g', steps: [{ skill: 'broken', args: {} }], warnings: [] }),
  });
  planner.register(
    makeSkill('broken', 'fails', async () => {
      throw new Error('boom');
    }),
  );
  const summary = await planner.execute('g');
  assert.equal(summary.failed, true);
  assert.equal(summary.results[0].ok, false);
  assert.match(summary.results[0].error ?? '', /boom/);
});

test('SkillPlanner.plan returns empty plan on empty goal', async () => {
  const planner = new SkillPlanner();
  const plan = await planner.plan('   ');
  assert.deepEqual(plan.steps, []);
  assert.ok(plan.warnings.includes('empty goal'));
});
