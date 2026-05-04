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
    'Save an API key for a provider. By default APPENDS a new key slot so you can stack multiple keys for the same provider (chat_failover round-robins through them). Pass `index` to replace an existing slot, or `replaceAll: true` to wipe all existing slots and start fresh.',
    {
      provider: z.enum(PROVIDER_IDS),
      value: z.string().min(8),
      index: z.number().int().min(0).optional(),
      replaceAll: z.boolean().optional(),
      label: z.string().max(64).optional(),
    },
    async ({ provider, value, index, replaceAll, label }) => {
      const desc = findProvider(provider);
      if (!desc) return err(`unknown provider: ${provider}`);
      const validation = desc.validate(value);
      if (validation) return err(`invalid key for ${provider}: ${validation}`);
      let rec;
      if (replaceAll) {
        rec = await deps.keys.set(provider, value, actor);
      } else if (typeof index === 'number') {
        try {
          rec = await deps.keys.replace(provider, index, value, actor, label);
        } catch (e) {
          return err((e as Error).message);
        }
      } else {
        rec = await deps.keys.add(provider, value, actor, label);
      }
      const status = toPublicStatus(rec, provider, deps.masterKey);
      return ok({
        ok: true,
        provider,
        slotCount: status.count,
        slots: status.slots,
      });
    },
  );

  server.tool(
    'delete_api_key',
    'Remove a stored API key. Pass `index` to drop a single slot from the rotation; omit it to wipe every slot for the provider.',
    {
      provider: z.enum(PROVIDER_IDS),
      index: z.number().int().min(0).optional(),
    },
    async ({ provider, index }) => {
      const removed = await deps.keys.delete(provider, index);
      const rec = await deps.keys.get(provider);
      const status = toPublicStatus(rec, provider, deps.masterKey);
      return ok({ ok: removed, provider, slotCount: status.count, slots: status.slots });
    },
  );

  server.tool(
    'test_api_key',
    'Run a live liveness check against a stored key. Pass `index` to test a single slot; omit it to test every slot for the provider in order. Returns one record per slot.',
    {
      provider: z.enum(PROVIDER_IDS),
      index: z.number().int().min(0).optional(),
    },
    async ({ provider, index }) => {
      const desc = findProvider(provider);
      if (!desc) return err(`unknown provider: ${provider}`);
      if (!desc.testKey) return err(`provider ${provider} does not support live testing`);
      const all = await deps.keys.decryptAll(provider);
      if (all.length === 0) return err(`no key configured for ${provider}`);
      const target = typeof index === 'number'
        ? all.filter((s) => s.index === index)
        : all;
      if (target.length === 0) return err(`slot ${index} does not exist for ${provider}`);
      const results: Array<{ index: number; ok: boolean; note: string }> = [];
      for (const slot of target) {
        try {
          const r = await desc.testKey(slot.key);
          await deps.keys.recordTest(provider, r, slot.index);
          results.push({ index: slot.index, ok: r.ok, note: r.note });
        } catch (e) {
          const note = (e as Error).message.slice(0, 200);
          await deps.keys.recordTest(provider, { ok: false, note }, slot.index);
          results.push({ index: slot.index, ok: false, note });
        }
      }
      return ok({ provider, results });
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

      const attempts: Array<{ provider: FailoverProvider; keyIndex: number; ok: boolean; reason?: string }> = [];

      for (const provider of order) {
        const slots = await deps.keys.decryptAll(provider);
        if (slots.length === 0) {
          attempts.push({ provider, keyIndex: -1, ok: false, reason: 'no_key' });
          continue;
        }
        // Walk every key for this provider before falling through to the next.
        // Quota / 402 / 429 typically affect a single key, not the account, so
        // a stack of five DeepSeek keys can absorb a lot of failures before we
        // actually need to switch providers.
        let providerSucceeded = false;
        for (const slot of slots) {
          try {
            const text = await callProvider(provider, slot.key, {
              prompt,
              system,
              maxOutputTokens: maxOutputTokens ?? 1024,
              temperature: temperature ?? 0.7,
            });
            attempts.push({ provider, keyIndex: slot.index, ok: true });
            return ok({ ok: true, provider, keyIndex: slot.index, text, attempts });
          } catch (e) {
            const reason = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
            attempts.push({ provider, keyIndex: slot.index, ok: false, reason });
            continue;
          }
        }
        if (providerSucceeded) break;
      }

      return ok({ ok: false, error: 'all_providers_failed', attempts });
    },
  );

  // Two-stage chat: a `thinker` provider drafts a plan, then an `executor`
  // provider produces the final answer using that plan as extra context.
  // Each stage runs through the same multi-key + provider failover loop as
  // chat_failover so it keeps going as long as ANY key for any backup
  // provider is still alive.
  server.tool(
    'chat_pipeline',
    'Chain two LLMs: a thinker plans/decomposes the task, and an executor produces the final answer using that plan. Each stage rotates through every stored key for its primary provider, then falls back to the configured providers list. Use this for tasks where you want one model to reason and another to write — e.g. DeepSeek thinks, Gemini writes.',
    {
      prompt: z.string().min(1),
      thinker: z.enum(FAILOVER_PROVIDERS).optional(),
      executor: z.enum(FAILOVER_PROVIDERS).optional(),
      thinkerSystem: z.string().optional(),
      executorSystem: z.string().optional(),
      providers: z.array(z.enum(FAILOVER_PROVIDERS)).optional(),
      maxOutputTokens: z.number().int().min(1).max(4096).optional(),
      temperature: z.number().min(0).max(2).optional(),
    },
    async (args) => {
      const fallback = args.providers && args.providers.length
        ? [...new Set(args.providers)]
        : [...FAILOVER_PROVIDERS];

      // Build the per-stage provider order: primary choice first, then the
      // remaining failover providers in their default order. De-duped.
      const orderFor = (primary?: FailoverProvider): FailoverProvider[] => {
        const seen = new Set<FailoverProvider>();
        const out: FailoverProvider[] = [];
        if (primary) {
          out.push(primary);
          seen.add(primary);
        }
        for (const p of fallback) {
          if (!seen.has(p)) {
            out.push(p);
            seen.add(p);
          }
        }
        return out;
      };

      type Attempt = { stage: 'thinker' | 'executor'; provider: FailoverProvider; keyIndex: number; ok: boolean; reason?: string };
      const attempts: Attempt[] = [];

      const runStage = async (
        stage: 'thinker' | 'executor',
        primary: FailoverProvider | undefined,
        system: string,
        userPrompt: string,
      ): Promise<{ provider: FailoverProvider; keyIndex: number; text: string } | null> => {
        for (const provider of orderFor(primary)) {
          const slots = await deps.keys.decryptAll(provider);
          if (slots.length === 0) {
            attempts.push({ stage, provider, keyIndex: -1, ok: false, reason: 'no_key' });
            continue;
          }
          for (const slot of slots) {
            try {
              const text = await callProvider(provider, slot.key, {
                prompt: userPrompt,
                system,
                maxOutputTokens: args.maxOutputTokens ?? 1024,
                temperature: args.temperature ?? 0.7,
              });
              attempts.push({ stage, provider, keyIndex: slot.index, ok: true });
              return { provider, keyIndex: slot.index, text };
            } catch (e) {
              const reason = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
              attempts.push({ stage, provider, keyIndex: slot.index, ok: false, reason });
            }
          }
        }
        return null;
      };

      const thinkerSystem = args.thinkerSystem
        ?? 'You are a senior planner. Read the user task carefully and produce a tight, numbered plan an executor LLM can follow. Keep it under 12 steps. Do NOT solve the task yet — just plan.';
      const thinkerOut = await runStage('thinker', args.thinker, thinkerSystem, args.prompt);
      if (!thinkerOut) {
        return ok({ ok: false, error: 'thinker_failed', attempts });
      }

      const executorSystem = args.executorSystem
        ?? 'You are an executor. Follow the provided plan and produce the final answer to the user task. Be concise and direct.';
      const executorPrompt = `Task:\n${args.prompt}\n\nPlan:\n${thinkerOut.text}\n\nFinal answer:`;
      const executorOut = await runStage('executor', args.executor, executorSystem, executorPrompt);
      if (!executorOut) {
        return ok({
          ok: false,
          error: 'executor_failed',
          thinker: thinkerOut,
          attempts,
        });
      }

      return ok({
        ok: true,
        thinker: thinkerOut,
        executor: executorOut,
        attempts,
      });
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
