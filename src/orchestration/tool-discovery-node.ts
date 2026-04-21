/**
 * ToolDiscoveryNode — intent-aware tool selection node for {@link StateGraph}.
 *
 * Inspired by the ACI.dev orchestration philosophy ("agents should pick the
 * best tool at runtime, not at plan time"), this node inspects the current
 * state, asks the {@link ComposioGateway} for candidate remote tools, and
 * annotates the state with the best suggestion if one scores above the
 * caller-supplied threshold.
 *
 * It is a pure function factory — no I/O is performed unless the gateway
 * is configured. The node never mutates the planned tool name; it only
 * records a suggestion the planner can use on the next tick.
 */

import type { ComposioGateway, BetterToolSuggestion } from '../gateway/composio-gateway.js';
import type { NodeFn } from './state-graph.js';

export interface ToolDiscoveryCapable {
  /** Human description of what the agent is trying to accomplish. */
  readonly intent: string;
  /** Tool the planner currently intends to call. */
  readonly plannedTool?: string;
  /** Populated by the node when a better remote tool is available. */
  discoverySuggestion?: BetterToolSuggestion | null;
  /** Updated to track which tool should actually execute next. */
  selectedTool?: string;
}

export interface ToolDiscoveryOptions {
  readonly gateway: ComposioGateway;
  readonly minScore?: number;
}

export function buildToolDiscoveryNode<S extends ToolDiscoveryCapable>(
  opts: ToolDiscoveryOptions,
): NodeFn<S> {
  const threshold = opts.minScore ?? 2;
  return async (state: S): Promise<S> => {
    const planned = state.plannedTool ?? '';
    const suggestion = await opts.gateway.suggestBetterTool(state.intent, planned);
    if (!suggestion || suggestion.score < threshold) {
      return { ...state, discoverySuggestion: null, selectedTool: planned };
    }
    return {
      ...state,
      discoverySuggestion: suggestion,
      selectedTool: suggestion.candidate.slug,
    };
  };
}
