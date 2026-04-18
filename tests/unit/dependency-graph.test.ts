import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DependencyGraph } from '../../dist/tasks/dependency-graph.js';

test('topological sort respects dependencies', () => {
  const g = new DependencyGraph<string>();
  g.add({ id: 'a', value: 'a', dependsOn: [] });
  g.add({ id: 'b', value: 'b', dependsOn: ['a'] });
  g.add({ id: 'c', value: 'c', dependsOn: ['a'] });
  g.add({ id: 'd', value: 'd', dependsOn: ['b', 'c'] });
  const sorted = g.topological().map((n) => n.id);
  assert.equal(sorted[0], 'a');
  assert.equal(sorted[sorted.length - 1], 'd');
  assert.ok(sorted.indexOf('b') < sorted.indexOf('d'));
  assert.ok(sorted.indexOf('c') < sorted.indexOf('d'));
});

test('frontier returns only nodes whose deps are satisfied', () => {
  const g = new DependencyGraph<string>();
  g.add({ id: 'a', value: 'a', dependsOn: [] });
  g.add({ id: 'b', value: 'b', dependsOn: ['a'] });
  const f1 = g.frontier(new Set()).map((n) => n.id);
  assert.deepEqual(f1, ['a']);
  const f2 = g.frontier(new Set(['a'])).map((n) => n.id);
  assert.deepEqual(f2, ['b']);
});

test('cycle is detected', () => {
  const g = new DependencyGraph<string>();
  g.add({ id: 'a', value: 'a', dependsOn: ['b'] });
  g.add({ id: 'b', value: 'b', dependsOn: ['a'] });
  assert.throws(() => g.topological(), /Cycle/);
});
