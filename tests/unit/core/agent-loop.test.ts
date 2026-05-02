import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentLoop } from '../../src/core/agent-loop.js';
import type { AIProvider, ChatMessage } from '../../src/api/provider-interface.js';

// Mock providers and dependencies
const mockProvider: AIProvider = {
  complete: vi.fn(),
  name: 'test-provider',
};

const mockExecutor = {
  exec: vi.fn().mockResolvedValue({ ok: true, output: 'test result' }),
};

const mockToolRegistry = {
  toSchemas: vi.fn().mockReturnValue([]),
  list: vi.fn().mockReturnValue([]),
};

describe('AgentLoop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create an AgentLoop instance', () => {
    const agentLoop = new AgentLoop({
      provider: mockProvider,
      tools: mockToolRegistry as any,
      executor: mockExecutor as any,
      model: 'test-model',
      systemPrompt: 'You are a helpful assistant',
    });

    expect(agentLoop).toBeDefined();
  });

  it('should return final text when no tools needed', async () => {
    mockProvider.complete = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'Hello, how can I help you?' }],
      stopReason: 'end_turn',
      usage: { inputTokens: 10, outputTokens: 20 },
    });

    const agentLoop = new AgentLoop({
      provider: mockProvider,
      tools: mockToolRegistry as any,
      executor: mockExecutor as any,
      model: 'test-model',
      systemPrompt: 'You are a helpful assistant',
      maxIterations: 5,
    });

    const result = await agentLoop.run('Say hello');

    expect(result.finalText).toContain('Hello');
    expect(result.iterations).toBeGreaterThanOrEqual(1);
    expect(result.usage.inputTokens).toBeGreaterThanOrEqual(0);
  });

  it('should execute tools when model requests tool_use', async () => {
    mockProvider.complete = vi.fn()
      .mockResolvedValueOnce({
        content: [
          { type: 'text', text: 'Let me check the files.' },
          { type: 'tool_use', id: 'tool-1', name: 'bash', input: { command: 'ls -la' } },
        ],
        stopReason: 'tool_use',
        usage: { inputTokens: 10, outputTokens: 30 },
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Found 5 files in the directory.' }],
        stopReason: 'end_turn',
        usage: { inputTokens: 50, outputTokens: 40 },
      });

    const agentLoop = new AgentLoop({
      provider: mockProvider,
      tools: mockToolRegistry as any,
      executor: mockExecutor as any,
      model: 'test-model',
      systemPrompt: 'You are a helpful assistant',
      maxIterations: 5,
    });

    const result = await agentLoop.run('List files in current directory');

    expect(result.finalText).toContain('Found');
    expect(result.iterations).toBe(2);
    expect(mockExecutor.exec).toHaveBeenCalledWith('bash', { command: 'ls -la' });
  });

  it('should respect maxIterations limit', async () => {
    mockProvider.complete = vi.fn().mockResolvedValue({
      content: [
        { type: 'tool_use', id: 'tool-1', name: 'bash', input: { command: 'ls' } },
      ],
      stopReason: 'tool_use',
      usage: { inputTokens: 10, outputTokens: 30 },
    });

    const agentLoop = new AgentLoop({
      provider: mockProvider,
      tools: mockToolRegistry as any,
      executor: mockExecutor as any,
      model: 'test-model',
      systemPrompt: 'You are a helpful assistant',
      maxIterations: 2,
    });

    const result = await agentLoop.run('Run infinite loop');

    expect(result.iterations).toBeLessThanOrEqual(2);
  });

  it('should handle errors gracefully', async () => {
    mockProvider.complete = vi.fn().mockRejectedValue(new Error('API Error'));

    const agentLoop = new AgentLoop({
      provider: mockProvider,
      tools: mockToolRegistry as any,
      executor: mockExecutor as any,
      model: 'test-model',
      systemPrompt: 'You are a helpful assistant',
      maxIterations: 5,
    });

    await expect(agentLoop.run('Test error')).rejects.toThrow('API Error');
  });

  it('should extract text from content parts correctly', async () => {
    mockProvider.complete = vi.fn().mockResolvedValue({
      content: [
        { type: 'text', text: 'First part' },
        { type: 'text', text: 'Second part' },
      ],
      stopReason: 'end_turn',
      usage: { inputTokens: 10, outputTokens: 20 },
    });

    const agentLoop = new AgentLoop({
      provider: mockProvider,
      tools: mockToolRegistry as any,
      executor: mockExecutor as any,
      model: 'test-model',
      systemPrompt: 'You are a helpful assistant',
      maxIterations: 5,
    });

    const result = await agentLoop.run('Test multiple text parts');

    expect(result.finalText).toContain('First part');
    expect(result.finalText).toContain('Second part');
  });
});
