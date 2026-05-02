import { describe, it, expect, beforeEach, vi } from 'vitest';
import { feature, listFeatures } from '../../src/config/feature-flags.js';

// Mock loadEnv
vi.mock('../../src/config/env-loader.js', () => ({
  loadEnv: vi.fn().mockReturnValue({
    DOGE_FEATURE_BUDDY: false,
    DOGE_FEATURE_KAIROS: true,
    DOGE_FEATURE_ULTRAPLAN: false,
    DOGE_FEATURE_ADMIN: true,
    DOGE_FEATURE_BROWSER: false,
    DOGE_FEATURE_MCP: true,
    DOGE_PROVIDER: 'anthropic',
    DOGE_MODEL: 'claude-3-sonnet',
  }),
}));

describe('Feature Flags', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return boolean for enabled feature', () => {
    const result = feature('KAIROS');
    expect(typeof result).toBe('boolean');
  });

  it('should return false for disabled BUDDY feature', () => {
    const result = feature('BUDDY');
    expect(result).toBe(false);
  });

  it('should return true for enabled ADMIN feature', () => {
    const result = feature('ADMIN');
    expect(result).toBe(true);
  });

  it('should list all features', () => {
    const features = listFeatures();

    expect(Array.isArray(features)).toBe(true);
    expect(features.length).toBeGreaterThan(0);
  });

  it('should have name and enabled properties', () => {
    const features = listFeatures();

    features.forEach((f) => {
      expect(f).toHaveProperty('name');
      expect(f).toHaveProperty('enabled');
      expect(typeof f.name).toBe('string');
      expect(typeof f.enabled).toBe('boolean');
    });
  });

  it('should include all major features', () => {
    const features = listFeatures();
    const featureNames = features.map((f) => f.name);

    expect(featureNames).toContain('BUDDY');
    expect(featureNames).toContain('KAIROS');
    expect(featureNames).toContain('ADMIN');
    expect(featureNames).toContain('BROWSER');
    expect(featureNames).toContain('MCP');
  });

  it('should handle SAST feature', () => {
    const result = feature('SAST');
    expect(typeof result).toBe('boolean');
  });

  it('should handle RATE_LIMITING feature', () => {
    const result = feature('ROUTER');
    expect(typeof result).toBe('boolean');
  });
});
