import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { paths, ensureDirs } from '../config/paths.js';
import { logger } from '../utils/logger.js';

export interface LongTermRecord {
  id: string;
  createdAt: string;
  tags: string[];
  title: string;
  body: string;
}

/**
 * File-based long-term memory.
 *
 * Each memory record is a JSON file under `~/.doge/memory/`. This mirrors the
 * KAIROS daily-log pattern from Claude-Code but generalized — any agent may
 * remember or recall facts across sessions.
 */
export class LongTermMemory {
  private readonly dir: string;

  constructor(dir?: string) {
    this.dir = dir ?? paths.memory;
    ensureDirs();
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
  }

  private filePath(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  private makeId(): string {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `mem-${stamp}-${Math.random().toString(36).slice(2, 8)}`;
  }

  remember(record: Omit<LongTermRecord, 'id' | 'createdAt'>): LongTermRecord {
    const full: LongTermRecord = {
      id: this.makeId(),
      createdAt: new Date().toISOString(),
      ...record,
    };
    writeFileSync(this.filePath(full.id), JSON.stringify(full, null, 2), 'utf8');
    logger.debug('long-term.remember', { id: full.id, title: full.title });
    return full;
  }

  recall(id: string): LongTermRecord | null {
    const path = this.filePath(id);
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as LongTermRecord;
    } catch (err) {
      logger.warn('long-term.recall.parse-error', { id, error: String(err) });
      return null;
    }
  }

  search(query: string, limit = 10): LongTermRecord[] {
    const q = query.toLowerCase();
    const results: LongTermRecord[] = [];
    if (!existsSync(this.dir)) return results;
    for (const file of readdirSync(this.dir)) {
      if (!file.endsWith('.json')) continue;
      try {
        const rec = JSON.parse(readFileSync(join(this.dir, file), 'utf8')) as LongTermRecord;
        const haystack = `${rec.title}\n${rec.body}\n${rec.tags.join(' ')}`.toLowerCase();
        if (haystack.includes(q)) results.push(rec);
      } catch {
        /* skip corrupted */
      }
      if (results.length >= limit) break;
    }
    return results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  list(limit = 50): LongTermRecord[] {
    if (!existsSync(this.dir)) return [];
    const files = readdirSync(this.dir)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .reverse()
      .slice(0, limit);
    const out: LongTermRecord[] = [];
    for (const f of files) {
      try {
        out.push(JSON.parse(readFileSync(join(this.dir, f), 'utf8')) as LongTermRecord);
      } catch {
        /* skip */
      }
    }
    return out;
  }
}
