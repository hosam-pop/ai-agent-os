import { appendFileSync, existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { paths, ensureDirs } from '../config/paths.js';
import { feature } from '../config/feature-flags.js';
import { logger } from '../utils/logger.js';
import type { AIProvider } from '../api/provider-interface.js';
import type { LongTermMemory } from '../memory/long-term.js';

/**
 * KAIROS — persistent, always-on companion mode.
 *
 * Port of Claude-Code's KAIROS module (src/assistant/, src/proactive/,
 * src/services/autoDream/). It persists session state to disk, writes a daily
 * journal, and periodically "consolidates" old logs into long-term memory via
 * the Orient → Gather → Consolidate → Prune pipeline.
 *
 * Gated by DOGE_FEATURE_KAIROS=true.
 */

interface KairosState {
  enabled: boolean;
  lastConsolidationAt: string | null;
  pid: number;
}

function stateFile(): string {
  return join(paths.home, 'kairos-state.json');
}

function lockFile(): string {
  return join(paths.home, '.consolidate-lock');
}

function dailyLogPath(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const dir = join(paths.logs, String(y), m);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, `${y}-${m}-${d}.md`);
}

export function loadKairosState(): KairosState {
  ensureDirs();
  if (!existsSync(stateFile())) {
    return { enabled: feature('KAIROS'), lastConsolidationAt: null, pid: process.pid };
  }
  try {
    return JSON.parse(readFileSync(stateFile(), 'utf8')) as KairosState;
  } catch {
    return { enabled: feature('KAIROS'), lastConsolidationAt: null, pid: process.pid };
  }
}

export function saveKairosState(state: KairosState): void {
  ensureDirs();
  writeFileSync(stateFile(), JSON.stringify(state, null, 2), 'utf8');
}

export function appendDailyLog(entry: string): void {
  if (!feature('KAIROS')) return;
  ensureDirs();
  const line = `- [${new Date().toISOString()}] ${entry}\n`;
  appendFileSync(dailyLogPath(), line, 'utf8');
}

export async function consolidate(
  provider: AIProvider,
  model: string,
  memory: LongTermMemory,
): Promise<{ consolidated: boolean; summary?: string }> {
  if (!feature('KAIROS')) return { consolidated: false };
  const state = loadKairosState();

  if (existsSync(lockFile())) {
    logger.info('kairos.consolidate.skip.locked');
    return { consolidated: false };
  }
  writeFileSync(lockFile(), String(process.pid), 'utf8');

  try {
    const now = new Date();
    const last = state.lastConsolidationAt ? new Date(state.lastConsolidationAt) : null;
    if (last && now.getTime() - last.getTime() < 24 * 60 * 60 * 1000) {
      return { consolidated: false };
    }

    const logPath = dailyLogPath();
    if (!existsSync(logPath)) return { consolidated: false };
    const raw = readFileSync(logPath, 'utf8').trim();
    if (raw.split('\n').length < 5) return { consolidated: false };

    // Orient → Gather → Consolidate → Prune
    const completion = await provider.complete({
      model,
      system:
        'You are KAIROS in Consolidate stage. Read a day of journal lines and produce a concise ' +
        'long-term memory note with: key events, decisions, user preferences, open threads.',
      maxTokens: 1200,
      messages: [{ role: 'user', content: raw }],
    });
    const summary = completion.content
      .filter((p) => p.type === 'text')
      .map((p) => (p.type === 'text' ? p.text : ''))
      .join('\n')
      .trim();

    memory.remember({
      title: `KAIROS daily ${now.toISOString().slice(0, 10)}`,
      body: summary,
      tags: ['kairos', 'daily'],
    });

    state.lastConsolidationAt = now.toISOString();
    saveKairosState(state);
    return { consolidated: true, summary };
  } finally {
    try {
      const { unlinkSync } = await import('node:fs');
      unlinkSync(lockFile());
    } catch {
      /* ignore */
    }
  }
}
