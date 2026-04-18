import { loadEnv } from '../config/env-loader.js';

/**
 * Security rule definitions.
 *
 * Rules are declarative: pattern + action. A tool invocation is tested against
 * every matching rule; the first `deny` wins, otherwise `allow` is returned.
 * Loosely inspired by Claude-Code's permissions system but simpler and
 * environment-driven.
 */

export type PolicyAction = 'allow' | 'deny' | 'prompt';

export interface PermissionRule {
  /** Name of the tool this rule applies to, or `*` for any. */
  tool: string;
  /** Regex (as string) matched against a canonical representation of the args. */
  pattern?: string;
  action: PolicyAction;
  reason?: string;
}

export type PermissionMode = 'strict' | 'default' | 'permissive';

/** Commands that can destroy data or escalate privileges. */
const DESTRUCTIVE_BASH_PATTERNS = [
  'rm\\s+-rf?\\s+/',
  ':\\(\\)\\{',
  'mkfs',
  'dd\\s+if=',
  'shutdown',
  'reboot',
  'sudo\\s+rm',
  'chmod\\s+(-R\\s+)?777\\s+/',
  'curl\\s+[^|]+\\|\\s*sh',
  'wget\\s+[^|]+\\|\\s*sh',
];

export function rulesForMode(mode?: PermissionMode): PermissionRule[] {
  const env = loadEnv();
  const effective = mode ?? env.DOGE_PERMISSION_MODE;
  const base: PermissionRule[] = DESTRUCTIVE_BASH_PATTERNS.map((p) => ({
    tool: 'bash',
    pattern: p,
    action: 'deny' as PolicyAction,
    reason: 'destructive or privilege-escalating command',
  }));

  if (!env.DOGE_ALLOW_NETWORK) {
    base.push({ tool: 'web', action: 'deny', reason: 'DOGE_ALLOW_NETWORK=false' });
  }
  if (!env.DOGE_ALLOW_WRITES) {
    base.push({ tool: 'file', pattern: 'write|append', action: 'deny', reason: 'DOGE_ALLOW_WRITES=false' });
  }

  if (effective === 'strict') {
    base.push({ tool: 'bash', action: 'prompt', reason: 'strict mode requires confirmation' });
    base.push({ tool: 'file', pattern: 'write|append|delete', action: 'prompt', reason: 'strict mode requires confirmation' });
  }
  if (effective === 'permissive') {
    // Permissive mode keeps only the hard denies.
  }

  return base;
}
