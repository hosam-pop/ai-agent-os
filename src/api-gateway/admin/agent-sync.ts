// Sync agent permissions (admin-policies.json) to LibreChat MongoDB so that
// disabling a capability in the panel actually removes the matching runtime
// tool from the manager agent. Without this module the policy file is purely
// informational; with it, toggling a switch in /admin/keys propagates to the
// `tools` array of the seeded `agent_aios_manager` document so LibreChat
// stops exposing that tool to Gemini on the next conversation turn.

import { MongoClient } from 'mongodb';
import type { AgentPolicy } from './policies-store.js';
import { buildSystemPrompt } from './agent-prompt.js';

// LibreChat agent runtime resolves tool names in two ways:
//   1. First-class system tools — e.g. `web_search`, `execute_code`,
//      `file_search`, `artifacts`. These are bare identifiers.
//   2. MCP-backed tools — fully-qualified as `<tool>_mcp_<server>` where
//      `<server>` is the key from `mcpServers` in librechat.yaml. Anything
//      that is neither a system tool nor matches the `_mcp_` delimiter is
//      silently dropped by `loadAgentTools`/`filterAuthorizedTools`. That
//      was the bug behind "I can't reach admin-ops": the previous map sent
//      the bare server name (`admin_ops`) which fits neither category.
//
// MCP tool inventory below comes straight from the live servers:
//   code-sandbox: run_code, integrations_status, scrape_url, cli_run,
//                 github_call
//   admin-ops:    list_api_keys, set_api_key, delete_api_key, test_api_key,
//                 list_users, create_user, delete_user, set_user_password,
//                 grant_role, revoke_role, list_agent_capabilities,
//                 set_agent_capability
//   socraticode:  (stdio MCP — left empty until tool-list discovery is
//                  added; the capability still toggles the server on/off
//                  via librechat.yaml access checks.)
const D = '_mcp_';
export const CAPABILITY_TO_TOOLS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'web.search': ['web_search'],
  'shell.run': ['execute_code'],
  'code.read': ['file_search'],
  'sandbox.run': [
    `run_code${D}code-sandbox`,
    `integrations_status${D}code-sandbox`,
    `github_call${D}code-sandbox`,
  ],
  'web.scrape': [`scrape_url${D}code-sandbox`],
  'cli.run': [`cli_run${D}code-sandbox`],
  'code.review': [],
  'admin.manage': [
    `list_api_keys${D}admin-ops`,
    `set_api_key${D}admin-ops`,
    `delete_api_key${D}admin-ops`,
    `test_api_key${D}admin-ops`,
    `list_users${D}admin-ops`,
    `create_user${D}admin-ops`,
    `delete_user${D}admin-ops`,
    `set_user_password${D}admin-ops`,
    `grant_role${D}admin-ops`,
    `revoke_role${D}admin-ops`,
    `list_agent_capabilities${D}admin-ops`,
    `set_agent_capability${D}admin-ops`,
  ],
});

// Back-compat alias — older callers (and unit tests) imported a single-tool
// map. We expose the first tool from each list so the existing shape keeps
// working without forcing every caller to migrate.
export const CAPABILITY_TO_TOOL: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    Object.entries(CAPABILITY_TO_TOOLS)
      .map(([cap, tools]) => [cap, tools[0]])
      .filter(([, t]) => typeof t === 'string'),
  ) as Record<string, string>,
);

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
  instructionsChanged: boolean;
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
    const tools = CAPABILITY_TO_TOOLS[capId];
    if (!tools) continue;
    for (const t of tools) allowed.add(t);
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
    const before = await col.findOne<{ id: string; tools?: string[]; instructions?: string }>({ id: agentId });
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
    const instructionsBefore = typeof before.instructions === 'string' ? before.instructions : '';
    const instructionsAfter = buildSystemPrompt(opts.policy);
    const toolsChanged = !sameUnordered(toolsBefore, toolsAfter);
    const instructionsChanged = instructionsBefore !== instructionsAfter;
    const changed = toolsChanged || instructionsChanged;
    if (changed) {
      await col.updateOne(
        { id: agentId },
        { $set: { tools: toolsAfter, instructions: instructionsAfter, updatedAt: new Date() } },
      );
    }
    return { ok: true, agentId, toolsBefore, toolsAfter, instructionsChanged, changed };
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
