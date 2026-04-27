// Sync agent permissions (admin-policies.json) to LibreChat MongoDB so that
// disabling a capability in the panel actually removes the matching runtime
// tool from the manager agent. Without this module the policy file is purely
// informational; with it, toggling a switch in /admin/keys propagates to the
// `tools` array of the seeded `agent_aios_manager` document so LibreChat
// stops exposing that tool to Gemini on the next conversation turn.

import { MongoClient } from 'mongodb';
import type { AgentPolicy } from './policies-store.js';

// Map a policy capability id to a LibreChat-native tool name. Capabilities
// without an entry here are accepted and persisted, but have no runtime effect
// yet — they are placeholders for follow-up PRs (GitHub MCP, key-management
// MCP, shell sandbox MCP, …) that will register matching tools.
//
// LibreChat 1.2.x exposes the following first-class tool ids:
//   web_search, execute_code, file_search, artifacts, ocr, actions
// Of those, three line up directly with current capability ids.
export const CAPABILITY_TO_TOOL: Readonly<Record<string, string>> = Object.freeze({
  'web.search': 'web_search',
  'shell.run': 'execute_code',
  'code.read': 'file_search',
});

// Tools the manager agent should always carry regardless of policy. `artifacts`
// is a UX affordance (markdown/Mermaid/React rendering), not a privileged
// capability, so we never gate it.
const ALWAYS_ON_TOOLS: readonly string[] = ['artifacts'];

// Stable id used by deploy/librechat/scripts/seed-manager-agent.js. Keep these
// in sync.
export const MANAGER_AGENT_ID = 'agent_aios_manager';

// LibreChat persists agents in the `agents` collection under the `LibreChat`
// database. The seeded ManagerAgent doc has shape { id, name, tools[], … }.
const LIBRECHAT_DB = 'LibreChat';
const AGENTS_COLLECTION = 'agents';

export interface AgentSyncOk {
  ok: true;
  agentId: string;
  toolsBefore: string[];
  toolsAfter: string[];
  changed: boolean;
}

export interface AgentSyncSkipped {
  ok: false;
  agentId: string;
  reason: 'no_mongo_uri' | 'agent_not_found' | 'connect_failed' | 'update_failed';
  message: string;
  toolsAfter: string[];
}

export type AgentSyncResult = AgentSyncOk | AgentSyncSkipped;

export function computeEffectiveTools(policy: AgentPolicy): string[] {
  const allowed = new Set<string>(ALWAYS_ON_TOOLS);
  for (const [capId, on] of Object.entries(policy.capabilities)) {
    if (!on) continue;
    const tool = CAPABILITY_TO_TOOL[capId];
    if (tool) allowed.add(tool);
  }
  return [...allowed].sort();
}

export interface AgentSyncOptions {
  mongoUri: string | undefined;
  policy: AgentPolicy;
  agentId?: string;
  // Test seam: lets unit tests inject an in-memory MongoClient.
  clientFactory?: (uri: string) => MongoClient;
  // Connect+select timeout, defaults to 5s so a stalled mongo never blocks the
  // admin save path for long.
  serverSelectionTimeoutMS?: number;
}

export async function syncAgentToolsToMongo(opts: AgentSyncOptions): Promise<AgentSyncResult> {
  const agentId = opts.agentId ?? MANAGER_AGENT_ID;
  const toolsAfter = computeEffectiveTools(opts.policy);
  if (!opts.mongoUri) {
    return {
      ok: false,
      agentId,
      reason: 'no_mongo_uri',
      message: 'LIBRECHAT_MONGO_URI not configured; runtime tool-gating disabled (policy still saved on volume)',
      toolsAfter,
    };
  }

  const client = opts.clientFactory
    ? opts.clientFactory(opts.mongoUri)
    : new MongoClient(opts.mongoUri, { serverSelectionTimeoutMS: opts.serverSelectionTimeoutMS ?? 5000 });

  try {
    await client.connect();
    const col = client.db(LIBRECHAT_DB).collection(AGENTS_COLLECTION);
    const before = await col.findOne<{ id: string; tools?: string[] }>({ id: agentId });
    if (!before) {
      return {
        ok: false,
        agentId,
        reason: 'agent_not_found',
        message: `agent ${agentId} not found in MongoDB; seed it via seed-manager-agent.js`,
        toolsAfter,
      };
    }
    const toolsBefore = Array.isArray(before.tools) ? [...before.tools] : [];
    const changed = !sameUnordered(toolsBefore, toolsAfter);
    if (changed) {
      await col.updateOne(
        { id: agentId },
        { $set: { tools: toolsAfter, updatedAt: new Date() } },
      );
    }
    return { ok: true, agentId, toolsBefore, toolsAfter, changed };
  } catch (err) {
    return {
      ok: false,
      agentId,
      reason: 'connect_failed',
      message: err instanceof Error ? err.message : String(err),
      toolsAfter,
    };
  } finally {
    await client.close().catch(() => {});
  }
}

function sameUnordered(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  for (let i = 0; i < sa.length; i++) {
    if (sa[i] !== sb[i]) return false;
  }
  return true;
}
