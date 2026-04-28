/**
 * IronCurtainGuard — runtime policy guard for tool I/O.
 *
 * Inspired by the `IronCurtain` research prototype (Niels Provos), which
 * sits in front of an agent and blocks behavior that deviates from the
 * current task. The upstream project is Python-only and explicitly
 * marked "Research Prototype — APIs may change", so we do not import it.
 * Instead this file ships a small, well-understood TypeScript guard that
 * covers the same two responsibilities:
 *
 *   1. Pre-execution input inspection. Reject arguments containing
 *      obviously dangerous patterns (prompt-injection markers, egress
 *      attempts to denylisted hosts, attempts to overwrite system files).
 *   2. Post-execution output sanitization. Strip secrets, long hex
 *      blobs, and JWTs before the model sees them.
 *
 * Every decision is structured (`{ allowed, reason }`) so the tool
 * registry can surface a clean error instead of throwing.
 */

import { redactSecrets } from '../vault/arcade-vault.js';

export interface IronCurtainPolicy {
  readonly denyHostPatterns?: readonly RegExp[];
  readonly denyInputPatterns?: readonly RegExp[];
  readonly denyPathPrefixes?: readonly string[];
  readonly maxInputBytes?: number;
  readonly redactOutput?: boolean;
}

export interface IronCurtainDecision {
  readonly allowed: boolean;
  readonly reason?: string;
}

const DEFAULT_INPUT_PATTERNS: RegExp[] = [
  /ignore (?:all |previous |prior )?instructions/i,
  /system\s*prompt\s*override/i,
  /begin\s+adversarial\s+payload/i,
];

const DEFAULT_PATH_PREFIXES = ['/etc/', '/root/', '/proc/', '/sys/'];

const DEFAULT_HOST_PATTERNS: RegExp[] = [/169\.254\.169\.254/, /metadata\.google\.internal/];

export class IronCurtainGuard {
  private readonly policy: IronCurtainPolicy;

  constructor(policy: IronCurtainPolicy = {}) {
    this.policy = policy;
  }

  /** Evaluate tool input against the configured deny rules. */
  checkInput(toolName: string, input: unknown): IronCurtainDecision {
    const serialized = typeof input === 'string' ? input : safeStringify(input);
    const maxBytes = this.policy.maxInputBytes ?? 64 * 1024;
    if (Buffer.byteLength(serialized, 'utf8') > maxBytes) {
      return { allowed: false, reason: `input-too-large (>${maxBytes} bytes) for ${toolName}` };
    }

    for (const pattern of this.policy.denyInputPatterns ?? DEFAULT_INPUT_PATTERNS) {
      if (pattern.test(serialized)) {
        return { allowed: false, reason: `denied-input-pattern:${pattern.source}` };
      }
    }

    for (const prefix of this.policy.denyPathPrefixes ?? DEFAULT_PATH_PREFIXES) {
      if (containsPathPrefix(serialized, prefix)) {
        return { allowed: false, reason: `denied-path-prefix:${prefix}` };
      }
    }

    for (const host of this.policy.denyHostPatterns ?? DEFAULT_HOST_PATTERNS) {
      if (host.test(serialized)) {
        return { allowed: false, reason: `denied-host-pattern:${host.source}` };
      }
    }

    return { allowed: true };
  }

  /** Scrub sensitive tokens from a tool's output string before the LLM reads it. */
  sanitizeOutput(output: string): string {
    if (this.policy.redactOutput === false) return output;
    return redactSecrets(output);
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value ?? '');
  } catch {
    return String(value);
  }
}

function containsPathPrefix(serialized: string, prefix: string): boolean {
  // The prefix must appear as an actual filesystem path, not as a URL
  // path segment (e.g. `https://example.com/etc/...` should NOT trip
  // the `/etc/` deny rule). We walk every occurrence and reject those
  // that sit inside a URL authority.
  let from = 0;
  while (true) {
    const idx = serialized.indexOf(prefix, from);
    if (idx < 0) return false;
    if (!insideUrlAuthority(serialized, idx)) return true;
    from = idx + prefix.length;
  }
}

function insideUrlAuthority(serialized: string, idx: number): boolean {
  // Look backward for a `://` that is NOT interrupted by whitespace or
  // typical delimiters. If we find one before a space/quote, the match
  // lives inside a URL.
  for (let i = idx - 1; i >= 0 && i >= idx - 256; i--) {
    const ch = serialized[i];
    if (ch === '"' || ch === "'" || ch === ' ' || ch === '\n' || ch === '\t') return false;
    if (ch === '/' && serialized[i - 1] === '/' && serialized[i - 2] === ':') return true;
  }
  return false;
}
