import { loadEnv } from './env-loader.js';

/**
 * Feature gates.
 *
 * Original five gates are ported from Claude-Code (the code lives, the gate
 * decides). Seven additional gates were added for the Ultimate Integration
 * phase — admin tooling, browser automation, mem0, MCP, router, social
 * channels, and the octoroute local-LLM preset.
 */

export type FeatureName =
  | 'BUDDY'
  | 'KAIROS'
  | 'ULTRAPLAN'
  | 'COORDINATOR'
  | 'BRIDGE'
  | 'ADMIN'
  | 'BROWSER'
  | 'MEM0'
  | 'MCP'
  | 'ROUTER'
  | 'SOCIAL'
  | 'OCTOROUTE'
  | 'SAST'
  | 'DAST'
  | 'LOG_ANALYSIS'
  | 'IDS'
  | 'CONTAINER_SCAN'
  | 'RUNTIME_MONITOR'
  | 'ORCHESTRATION'
  | 'LLM_GUARD'
  | 'THREAT_INTEL'
  | 'DETECTION_ENG'
  | 'MCP_GATEWAY'
  | 'LETTA'
  | 'ZEP'
  | 'VECTOR_STORES'
  | 'RAG'
  | 'SKILL_PLANNER'
  | 'STAGEHAND'
  | 'CODEQL_MCP'
  | 'SEMGREP_MCP'
  | 'COMPOSIO'
  | 'ARCADE'
  | 'IRON_CURTAIN'
  | 'KAVACH'
  | 'LANGFUSE'
  | 'POSTHOG'
  | 'OPENLIT'
  | 'AGENTWATCH'
  | 'AGENTEST'
  | 'TOOL_DISCOVERY'
  | 'OPENFANG'
  | 'ARGENTOR'
  | 'QUALIXAR'
  | 'ASTERAI_SANDBOX'
  | 'AUTO_DREAM'
  | 'GRAPH_MEMORY'
  | 'TEMPORAL_MEMORY'
  | 'HYBRID_RETRIEVAL';

const ALL_FEATURES: FeatureName[] = [
  'BUDDY',
  'KAIROS',
  'ULTRAPLAN',
  'COORDINATOR',
  'BRIDGE',
  'ADMIN',
  'BROWSER',
  'MEM0',
  'MCP',
  'ROUTER',
  'SOCIAL',
  'OCTOROUTE',
  'SAST',
  'DAST',
  'LOG_ANALYSIS',
  'IDS',
  'CONTAINER_SCAN',
  'RUNTIME_MONITOR',
  'ORCHESTRATION',
  'LLM_GUARD',
  'THREAT_INTEL',
  'DETECTION_ENG',
  'MCP_GATEWAY',
  'LETTA',
  'ZEP',
  'VECTOR_STORES',
  'RAG',
  'SKILL_PLANNER',
  'STAGEHAND',
  'CODEQL_MCP',
  'SEMGREP_MCP',
  'COMPOSIO',
  'ARCADE',
  'IRON_CURTAIN',
  'KAVACH',
  'LANGFUSE',
  'POSTHOG',
  'OPENLIT',
  'AGENTWATCH',
  'AGENTEST',
  'TOOL_DISCOVERY',
  'OPENFANG',
  'ARGENTOR',
  'QUALIXAR',
  'ASTERAI_SANDBOX',
  'AUTO_DREAM',
  'GRAPH_MEMORY',
  'TEMPORAL_MEMORY',
  'HYBRID_RETRIEVAL',
];

export function feature(name: FeatureName): boolean {
  const env = loadEnv();
  switch (name) {
    case 'BUDDY':
      return env.DOGE_FEATURE_BUDDY;
    case 'KAIROS':
      return env.DOGE_FEATURE_KAIROS;
    case 'ULTRAPLAN':
      return env.DOGE_FEATURE_ULTRAPLAN;
    case 'COORDINATOR':
      return env.DOGE_FEATURE_COORDINATOR;
    case 'BRIDGE':
      return env.DOGE_FEATURE_BRIDGE;
    case 'ADMIN':
      return env.DOGE_FEATURE_ADMIN;
    case 'BROWSER':
      return env.DOGE_FEATURE_BROWSER;
    case 'MEM0':
      return env.DOGE_FEATURE_MEM0;
    case 'MCP':
      return env.DOGE_FEATURE_MCP;
    case 'ROUTER':
      return env.DOGE_FEATURE_ROUTER;
    case 'SOCIAL':
      return env.DOGE_FEATURE_SOCIAL;
    case 'OCTOROUTE':
      return env.DOGE_FEATURE_OCTOROUTE;
    case 'SAST':
      return env.DOGE_FEATURE_SAST;
    case 'DAST':
      return env.DOGE_FEATURE_DAST;
    case 'LOG_ANALYSIS':
      return env.DOGE_FEATURE_LOG_ANALYSIS;
    case 'IDS':
      return env.DOGE_FEATURE_IDS;
    case 'CONTAINER_SCAN':
      return env.DOGE_FEATURE_CONTAINER_SCAN;
    case 'RUNTIME_MONITOR':
      return env.DOGE_FEATURE_RUNTIME_MONITOR;
    case 'ORCHESTRATION':
      return env.DOGE_FEATURE_ORCHESTRATION;
    case 'LLM_GUARD':
      return env.DOGE_FEATURE_LLM_GUARD;
    case 'THREAT_INTEL':
      return env.DOGE_FEATURE_THREAT_INTEL;
    case 'DETECTION_ENG':
      return env.DOGE_FEATURE_DETECTION_ENG;
    case 'MCP_GATEWAY':
      return env.DOGE_FEATURE_MCP_GATEWAY;
    case 'LETTA':
      return env.DOGE_FEATURE_LETTA;
    case 'ZEP':
      return env.DOGE_FEATURE_ZEP;
    case 'VECTOR_STORES':
      return env.DOGE_FEATURE_VECTOR_STORES;
    case 'RAG':
      return env.DOGE_FEATURE_RAG;
    case 'SKILL_PLANNER':
      return env.DOGE_FEATURE_SKILL_PLANNER;
    case 'STAGEHAND':
      return env.DOGE_FEATURE_STAGEHAND;
    case 'CODEQL_MCP':
      return env.DOGE_FEATURE_CODEQL_MCP;
    case 'SEMGREP_MCP':
      return env.DOGE_FEATURE_SEMGREP_MCP;
    case 'COMPOSIO':
      return env.DOGE_FEATURE_COMPOSIO;
    case 'ARCADE':
      return env.DOGE_FEATURE_ARCADE;
    case 'IRON_CURTAIN':
      return env.DOGE_FEATURE_IRON_CURTAIN;
    case 'KAVACH':
      return env.DOGE_FEATURE_KAVACH;
    case 'LANGFUSE':
      return env.DOGE_FEATURE_LANGFUSE;
    case 'POSTHOG':
      return env.DOGE_FEATURE_POSTHOG;
    case 'OPENLIT':
      return env.DOGE_FEATURE_OPENLIT;
    case 'AGENTWATCH':
      return env.DOGE_FEATURE_AGENTWATCH;
    case 'AGENTEST':
      return env.DOGE_FEATURE_AGENTEST;
    case 'TOOL_DISCOVERY':
      return env.DOGE_FEATURE_TOOL_DISCOVERY;
    case 'OPENFANG':
      return env.ENABLE_OPENFANG;
    case 'ARGENTOR':
      return env.ENABLE_ARGENTOR;
    case 'QUALIXAR':
      return env.ENABLE_QUALIXAR;
    case 'ASTERAI_SANDBOX':
      return env.ENABLE_ASTERAI_SANDBOX;
    case 'AUTO_DREAM':
      return env.ENABLE_AUTO_DREAM;
    case 'GRAPH_MEMORY':
      return env.ENABLE_GRAPH_MEMORY;
    case 'TEMPORAL_MEMORY':
      return env.ENABLE_TEMPORAL_MEMORY;
    case 'HYBRID_RETRIEVAL':
      return env.ENABLE_HYBRID_RETRIEVAL;
    default: {
      const exhaustive: never = name;
      return exhaustive;
    }
  }
}

export function listFeatures(): Array<{ name: FeatureName; enabled: boolean }> {
  return ALL_FEATURES.map((name) => ({ name, enabled: feature(name) }));
}
