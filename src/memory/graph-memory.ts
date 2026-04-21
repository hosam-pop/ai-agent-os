/**
 * Graph memory adapter inspired by Kùzu (https://github.com/kuzudb/kuzu).
 *
 * Kùzu is a C++ embedded graph database with a Cypher dialect. Its
 * Node binding (`kuzu` on npm) requires native artifacts that will not
 * build on every host. For a repo that prides itself on a zero-install
 * dev loop we therefore ship a two-tier adapter:
 *
 *   1. If the native Kùzu binding is available at runtime we use it.
 *   2. Otherwise we fall back to a deterministic in-memory triple
 *      store with the same public surface. Tests run against the
 *      fallback so they are fast and hermetic.
 *
 * All behaviour is gated by `ENABLE_GRAPH_MEMORY` upstream. This
 * module itself stays safe to import.
 */

import { logger } from '../utils/logger.js';

export interface GraphNode {
  readonly id: string;
  readonly label: string;
  readonly properties?: Record<string, string | number | boolean>;
}

export interface GraphEdge {
  readonly from: string;
  readonly to: string;
  readonly relation: string;
  readonly properties?: Record<string, string | number | boolean>;
}

export interface GraphMemoryOptions {
  /**
   * Path to an on-disk Kùzu database. When unset, or when Kùzu is not
   * installed, the adapter runs with the in-memory fallback.
   */
  readonly dbPath?: string;
  /**
   * Optional override used by tests to inject a pre-loaded Kùzu binding.
   */
  readonly kuzuLoader?: () => Promise<unknown>;
}

export interface GraphQueryResult {
  readonly rows: ReadonlyArray<Record<string, unknown>>;
}

export interface GraphMemoryAdapter {
  readonly backend: 'kuzu' | 'memory';
  addNode(node: GraphNode): Promise<void>;
  addEdge(edge: GraphEdge): Promise<void>;
  neighbours(nodeId: string, relation?: string): Promise<GraphNode[]>;
  query(statement: string, params?: Record<string, unknown>): Promise<GraphQueryResult>;
  close(): Promise<void>;
}

export async function createGraphMemory(
  opts: GraphMemoryOptions = {},
): Promise<GraphMemoryAdapter> {
  const loader = opts.kuzuLoader ?? defaultKuzuLoader;
  const kuzu = await safeLoad(loader);
  if (kuzu && opts.dbPath) {
    try {
      return new KuzuGraphMemory(kuzu, opts.dbPath);
    } catch (err) {
      logger.warn('graph-memory.kuzu.init.error', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return new InMemoryGraphMemory();
}

class InMemoryGraphMemory implements GraphMemoryAdapter {
  readonly backend = 'memory' as const;
  private readonly nodes = new Map<string, GraphNode>();
  private readonly edges: GraphEdge[] = [];

  async addNode(node: GraphNode): Promise<void> {
    this.nodes.set(node.id, node);
  }

  async addEdge(edge: GraphEdge): Promise<void> {
    this.edges.push(edge);
  }

  async neighbours(nodeId: string, relation?: string): Promise<GraphNode[]> {
    const out: GraphNode[] = [];
    for (const edge of this.edges) {
      if (edge.from !== nodeId) continue;
      if (relation && edge.relation !== relation) continue;
      const target = this.nodes.get(edge.to);
      if (target) out.push(target);
    }
    return out;
  }

  async query(statement: string): Promise<GraphQueryResult> {
    // Deterministic minimal Cypher-ish matcher that supports:
    //   MATCH (n:<Label>) RETURN n
    const match = /MATCH\s+\(n:([A-Za-z_][\w]*)\)\s+RETURN\s+n/i.exec(statement);
    if (match) {
      const label = match[1];
      const rows = Array.from(this.nodes.values())
        .filter((n) => n.label === label)
        .map((n) => ({ n }));
      return { rows };
    }
    return { rows: [] };
  }

  async close(): Promise<void> {
    this.nodes.clear();
    this.edges.length = 0;
  }
}

class KuzuGraphMemory implements GraphMemoryAdapter {
  readonly backend = 'kuzu' as const;
  private readonly db: unknown;
  private readonly conn: unknown;

  constructor(kuzu: unknown, dbPath: string) {
    // We intentionally type-assert here because the `kuzu` binding
    // does not ship TypeScript declarations.
    const Database = (kuzu as { Database: new (path: string) => unknown }).Database;
    const Connection = (kuzu as { Connection: new (db: unknown) => unknown }).Connection;
    this.db = new Database(dbPath);
    this.conn = new Connection(this.db);
  }

  async addNode(node: GraphNode): Promise<void> {
    const props = JSON.stringify(node.properties ?? {});
    await this.exec(
      `CREATE (:${node.label} {id: $id, properties: $props})`,
      { id: node.id, props },
    );
  }

  async addEdge(edge: GraphEdge): Promise<void> {
    await this.exec(
      `MATCH (a {id: $from}), (b {id: $to})
       CREATE (a)-[:${edge.relation} {props: $props}]->(b)`,
      { from: edge.from, to: edge.to, props: JSON.stringify(edge.properties ?? {}) },
    );
  }

  async neighbours(nodeId: string, relation?: string): Promise<GraphNode[]> {
    const rel = relation ? `:${relation}` : '';
    const rs = await this.exec(
      `MATCH (a {id: $id})-[${rel}]->(b) RETURN b.id AS id, label(b) AS label`,
      { id: nodeId },
    );
    return rs.rows.map((row) => ({
      id: String(row.id ?? ''),
      label: String(row.label ?? ''),
    }));
  }

  async query(statement: string, params: Record<string, unknown> = {}): Promise<GraphQueryResult> {
    return this.exec(statement, params);
  }

  async close(): Promise<void> {
    const closable = this.conn as { close?: () => void | Promise<void> };
    await closable.close?.();
  }

  private async exec(
    statement: string,
    params: Record<string, unknown>,
  ): Promise<GraphQueryResult> {
    const conn = this.conn as {
      execute: (stmt: string, params: Record<string, unknown>) => Promise<{ getAll: () => unknown[] }>;
    };
    const rs = await conn.execute(statement, params);
    const raw = await rs.getAll();
    return { rows: raw as ReadonlyArray<Record<string, unknown>> };
  }
}

async function defaultKuzuLoader(): Promise<unknown> {
  return import('kuzu' as string).catch(() => null);
}

async function safeLoad(loader: () => Promise<unknown>): Promise<unknown> {
  try {
    return await loader();
  } catch {
    return null;
  }
}
