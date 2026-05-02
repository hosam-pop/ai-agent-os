import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ShortTermMemory } from '../../src/memory/short-term.js';
import type { ChatMessage } from '../../src/api/provider-interface.js';

describe('ShortTermMemory', () => {
  let memory: ShortTermMemory;

  beforeEach(() => {
    memory = new ShortTermMemory(100000);
  });

  it('should create an instance', () => {
    expect(memory).toBeDefined();
  });

  it('should append user message', () => {
    memory.append({ role: 'user', content: 'Hello' });
    const snapshot = memory.snapshot();

    expect(snapshot.length).toBe(1);
    expect(snapshot[0].role).toBe('user');
    expect(snapshot[0].content).toBe('Hello');
  });

  it('should append assistant message', () => {
    memory.append({ role: 'assistant', content: 'Hi there!' });
    const snapshot = memory.snapshot();

    expect(snapshot.length).toBe(1);
    expect(snapshot[0].role).toBe('assistant');
  });

  it('should append tool message', () => {
    memory.append({
      role: 'tool',
      content: [{ type: 'tool_result', tool_use_id: '1', content: 'result' }],
    });
    const snapshot = memory.snapshot();

    expect(snapshot.length).toBe(1);
    expect(snapshot[0].role).toBe('tool');
  });

  it('should count tokens correctly', () => {
    memory.append({ role: 'user', content: 'Test message' });

    expect(memory.tokenCount).toBeGreaterThan(0);
  });

  it('should check budget status', () => {
    const limitedMemory = new ShortTermMemory(100);
    limitedMemory.append({ role: 'user', content: 'A'.repeat(10000) });

    expect(limitedMemory.overBudget()).toBe(true);
  });

  it('should replace messages', () => {
    memory.append({ role: 'user', content: 'Original' });
    memory.append({ role: 'assistant', content: 'Response' });

    const newMessages: ChatMessage[] = [
      { role: 'user', content: 'Summary of conversation' },
    ];
    memory.replace(newMessages);

    const snapshot = memory.snapshot();
    expect(snapshot.length).toBe(1);
    expect(snapshot[0].content).toBe('Summary of conversation');
  });

  it('should snapshot messages correctly', () => {
    memory.append({ role: 'user', content: 'First' });
    memory.append({ role: 'assistant', content: 'Second' });
    memory.append({ role: 'user', content: 'Third' });

    const snapshot = memory.snapshot();

    expect(snapshot.length).toBe(3);
    expect(snapshot[0].content).toBe('First');
    expect(snapshot[1].content).toBe('Second');
    expect(snapshot[2].content).toBe('Third');
  });
});
