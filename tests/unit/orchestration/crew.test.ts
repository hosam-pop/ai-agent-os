import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Crew, topoSort } from '../../../dist/orchestration/crew.js';

test('Crew runs tasks sequentially and aggregates outputs per task id', async () => {
  const researcher = {
    role: 'researcher',
    goal: 'find facts',
    async execute(task) {
      return `fact for ${task.id}`;
    },
  };
  const writer = {
    role: 'writer',
    goal: 'write copy',
    async execute(task, ctx) {
      return `writer saw ${Object.keys(ctx.outputs).length} outputs`;
    },
  };
  const crew = new Crew({
    agents: [researcher, writer],
    tasks: [
      { id: 't1', description: 'research', agent: 'researcher' },
      { id: 't2', description: 'write', agent: 'writer', context: ['t1'] },
    ],
  });
  const result = await crew.kickoff();
  assert.equal(result.steps.length, 2);
  assert.equal(result.outputs.t1, 'fact for t1');
  assert.equal(result.outputs.t2, 'writer saw 1 outputs');
  assert.equal(result.final, 'writer saw 1 outputs');
});

test('Crew rejects tasks referencing an unknown agent role', () => {
  const agents = [
    {
      role: 'a',
      goal: 'g',
      async execute() {
        return 'ok';
      },
    },
  ];
  const crew = new Crew({
    agents,
    tasks: [{ id: 't1', description: 'x', agent: 'ghost' }],
  });
  return assert.rejects(() => crew.kickoff(), /no agent registered/);
});

test('topoSort honours dependency ordering and rejects cycles', () => {
  const order = topoSort([
    { id: 'c', description: '', depends: ['b'] },
    { id: 'a', description: '' },
    { id: 'b', description: '', depends: ['a'] },
  ]);
  assert.deepEqual(
    order.map((t) => t.id),
    ['a', 'b', 'c'],
  );
  assert.throws(() =>
    topoSort([
      { id: 'a', description: '', depends: ['b'] },
      { id: 'b', description: '', depends: ['a'] },
    ]),
  );
});
