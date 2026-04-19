/**
 * LanceDB (https://github.com/lancedb/lancedb) adapter for
 * {@link VectorStore}.
 *
 * LanceDB ships as a native package (`@lancedb/lancedb`) that pulls in
 * pre-compiled binaries, so we import it *dynamically* through an injected
 * module factory. That way:
 *
 * 1. The build does not require the dependency to be present.
 * 2. Tests inject a synchronous in-memory fake instead of installing the
 *    native library.
 * 3. Users can enable LanceDB by installing `@lancedb/lancedb` locally.
 */

import {
  type VectorMatch,
  type VectorPoint,
  type VectorSearchRequest,
  type VectorSearchResponse,
  type VectorStore,
  type VectorStoreOp,
} from './vector-store.js';

export interface LanceDBRow {
  id: string;
  vector: number[];
  payload?: Record<string, unknown>;
  text?: string;
}

export interface LanceDBTableLike {
  add(rows: LanceDBRow[]): Promise<unknown>;
  delete(filter: string): Promise<unknown>;
  search(vector: number[]): LanceDBSearchChainLike;
  schema?: unknown;
}

export interface LanceDBSearchChainLike {
  limit(n: number): LanceDBSearchChainLike;
  where?(filter: string): LanceDBSearchChainLike;
  toArray(): Promise<Array<Record<string, unknown>>>;
}

export interface LanceDBConnectionLike {
  openTable(name: string): Promise<LanceDBTableLike>;
  createTable(
    name: string,
    rows: LanceDBRow[],
    options?: { mode?: 'create' | 'overwrite' },
  ): Promise<LanceDBTableLike>;
  tableNames(): Promise<string[]>;
}

export interface LanceDBModuleLike {
  connect(uri: string): Promise<LanceDBConnectionLike>;
}

export interface LanceDBStoreOptions {
  readonly uri?: string;
  readonly moduleLoader?: () => Promise<LanceDBModuleLike>;
}

export class LanceDBStore implements VectorStore {
  readonly backend = 'lancedb' as const;
  private readonly uri: string;
  private readonly moduleLoader: () => Promise<LanceDBModuleLike>;
  private connection: LanceDBConnectionLike | null = null;
  private readonly tables = new Map<string, LanceDBTableLike>();

  constructor(options: LanceDBStoreOptions = {}) {
    this.uri = options.uri ?? './.lancedb';
    this.moduleLoader =
      options.moduleLoader ??
      (async () => {
        const spec = '@lancedb/lancedb';
        return (await import(spec)) as unknown as LanceDBModuleLike;
      });
  }

  async ensureCollection(name: string, dim: number): Promise<VectorStoreOp> {
    if (!name) return { ok: false, error: 'collection name is required' };
    const conn = await this.getConnection();
    if (!conn.ok || !conn.connection) return { ok: false, error: conn.error };
    try {
      const names = await conn.connection.tableNames();
      if (names.includes(name)) {
        this.tables.set(name, await conn.connection.openTable(name));
        return { ok: true };
      }
      const seed: LanceDBRow[] = [{ id: '__seed__', vector: new Array(dim).fill(0), text: '__seed__' }];
      const table = await conn.connection.createTable(name, seed, { mode: 'create' });
      await table.delete("id = '__seed__'");
      this.tables.set(name, table);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async upsert(collection: string, points: readonly VectorPoint[]): Promise<VectorStoreOp> {
    if (points.length === 0) return { ok: true };
    const table = await this.getTable(collection);
    if (!table.ok || !table.table) return { ok: false, error: table.error };
    const rows: LanceDBRow[] = points.map((p) => ({
      id: p.id,
      vector: [...p.vector],
      payload: p.payload,
      text: typeof p.payload?.text === 'string' ? (p.payload.text as string) : undefined,
    }));
    try {
      const ids = rows.map((r) => `'${r.id.replace(/'/g, "''")}'`).join(', ');
      await table.table.delete(`id IN (${ids})`).catch(() => undefined);
      await table.table.add(rows);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async search(collection: string, request: VectorSearchRequest): Promise<VectorSearchResponse> {
    const table = await this.getTable(collection);
    if (!table.ok || !table.table) return { ok: false, matches: [], error: table.error };
    try {
      let chain = table.table.search([...request.vector]).limit(request.limit ?? 10);
      if (request.filter && table.table.search([...request.vector]).where) {
        const whereClause = formatFilter(request.filter);
        if (whereClause) chain = (chain as LanceDBSearchChainLike).where?.(whereClause) ?? chain;
      }
      const rows = await chain.toArray();
      return { ok: true, matches: rows.map(parseLanceDBRow) };
    } catch (err) {
      return { ok: false, matches: [], error: err instanceof Error ? err.message : String(err) };
    }
  }

  async deleteByIds(collection: string, ids: readonly string[]): Promise<VectorStoreOp> {
    if (ids.length === 0) return { ok: true };
    const table = await this.getTable(collection);
    if (!table.ok || !table.table) return { ok: false, error: table.error };
    try {
      const quoted = ids.map((id) => `'${id.replace(/'/g, "''")}'`).join(', ');
      await table.table.delete(`id IN (${quoted})`);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  private async getConnection(): Promise<{ ok: boolean; connection?: LanceDBConnectionLike; error?: string }> {
    if (this.connection) return { ok: true, connection: this.connection };
    try {
      const mod = await this.moduleLoader();
      this.connection = await mod.connect(this.uri);
      return { ok: true, connection: this.connection };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  private async getTable(
    collection: string,
  ): Promise<{ ok: boolean; table?: LanceDBTableLike; error?: string }> {
    const cached = this.tables.get(collection);
    if (cached) return { ok: true, table: cached };
    const conn = await this.getConnection();
    if (!conn.ok || !conn.connection) return { ok: false, error: conn.error };
    try {
      const table = await conn.connection.openTable(collection);
      this.tables.set(collection, table);
      return { ok: true, table };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

export function parseLanceDBRow(raw: Record<string, unknown>): VectorMatch {
  const id =
    typeof raw.id === 'string' ? raw.id : typeof raw.id === 'number' ? String(raw.id) : 'unknown';
  const distance = typeof raw._distance === 'number' ? (raw._distance as number) : undefined;
  const score =
    distance !== undefined
      ? 1 - distance
      : typeof raw.score === 'number'
        ? (raw.score as number)
        : 0;
  const payload = (raw.payload as Record<string, unknown> | undefined) ?? undefined;
  return { id, score, payload };
}

function formatFilter(filter: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(filter)) {
    if (typeof value === 'string') {
      parts.push(`${key} = '${value.replace(/'/g, "''")}'`);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      parts.push(`${key} = ${value}`);
    }
  }
  return parts.join(' AND ');
}
