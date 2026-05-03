// Persistent agent-permission policies for the /admin/keys panel.
//
// Each agent (currently just "manager" — the LibreChat Manager Agent) has a
// flat capability map: { 'keys.write': true, 'code.commit': false, ... }.
// The file lives next to the encrypted keys store on the Fly volume so it
// survives deploys. Enforcement of these flags lives in the agent runtime
// (see src/tools/admin-tool.ts) — this module is just persistence.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export const CAPABILITIES = [
  // API key management
  { id: 'keys.read', label: 'View API keys', group: 'keys' },
  { id: 'keys.write', label: 'Add or update API keys', group: 'keys' },
  { id: 'keys.delete', label: 'Delete API keys', group: 'keys' },
  { id: 'keys.test', label: 'Run live test on API keys', group: 'keys' },
  // Code editing
  { id: 'code.read', label: 'Read repository files', group: 'code' },
  { id: 'code.write', label: 'Edit repository files', group: 'code' },
  { id: 'code.commit', label: 'Commit changes to git', group: 'code' },
  { id: 'code.pr', label: 'Open or update GitHub pull requests', group: 'code' },
  // User management
  { id: 'users.read', label: 'View users', group: 'users' },
  { id: 'users.invite', label: 'Invite or create new users', group: 'users' },
  // Runtime
  { id: 'shell.run', label: 'Execute shell commands in sandbox', group: 'runtime' },
  { id: 'web.search', label: 'Run web searches', group: 'runtime' },
  { id: 'web.fetch', label: 'Fetch arbitrary URLs', group: 'runtime' },
  { id: 'web.scrape', label: 'Scrape JS-rendered pages (Scrapling)', group: 'runtime' },
  { id: 'cli.run', label: 'Drive websites/CLIs through OpenCLI adapters', group: 'runtime' },
  { id: 'code.review', label: 'Index + reason about repos (SocratiCode)', group: 'runtime' },
  { id: 'sandbox.run', label: 'Run code in execution sandbox', group: 'runtime' },
  // Admin self-service from chat
  { id: 'admin.manage', label: 'Manage keys, users, and permissions from chat', group: 'admin' },
] as const;

export type CapabilityId = (typeof CAPABILITIES)[number]['id'];

export interface AgentPolicy {
  agentId: string;
  label: string;
  capabilities: Partial<Record<CapabilityId, boolean>>;
}

export interface PolicyDocument {
  version: 1;
  updatedAt: string;
  agents: AgentPolicy[];
}

const DEFAULT_AGENTS: AgentPolicy[] = [
  {
    agentId: 'manager',
    label: 'AI Agent OS Manager',
    capabilities: {
      'keys.read': true,
      'keys.write': false,
      'keys.delete': false,
      'keys.test': true,
      'code.read': true,
      'code.write': false,
      'code.commit': false,
      'code.pr': false,
      'users.read': true,
      'users.invite': false,
      'shell.run': false,
      'web.search': true,
      'web.fetch': true,
      // Powerful capabilities — enabled by default so the manager agent can
      // act on chat-issued instructions immediately. Disable individual
      // entries from /admin/keys → Agent Permissions if you want to lock the
      // surface back down.
      'web.scrape': true,
      'cli.run': true,
      'code.review': true,
      'sandbox.run': true,
      'admin.manage': true,
    },
  },
];

export interface PoliciesStore {
  load(): Promise<PolicyDocument>;
  save(doc: PolicyDocument): Promise<PolicyDocument>;
  setAgentCapabilities(agentId: string, caps: Partial<Record<CapabilityId, boolean>>): Promise<PolicyDocument>;
}

export function createFilePoliciesStore(filePath: string): PoliciesStore {
  return {
    async load(): Promise<PolicyDocument> {
      try {
        const raw = await readFile(filePath, 'utf8');
        const parsed = JSON.parse(raw) as PolicyDocument;
        if (parsed && parsed.version === 1 && Array.isArray(parsed.agents)) {
          // Backfill any agents that should always exist.
          for (const def of DEFAULT_AGENTS) {
            if (!parsed.agents.find(a => a.agentId === def.agentId)) {
              parsed.agents.push(def);
            }
          }
          return parsed;
        }
      } catch {
        // fall through to default
      }
      return {
        version: 1,
        updatedAt: new Date().toISOString(),
        agents: DEFAULT_AGENTS.map(a => ({ ...a, capabilities: { ...a.capabilities } })),
      };
    },
    async save(doc: PolicyDocument): Promise<PolicyDocument> {
      const out: PolicyDocument = {
        version: 1,
        updatedAt: new Date().toISOString(),
        agents: doc.agents,
      };
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, JSON.stringify(out, null, 2), { encoding: 'utf8', mode: 0o600 });
      return out;
    },
    async setAgentCapabilities(agentId, caps) {
      const doc = await this.load();
      const idx = doc.agents.findIndex(a => a.agentId === agentId);
      if (idx === -1) {
        throw new Error(`unknown agent: ${agentId}`);
      }
      doc.agents[idx]!.capabilities = { ...doc.agents[idx]!.capabilities, ...caps };
      return this.save(doc);
    },
  };
}
