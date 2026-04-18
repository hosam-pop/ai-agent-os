import { loadEnv } from './env-loader.js';

/**
 * Feature gates ported from Claude-Code.
 *
 * Claude-Code ships several experimental modules (Buddy, Kairos, Ultraplan,
 * Coordinator, Bridge) behind `feature(...)` checks. We preserve that pattern:
 * the code is present and importable, but disabled by default and toggled via
 * env vars, matching the Claude-Code convention of "the code lives, the gate
 * decides".
 */

export type FeatureName = 'BUDDY' | 'KAIROS' | 'ULTRAPLAN' | 'COORDINATOR' | 'BRIDGE';

const ALL_FEATURES: FeatureName[] = ['BUDDY', 'KAIROS', 'ULTRAPLAN', 'COORDINATOR', 'BRIDGE'];

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
    default: {
      const exhaustive: never = name;
      return exhaustive;
    }
  }
}

export function listFeatures(): Array<{ name: FeatureName; enabled: boolean }> {
  return ALL_FEATURES.map((name) => ({ name, enabled: feature(name) }));
}
