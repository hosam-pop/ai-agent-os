import { logger } from '../utils/logger.js';

/**
 * LangGraph-inspired state graph.
 *
 * A StateGraph is a directed graph whose nodes are pure-ish async functions
 * that mutate an immutable `State` and return the next state. Edges can be
 * unconditional (always go to X) or conditional (a router function picks
 * the next node based on the new state). The special `END` sentinel
 * terminates execution.
 */

export const END = '__end__';
export type NodeName = string;

export type NodeFn<State> = (state: State) => Promise<State> | State;
export type RouterFn<State> = (state: State) => NodeName;

export interface StateGraphRunResult<State> {
  readonly finalState: State;
  readonly path: NodeName[];
  readonly reason: 'ended' | 'step-limit' | 'dead-end';
}

export class StateGraph<State> {
  private readonly nodes = new Map<NodeName, NodeFn<State>>();
  private readonly edges = new Map<NodeName, NodeName>();
  private readonly conditionalEdges = new Map<NodeName, RouterFn<State>>();
  private entry?: NodeName;

  addNode(name: NodeName, fn: NodeFn<State>): this {
    if (name === END) throw new Error(`"${END}" is a reserved node name`);
    if (this.nodes.has(name)) throw new Error(`node ${name} already exists`);
    this.nodes.set(name, fn);
    return this;
  }

  setEntry(name: NodeName): this {
    if (!this.nodes.has(name)) throw new Error(`entry node ${name} not registered`);
    this.entry = name;
    return this;
  }

  addEdge(from: NodeName, to: NodeName): this {
    if (!this.nodes.has(from)) throw new Error(`edge from unknown node ${from}`);
    if (to !== END && !this.nodes.has(to)) throw new Error(`edge to unknown node ${to}`);
    this.edges.set(from, to);
    return this;
  }

  addConditionalEdge(from: NodeName, router: RouterFn<State>): this {
    if (!this.nodes.has(from)) throw new Error(`conditional edge from unknown node ${from}`);
    this.conditionalEdges.set(from, router);
    return this;
  }

  async run(initial: State, stepLimit = 64): Promise<StateGraphRunResult<State>> {
    if (!this.entry) throw new Error('state graph has no entry node');
    let current: NodeName = this.entry;
    let state = initial;
    const path: NodeName[] = [];

    for (let i = 0; i < stepLimit; i += 1) {
      path.push(current);
      const fn = this.nodes.get(current);
      if (!fn) {
        logger.warn('state-graph.dead-end', { node: current });
        return { finalState: state, path, reason: 'dead-end' };
      }
      state = await fn(state);
      const router = this.conditionalEdges.get(current);
      const next = router ? router(state) : this.edges.get(current);
      if (!next) {
        return { finalState: state, path, reason: 'dead-end' };
      }
      if (next === END) {
        path.push(END);
        return { finalState: state, path, reason: 'ended' };
      }
      current = next;
    }
    return { finalState: state, path, reason: 'step-limit' };
  }
}
