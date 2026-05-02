import { describe, it, expect, beforeEach, vi } from 'vitest';
import { plan, type Plan } from '../../src/core/planner.js';
import type { AIProvider } from '../../src/api/provider-interface.js';

const mockProvider: AIProvider = {
  complete: vi.fn(),
  name: 'test-provider',
};

describe('Planner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a plan with rationale and steps', async () => {
    mockProvider.complete = vi.fn().mockResolvedValue({
      content: [
        {
          type: 'text',
          text: `RATIONALE:
This is a test plan to accomplish the goal.

STEPS:
1. First step to do
2. Second step to perform
3. Third step to complete`,
        },
      ],
      stopReason: 'end_turn',
      usage: { inputTokens: 50, outputTokens: 100 },
    });

    const result = await plan(mockProvider, 'Test goal', 'test-model');

    expect(result.goal).toBe('Test goal');
    expect(result.rationale).toContain('test plan');
    expect(result.steps.length).toBeGreaterThanOrEqual(3);
    expect(result.steps[0]).toContain('First step');
  });

  it('should handle steps with numbers', async () => {
    mockProvider.complete = vi.fn().mockResolvedValue({
      content: [
        {
          type: 'text',
          text: `RATIONALE:
Planning approach.

STEPS:
1. Step one
2. Step two
3. Step three`,
        },
      ],
      stopReason: 'end_turn',
      usage: { inputTokens: 50, outputTokens: 100 },
    });

    const result = await plan(mockProvider, 'Test', 'model');

    expect(result.steps[0]).toBe('Step one');
    expect(result.steps[1]).toBe('Step two');
  });

  it('should handle steps without numbers', async () => {
    mockProvider.complete = vi.fn().mockResolvedValue({
      content: [
        {
          type: 'text',
          text: `RATIONALE:
Planning approach.

STEPS:
First action
Second action
Third action`,
        },
      ],
      stopReason: 'end_turn',
      usage: { inputTokens: 50, outputTokens: 100 },
    });

    const result = await plan(mockProvider, 'Test', 'model');

    expect(result.steps.length).toBeGreaterThanOrEqual(3);
  });

  it('should handle missing rationale gracefully', async () => {
    mockProvider.complete = vi.fn().mockResolvedValue({
      content: [
        {
          type: 'text',
          text: `STEPS:
1. Step one
2. Step two`,
        },
      ],
      stopReason: 'end_turn',
      usage: { inputTokens: 50, outputTokens: 100 },
    });

    const result = await plan(mockProvider, 'Test', 'model');

    expect(result.goal).toBe('Test');
    expect(result.rationale).toBe('');
    expect(result.steps.length).toBeGreaterThanOrEqual(2);
  });
});
