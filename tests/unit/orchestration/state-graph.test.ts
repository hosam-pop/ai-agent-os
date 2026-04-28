import { test } from 'node:test';
import assert from 'node:assert/strict';
import { END, StateGraph } from '../../../dist/orchestration/state-graph.js';

interface State {
  counter: number;
  trail: string[];
}

test('StateGraph walks a simple linear graph to END', async () => {
  const graph = new StateGraph<State>();
  graph.addNode('inc', (s) => ({ counter: s.counter + 1, trail: [...s.trail, 'inc'] }));
  graph.addNode('double', (s) => ({ counter: s.counter * 2, trail: [...s.trail, 'double'] }));
  graph
    .addEdge('inc', 'double')
    .addEdge('double', END)
    .setEntry('inc');
  const result = await graph.run({ counter: 3, trail: [] });
  assert.equal(result.reason, 'ended');
  assert.equal(result.finalState.counter, 8);
  assert.deepEqual(result.finalState.trail, ['inc', 'double']);
  assert.deepEqual(result.path, ['inc', 'double', END]);
});

test('StateGraph routes through conditional edges and terminates on step limit', async () => {
  const graph = new StateGraph<State>();
  graph.addNode('step', (s) => ({ counter: s.counter + 1, trail: [...s.trail, 'step'] }));
  graph.addNode('done', (s) => s);
  graph.addConditionalEdge('step', (s) => (s.counter >= 3 ? 'done' : 'step'));
  graph.addEdge('done', END);
  graph.setEntry('step');
  const result = await graph.run({ counter: 0, trail: [] });
  assert.equal(result.reason, 'ended');
  assert.equal(result.finalState.counter, 3);
  assert.equal(result.path.at(-1), END);
});

test('StateGraph refuses unknown edges and unset entry', () => {
  const graph = new StateGraph<State>();
  assert.throws(() => graph.addEdge('a', 'b'));
  graph.addNode('a', (s) => s);
  assert.throws(() => graph.setEntry('ghost'));
});
