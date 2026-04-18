import { z } from 'zod';
import type { AIProvider } from '../api/provider-interface.js';
import { logger } from '../utils/logger.js';
import { DependencyGraph, type GraphNode } from './dependency-graph.js';

export interface SubTask {
  id: string;
  title: string;
  description: string;
  dependsOn: string[];
}

const SubTaskSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  dependsOn: z.array(z.string()).default([]),
});

const DecompositionSchema = z.object({
  tasks: z.array(SubTaskSchema).min(1),
});

const DECOMPOSITION_SYSTEM = `You are a task decomposition planner. Given a user goal,
produce a directed acyclic graph of small, concrete subtasks. Return ONLY JSON
matching this shape (no code fences):
{
  "tasks": [
    { "id": "t1", "title": "...", "description": "...", "dependsOn": [] }
  ]
}
Rules:
- Use stable ids "t1", "t2", ….
- Subtasks must be concrete enough to execute in 1–5 tool calls.
- Do not invent dependency ids that do not exist in the list.
- Do not include the root goal as a task.`;

function stripFences(text: string): string {
  return text
    .replace(/^\s*```(?:json)?/i, '')
    .replace(/```\s*$/, '')
    .trim();
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(stripFences(text));
  } catch {
    const match = stripFences(text).match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

export async function decompose(
  provider: AIProvider,
  goal: string,
  model: string,
): Promise<DependencyGraph<SubTask>> {
  const completion = await provider.complete({
    model,
    system: DECOMPOSITION_SYSTEM,
    maxTokens: 2000,
    messages: [{ role: 'user', content: `Goal:\n${goal}\n\nReturn the decomposition JSON.` }],
  });
  const text = completion.content
    .filter((p) => p.type === 'text')
    .map((p) => (p.type === 'text' ? p.text : ''))
    .join('\n');
  const parsed = tryParse(text);
  const valid = DecompositionSchema.safeParse(parsed);
  if (!valid.success) {
    logger.warn('decompose.fallback.single-task', { goal });
    const graph = new DependencyGraph<SubTask>();
    graph.add({
      id: 't1',
      value: { id: 't1', title: goal.slice(0, 64), description: goal, dependsOn: [] },
      dependsOn: [],
    });
    return graph;
  }
  const graph = new DependencyGraph<SubTask>();
  const allIds = new Set(valid.data.tasks.map((t) => t.id));
  for (const t of valid.data.tasks) {
    const cleanDeps = t.dependsOn.filter((d) => allIds.has(d) && d !== t.id);
    const node: GraphNode<SubTask> = {
      id: t.id,
      value: { id: t.id, title: t.title, description: t.description, dependsOn: cleanDeps },
      dependsOn: cleanDeps,
    };
    if (!graph.has(node.id)) graph.add(node);
  }
  try {
    graph.topological();
  } catch (err) {
    logger.warn('decompose.cycle.fallback', { error: String(err) });
    const flat = new DependencyGraph<SubTask>();
    flat.add({
      id: 't1',
      value: { id: 't1', title: goal.slice(0, 64), description: goal, dependsOn: [] },
      dependsOn: [],
    });
    return flat;
  }
  return graph;
}
