import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';

/**
 * Storage paths for AI Agent OS.
 *
 * Default layout mirrors doge-code (which relocated Claude-Code's `~/.claude/`
 * to `~/.doge/` to avoid conflicts). Overridable via env vars.
 */

const DEFAULT_HOME_DIRNAME = '.doge';

function resolveHome(): string {
  const override = process.env.DOGE_HOME?.trim();
  if (override) return resolve(override);
  return join(homedir(), DEFAULT_HOME_DIRNAME);
}

function resolveWorkspace(): string {
  const override = process.env.DOGE_WORKSPACE?.trim();
  if (override) return resolve(override);
  const cwdWs = resolve(process.cwd(), 'workspace');
  if (existsSync(cwdWs)) return cwdWs;
  return process.cwd();
}

export const paths = {
  get home(): string {
    return resolveHome();
  },
  get workspace(): string {
    return resolveWorkspace();
  },
  get logs(): string {
    return join(resolveHome(), 'logs');
  },
  get memory(): string {
    return join(resolveHome(), 'memory');
  },
  get tasks(): string {
    return join(resolveHome(), 'tasks');
  },
  get plugins(): string {
    return join(resolveHome(), 'plugins');
  },
  get cache(): string {
    return join(resolveHome(), 'cache');
  },
  get settings(): string {
    return join(resolveHome(), 'settings.json');
  },
};

export function ensureDirs(): void {
  for (const dir of [paths.home, paths.logs, paths.memory, paths.tasks, paths.plugins, paths.cache]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}
