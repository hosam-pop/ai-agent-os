import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import { paths } from '../config/paths.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function currentLevel(): LogLevel {
  const raw = (process.env.DOGE_LOG_LEVEL ?? 'info').toLowerCase();
  return (['debug', 'info', 'warn', 'error'] as const).includes(raw as LogLevel)
    ? (raw as LogLevel)
    : 'info';
}

function colorFor(level: LogLevel): (s: string) => string {
  switch (level) {
    case 'debug':
      return chalk.gray;
    case 'info':
      return chalk.cyan;
    case 'warn':
      return chalk.yellow;
    case 'error':
      return chalk.red;
  }
}

function serializeMeta(meta: Record<string, unknown> | undefined): string {
  if (!meta || Object.keys(meta).length === 0) return '';
  try {
    return ' ' + JSON.stringify(meta);
  } catch {
    return ' [unserializable meta]';
  }
}

function writeFileLine(line: string): void {
  try {
    if (!existsSync(paths.logs)) mkdirSync(paths.logs, { recursive: true });
    const file = join(paths.logs, `agent-os-${new Date().toISOString().slice(0, 10)}.log`);
    appendFileSync(file, line + '\n', 'utf8');
  } catch {
    // Logging must never throw.
  }
}

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
  child(scope: string): Logger;
}

function buildLogger(scope: string): Logger {
  function log(level: LogLevel, msg: string, meta?: Record<string, unknown>): void {
    if (LEVEL_RANK[level] < LEVEL_RANK[currentLevel()]) return;
    const ts = new Date().toISOString();
    const tag = `[${scope}]`;
    const plain = `${ts} ${level.toUpperCase().padEnd(5)} ${tag} ${msg}${serializeMeta(meta)}`;
    const colored = `${chalk.dim(ts)} ${colorFor(level)(level.toUpperCase().padEnd(5))} ${chalk.magenta(tag)} ${msg}${chalk.dim(serializeMeta(meta))}`;
    const stream = level === 'error' ? process.stderr : process.stdout;
    stream.write(colored + '\n');
    writeFileLine(plain);
  }
  return {
    debug: (m, x) => log('debug', m, x),
    info: (m, x) => log('info', m, x),
    warn: (m, x) => log('warn', m, x),
    error: (m, x) => log('error', m, x),
    child: (child) => buildLogger(`${scope}:${child}`),
  };
}

export const logger: Logger = buildLogger('agent-os');
