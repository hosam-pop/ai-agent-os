/**
 * MCP Gateway — a policy layer in front of {@link MCPClient}.
 *
 * Inspired by Lasso Security's `mcp-gateway` and Guardian-MCP: every tool
 * invocation is filtered through an allowlist / denylist, rate-limited per
 * tool, and optionally piped through {@link VigilClient} so responses from
 * untrusted MCP servers are scanned for prompt injection before the main
 * agent sees them.
 *
 * The gateway is defensive by design: it never originates a call, it only
 * wraps an existing client. A denied call returns a structured
 * `{ ok: false, error }` so the agent can react without the gateway having
 * to throw.
 */

import type {
  MCPCallResult,
  MCPClient,
  MCPToolDescriptor,
} from './mcp-client.js';
import { VigilClient, type VigilScanSummary } from '../../security/llm-guard/vigil-client.js';
import { logger } from '../../utils/logger.js';

export interface MCPGatewayPolicy {
  /** Exact tool names allowed to be called. If omitted or empty, all tools are allowed (subject to denylist). */
  readonly allowTools?: readonly string[];
  /** Exact tool names that must never be called. Denylist always wins. */
  readonly denyTools?: readonly string[];
  /** Max calls per tool per window. `undefined` means unlimited. */
  readonly rateLimitPerTool?: number;
  /** Window length in ms for rate limiting. Defaults to 60_000. */
  readonly rateWindowMs?: number;
  /** Scan responses with Vigil and block when the verdict is `malicious`. */
  readonly scanResponses?: boolean;
  /** Optional Vigil client for response scanning. */
  readonly vigil?: VigilClient;
}

export interface MCPGatewayDecision {
  readonly allowed: boolean;
  readonly reason?: 'denied' | 'not-allowed' | 'rate-limited';
  readonly waitMs?: number;
}

const DEFAULT_WINDOW_MS = 60_000;

/**
 * Pure policy check — no I/O, no clock mutation. Returns whether the call
 * should be allowed given a timestamped call history.
 */
export function evaluatePolicy(
  toolName: string,
  policy: MCPGatewayPolicy,
  history: readonly number[],
  now: number,
): MCPGatewayDecision {
  const deny = policy.denyTools ?? [];
  if (deny.includes(toolName)) return { allowed: false, reason: 'denied' };

  const allow = policy.allowTools;
  if (allow && allow.length > 0 && !allow.includes(toolName)) {
    return { allowed: false, reason: 'not-allowed' };
  }

  const limit = policy.rateLimitPerTool;
  if (typeof limit === 'number' && limit > 0) {
    const windowMs = policy.rateWindowMs ?? DEFAULT_WINDOW_MS;
    const cutoff = now - windowMs;
    const recent = history.filter((t) => t >= cutoff);
    if (recent.length >= limit) {
      const oldest = recent[0] ?? now;
      const waitMs = Math.max(0, windowMs - (now - oldest));
      return { allowed: false, reason: 'rate-limited', waitMs };
    }
  }

  return { allowed: true };
}

/**
 * A gated MCP client that presents the same shape as {@link MCPClient}. We
 * purposely do not subclass — structural typing keeps this safe to plug in.
 */
export interface GatedMCPClient {
  listTools(): Promise<MCPToolDescriptor[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<MCPCallResult>;
  close(): Promise<void>;
}

interface BuildGatewayOptions {
  readonly client: Pick<MCPClient, 'listTools' | 'callTool' | 'close' | 'connect'>;
  readonly policy: MCPGatewayPolicy;
  readonly now?: () => number;
}

export function buildGatedMCPClient(opts: BuildGatewayOptions): GatedMCPClient {
  const history = new Map<string, number[]>();
  const now = opts.now ?? Date.now;

  async function listTools(): Promise<MCPToolDescriptor[]> {
    const upstream = await opts.client.listTools();
    const deny = new Set(opts.policy.denyTools ?? []);
    const allow = opts.policy.allowTools;
    return upstream.filter((t) => {
      if (deny.has(t.name)) return false;
      if (allow && allow.length > 0 && !allow.includes(t.name)) return false;
      return true;
    });
  }

  async function callTool(name: string, args: Record<string, unknown>): Promise<MCPCallResult> {
    const bucket = history.get(name) ?? [];
    const decision = evaluatePolicy(name, opts.policy, bucket, now());
    if (!decision.allowed) {
      logger.warn('mcp.gateway.blocked', { tool: name, reason: decision.reason });
      return {
        ok: false,
        output: '',
        isError: true,
        data: { blocked: true, reason: decision.reason, waitMs: decision.waitMs },
      };
    }

    bucket.push(now());
    history.set(name, bucket);

    const result = await opts.client.callTool(name, args);
    if (!opts.policy.scanResponses || !opts.policy.vigil || !result.ok) return result;

    const scan = await opts.policy.vigil.scan({ prompt: result.output });
    if (scan.verdict === 'malicious') {
      logger.warn('mcp.gateway.scan.blocked', {
        tool: name,
        total: scan.total,
      });
      return {
        ok: false,
        output: '',
        isError: true,
        data: { blocked: true, reason: 'malicious-response', scan: summariseScan(scan) },
      };
    }

    return {
      ...result,
      data: { ...((result.data as Record<string, unknown>) ?? {}), scan: summariseScan(scan) },
    };
  }

  async function close(): Promise<void> {
    await opts.client.close();
  }

  return { listTools, callTool, close };
}

function summariseScan(scan: VigilScanSummary): Record<string, unknown> {
  return {
    verdict: scan.verdict,
    total: scan.total,
    byScanner: scan.byScanner,
  };
}
