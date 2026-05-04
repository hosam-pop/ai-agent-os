// Admin operations exposed to the Manager Agent as MCP tools.
//
// The agent calls these tools through the `admin-ops` MCP server registered in
// deploy/librechat/librechat.yaml. Bearer-auth via ADMIN_MCP_TOKEN keeps the
// surface scoped to the LibreChat agents host. The capability gate is the
// existing `admin.manage` flag in /admin/keys: turn it OFF and agent-sync
// strips the tool name out of the seeded Manager doc on next save.
//
// Tool surface mirrors what /admin/keys offers from the UI:
//   list_api_keys, set_api_key, delete_api_key, test_api_key
//   list_users, create_user, delete_user, set_user_password
//   grant_role, revoke_role
//   list_agent_capabilities, set_agent_capability
//
// Each tool returns a small JSON-friendly object; secrets are NEVER echoed
// back, only mask previews.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import type { KeysStore, PublicKeyStatus } from './keys-store.js';
import { toPublicStatus } from './keys-store.js';
import type { KeycloakAdmin } from './keycloak-admin.js';
import type { PoliciesStore, CapabilityId } from './policies-store.js';
import { CAPABILITIES } from './policies-store.js';
import { findProvider, PROVIDERS, type ProviderId } from './providers.js';
import { syncAgentToolsToMongo, MANAGER_AGENT_ID } from './agent-sync.js';

export interface AdminMcpDeps {
  keys: KeysStore;
  keycloak: KeycloakAdmin;
  policies: PoliciesStore;
  masterKey: string;
  librechatMongoUri?: string;
  managerAgentId?: string;
}

const PROVIDER_IDS = PROVIDERS.map(p => p.id) as [ProviderId, ...ProviderId[]];
const CAPABILITY_IDS = CAPABILITIES.map(c => c.id) as [CapabilityId, ...CapabilityId[]];

function ok(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
}

function err(message: string) {
  return { isError: true, content: [{ type: 'text' as const, text: message }] };
}

export function buildAdminMcpServer(deps: AdminMcpDeps): McpServer {
  const server = new McpServer(
    { name: 'admin-ops', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  const actor = 'agent:manager';

  server.tool(
    'list_api_keys',
    'List every provider managed by the admin panel and whether each key is configured. Never returns the secret values.',
    async () => {
      const list = await deps.keys.list();
      const byProvider = new Map(list.map(r => [r.provider, r] as const));
      const statuses: PublicKeyStatus[] = PROVIDERS.map(p =>
        toPublicStatus(byProvider.get(p.id) ?? null, p.id, deps.masterKey),
      );
      return ok({ providers: PROVIDERS.map(p => ({ id: p.id, label: p.label })), statuses });
    },
  );

  server.tool(
    'set_api_key',
    'Save (or replace) the API key for a provider. The key is stored encrypted at rest. Pass the raw secret as `value`.',
    {
      provider: z.enum(PROVIDER_IDS),
      value: z.string().min(8),
    },
    async ({ provider, value }) => {
      const desc = findProvider(provider);
      if (!desc) return err(`unknown provider: ${provider}`);
      const validation = desc.validate(value);
      if (validation) return err(`invalid key for ${provider}: ${validation}`);
      const rec = await deps.keys.set(provider, value, actor);
      return ok({
        ok: true,
        provider,
        updatedAt: rec.updatedAt,
        preview: toPublicStatus(rec, provider, deps.masterKey).preview,
      });
    },
  );

  server.tool(
    'delete_api_key',
    'Remove the stored API key for a provider.',
    { provider: z.enum(PROVIDER_IDS) },
    async ({ provider }) => {
      const removed = await deps.keys.delete(provider);
      return ok({ ok: removed, provider });
    },
  );

  server.tool(
    'test_api_key',
    'Run a live liveness check against the provider using the currently stored key. Returns `{ok, note}`.',
    { provider: z.enum(PROVIDER_IDS) },
    async ({ provider }) => {
      const desc = findProvider(provider);
      if (!desc) return err(`unknown provider: ${provider}`);
      if (!desc.testKey) return err(`provider ${provider} does not support live testing`);
      const plain = await deps.keys.decrypt(provider);
      if (!plain) return err(`no key configured for ${provider}`);
      const result = await desc.testKey(plain);
      await deps.keys.recordTest(provider, result);
      return ok({ provider, ...result });
    },
  );

  server.tool(
    'list_users',
    'List Keycloak users in the application realm. Optional `search` substring matches username/email/name.',
    { search: z.string().optional(), max: z.number().int().min(1).max(200).optional() },
    async ({ search, max }) => {
      const users = await deps.keycloak.listUsers({ search, max: max ?? 50 });
      return ok({ users });
    },
  );

  server.tool(
    'create_user',
    'Create a new Keycloak user. Default roles: agent-user. Pass `grantAdmin: true` to also assign the agent-admin role.',
    {
      username: z.string().min(3).max(64),
      password: z.string().min(8),
      email: z.string().email().optional(),
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      grantAdmin: z.boolean().optional(),
      temporaryPassword: z.boolean().optional(),
    },
    async ({ username, password, email, firstName, lastName, grantAdmin, temporaryPassword }) => {
      const realmRoles = ['agent-user'];
      if (grantAdmin) realmRoles.push('agent-admin');
      const user = await deps.keycloak.createUser({
        username,
        password,
        email,
        firstName,
        lastName,
        temporary: temporaryPassword ?? false,
        realmRoles,
        enabled: true,
      });
      return ok({ ok: true, user, roles: realmRoles });
    },
  );

  server.tool(
    'delete_user',
    'Delete a Keycloak user by id.',
    { userId: z.string().min(1) },
    async ({ userId }) => {
      await deps.keycloak.deleteUser(userId);
      return ok({ ok: true, userId });
    },
  );

  server.tool(
    'set_user_password',
    'Reset a user password. Pass `temporary: true` to force change on next login.',
    { userId: z.string().min(1), password: z.string().min(8), temporary: z.boolean().optional() },
    async ({ userId, password, temporary }) => {
      await deps.keycloak.resetPassword(userId, password, temporary ?? false);
      return ok({ ok: true, userId });
    },
  );

  server.tool(
    'grant_role',
    'Assign one or more realm roles to a user (e.g. agent-admin, agent-auditor).',
    { userId: z.string().min(1), roles: z.array(z.string().min(1)).min(1) },
    async ({ userId, roles }) => {
      await deps.keycloak.assignRealmRoles(userId, roles);
      return ok({ ok: true, userId, roles });
    },
  );

  server.tool(
    'revoke_role',
    'Remove one or more realm roles from a user.',
    { userId: z.string().min(1), roles: z.array(z.string().min(1)).min(1) },
    async ({ userId, roles }) => {
      await deps.keycloak.removeRealmRoles(userId, roles);
      return ok({ ok: true, userId, roles });
    },
  );

  server.tool(
    'list_agent_capabilities',
    'Return the per-agent capability matrix used by /admin/keys. Pass `agentId` to filter to a single agent.',
    { agentId: z.string().optional() },
    async ({ agentId }) => {
      const doc = await deps.policies.load();
      const out = agentId ? doc.agents.filter(a => a.agentId === agentId) : doc.agents;
      return ok({ catalog: CAPABILITIES, agents: out });
    },
  );

  server.tool(
    'set_agent_capability',
    'Toggle a single capability on or off for an agent. Changes are persisted AND synced to LibreChat MongoDB so the runtime tool list updates immediately.',
    {
      agentId: z.string().default('manager'),
      capability: z.enum(CAPABILITY_IDS),
      enabled: z.boolean(),
    },
    async ({ agentId, capability, enabled }) => {
      const doc = await deps.policies.setAgentCapabilities(agentId, { [capability]: enabled });
      const policy = doc.agents.find(a => a.agentId === agentId);
      let sync: unknown = { skipped: 'not_synced' };
      if (policy) {
        sync = await syncAgentToolsToMongo({
          mongoUri: deps.librechatMongoUri,
          policy,
          agentId: deps.managerAgentId ?? MANAGER_AGENT_ID,
        });
      }
      return ok({ ok: true, agentId, capability, enabled, sync });
    },
  );

  // Auto-failover chat completion. Tries the configured providers in order
  // (default Gemini → DeepSeek → OpenAI → Anthropic) and falls back on quota
  // / 429 / auth / connectivity errors. The agent uses this when its primary
  // model runs out of quota mid-task and it needs to keep going on a backup
  // key without interrupting the conversation.
  const FAILOVER_PROVIDERS = ['gemini', 'deepseek', 'openai', 'anthropic'] as const;
  type FailoverProvider = (typeof FAILOVER_PROVIDERS)[number];

  server.tool(
    'chat_failover',
    'Send a single prompt to the first available chat provider, automatically falling back through the configured providers when quota/auth fails. Returns the first successful answer plus a per-provider attempt log.',
    {
      prompt: z.string().min(1),
      system: z.string().optional(),
      providers: z.array(z.enum(FAILOVER_PROVIDERS)).optional(),
      maxOutputTokens: z.number().int().min(1).max(4096).optional(),
      temperature: z.number().min(0).max(2).optional(),
    },
    async ({ prompt, system, providers, maxOutputTokens, temperature }) => {
      const order: FailoverProvider[] = providers && providers.length
        ? [...new Set(providers)]
        : [...FAILOVER_PROVIDERS];

      const attempts: Array<{ provider: FailoverProvider; ok: boolean; reason?: string }> = [];

      for (const provider of order) {
        const key = await deps.keys.decrypt(provider);
        if (!key) {
          attempts.push({ provider, ok: false, reason: 'no_key' });
          continue;
        }
        try {
          const text = await callProvider(provider, key, {
            prompt,
            system,
            maxOutputTokens: maxOutputTokens ?? 1024,
            temperature: temperature ?? 0.7,
          });
          attempts.push({ provider, ok: true });
          return ok({ ok: true, provider, text, attempts });
        } catch (e) {
          const reason = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
          attempts.push({ provider, ok: false, reason });
          // Try the next provider in order on any error.
          continue;
        }
      }

      return ok({ ok: false, error: 'all_providers_failed', attempts });
    },
  );

  return server;
}

// Per-provider chat call that throws on any non-2xx so chat_failover can move
// to the next backend. Each branch hits the provider's smallest, cheapest chat
// endpoint — we don't try to expose every option, this tool is for resilience
// not for fine-tuned generation.
async function callProvider(
  provider: 'gemini' | 'deepseek' | 'openai' | 'anthropic',
  key: string,
  input: { prompt: string; system?: string; maxOutputTokens: number; temperature: number },
): Promise<string> {
  const ctrl = new AbortController();
  const timeoutId = setTimeout(() => ctrl.abort(), 30_000);
  try {
    if (provider === 'gemini') {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(key)}`;
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: input.prompt }] }],
          ...(input.system ? { systemInstruction: { parts: [{ text: input.system }] } } : {}),
          generationConfig: {
            temperature: input.temperature,
            maxOutputTokens: input.maxOutputTokens,
          },
        }),
        signal: ctrl.signal,
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text().catch(() => '')}`);
      const data = (await r.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      const text = data.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('') ?? '';
      if (!text) throw new Error('empty response');
      return text;
    }

    if (provider === 'deepseek' || provider === 'openai') {
      const base = provider === 'deepseek' ? 'https://api.deepseek.com/v1' : 'https://api.openai.com/v1';
      const model = provider === 'deepseek' ? 'deepseek-chat' : 'gpt-4o-mini';
      const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
      if (input.system) messages.push({ role: 'system', content: input.system });
      messages.push({ role: 'user', content: input.prompt });
      const r = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          messages,
          temperature: input.temperature,
          max_tokens: input.maxOutputTokens,
        }),
        signal: ctrl.signal,
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text().catch(() => '')}`);
      const data = (await r.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const text = data.choices?.[0]?.message?.content ?? '';
      if (!text) throw new Error('empty response');
      return text;
    }

    if (provider === 'anthropic') {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-3-5-haiku-latest',
          max_tokens: input.maxOutputTokens,
          temperature: input.temperature,
          ...(input.system ? { system: input.system } : {}),
          messages: [{ role: 'user', content: input.prompt }],
        }),
        signal: ctrl.signal,
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text().catch(() => '')}`);
      const data = (await r.json()) as { content?: Array<{ type: string; text?: string }> };
      const text = (data.content ?? []).filter(c => c.type === 'text').map(c => c.text ?? '').join('');
      if (!text) throw new Error('empty response');
      return text;
    }

    throw new Error(`unsupported provider: ${provider}`);
  } finally {
    clearTimeout(timeoutId);
  }
}

// Mounts the admin MCP transport at `POST /admin-mcp`. Stateless mode keeps
// each request self-contained, matching how the sandbox MCP is wired.
export async function registerAdminMcpRoute(
  app: FastifyInstance,
  opts: { deps: AdminMcpDeps; bearerToken: string | undefined; mountPath?: string },
): Promise<void> {
  const path = opts.mountPath ?? '/admin-mcp';
  if (!opts.bearerToken) {
    app.log.warn(`admin MCP disabled (set ADMIN_MCP_TOKEN to enable on ${path})`);
    return;
  }
  const expected = opts.bearerToken;

  // POST handles JSON-RPC initialize/tools/list/tools/call. GET is used by
  // SSE clients to resume notifications; the LibreChat MCP client only POSTs
  // in stateless mode, but we accept GET too for interop.
  //
  // We build a fresh McpServer + transport pair *per request*. The MCP SDK's
  // McpServer stores the active transport on its internal Server instance
  // (see @modelcontextprotocol/sdk/dist/esm/shared/protocol.js), so reusing
  // the same server for two sequential requests throws "Already connected to
  // a transport" on the second connect(). Stateless HTTP means we re-bind
  // each call — this is also what the upstream Streamable HTTP example does.
  const handler = async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = String(req.headers.authorization ?? '');
    const presented = auth.toLowerCase().startsWith('bearer ')
      ? auth.slice(7).trim()
      : '';
    if (!presented || !constantTimeEq(presented, expected)) {
      reply.code(401).send({ error: 'unauthorized' });
      return;
    }
    const server = buildAdminMcpServer(opts.deps);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    reply.hijack();
    await server.connect(transport);
    try {
      await transport.handleRequest(req.raw, reply.raw, req.body);
    } finally {
      await transport.close().catch(() => {});
      await server.close().catch(() => {});
    }
  };

  app.post(path, handler);
  app.get(path, handler);
  app.delete(path, handler);
}

function constantTimeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
