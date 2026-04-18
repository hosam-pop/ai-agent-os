/**
 * Directed acyclic dependency graph for tasks.
 *
 * Supports topological traversal and parallel-ready frontier enumeration —
 * i.e. "which nodes are ready right now given what's already done". This
 * enables the orchestrator to run independent subtasks concurrently while
 * still respecting ordering constraints.
 */

export interface GraphNode<T = unknown> {
  id: string;
  value: T;
  dependsOn: string[];
}

export class DependencyGraph<T = unknown> {
  private readonly nodes = new Map<string, GraphNode<T>>();

  add(node: GraphNode<T>): void {
    if (this.nodes.has(node.id)) {
      throw new Error(`Duplicate node id: ${node.id}`);
    }
    this.nodes.set(node.id, { ...node, dependsOn: [...node.dependsOn] });
  }

  has(id: string): boolean {
    return this.nodes.has(id);
  }

  get(id: string): GraphNode<T> | undefined {
    const n = this.nodes.get(id);
    return n ? { ...n, dependsOn: [...n.dependsOn] } : undefined;
  }

  all(): GraphNode<T>[] {
    return [...this.nodes.values()].map((n) => ({ ...n, dependsOn: [...n.dependsOn] }));
  }

  /** Nodes with all dependencies in `done`, excluding already-done nodes. */
  frontier(done: Set<string>): GraphNode<T>[] {
    const ready: GraphNode<T>[] = [];
    for (const n of this.nodes.values()) {
      if (done.has(n.id)) continue;
      if (n.dependsOn.every((d) => done.has(d))) ready.push({ ...n, dependsOn: [...n.dependsOn] });
    }
    return ready;
  }

  /** Kahn-style topological sort. Throws if a cycle is detected. */
  topological(): GraphNode<T>[] {
    const inDegree = new Map<string, number>();
    const dependents = new Map<string, Set<string>>();
    for (const n of this.nodes.values()) {
      inDegree.set(n.id, n.dependsOn.length);
      for (const dep of n.dependsOn) {
        if (!this.nodes.has(dep)) throw new Error(`Missing dependency ${dep} for ${n.id}`);
        const set = dependents.get(dep) ?? new Set<string>();
        set.add(n.id);
        dependents.set(dep, set);
      }
    }
    const queue: string[] = [...inDegree.entries()].filter(([, d]) => d === 0).map(([id]) => id);
    const sorted: GraphNode<T>[] = [];
    while (queue.length > 0) {
      const id = queue.shift() as string;
      const node = this.nodes.get(id);
      if (!node) continue;
      sorted.push({ ...node, dependsOn: [...node.dependsOn] });
      for (const dependent of dependents.get(id) ?? new Set<string>()) {
        const d = (inDegree.get(dependent) ?? 0) - 1;
        inDegree.set(dependent, d);
        if (d === 0) queue.push(dependent);
      }
    }
    if (sorted.length !== this.nodes.size) {
      throw new Error('Cycle detected in task dependency graph');
    }
    return sorted;
  }
}
