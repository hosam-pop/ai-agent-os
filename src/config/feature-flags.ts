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
  | 'DETECTION_ENG';

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
    default: {
      const exhaustive: never = name;
      return exhaustive;
    }
  }
}

export function listFeatures(): Array<{ name: FeatureName; enabled: boolean }> {
  return ALL_FEATURES.map((name) => ({ name, enabled: feature(name) }));
}
