import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AdminAuth, AdminSession, buildAdminAuth } from './admin-auth.js';
import { renderAdminKeysPage } from './admin-page.js';
import { KeycloakAdmin } from './keycloak-admin.js';
import { createFileKeysStore, KeysStore, toPublicStatus } from './keys-store.js';
import { CAPABILITIES, createFilePoliciesStore, PolicyDocument } from './policies-store.js';
import {
  CAPABILITY_TO_TOOL,
  computeEffectiveTools,
  MANAGER_AGENT_ID,
  syncAgentToolsToMongo,
} from './agent-sync.js';
import { findProvider, PROVIDERS } from './providers.js';

export interface AdminKeysRoutesOptions {
  // Master encryption key. Required to enable the panel.
  masterKey: string | undefined;
  // Keycloak issuer URL (used both for ROPC login + admin REST calls).
  keycloakIssuer: string | undefined;
  // Confidential client used for ROPC + service-account admin calls.
  keycloakAdminClientId: string | undefined;
  keycloakAdminClientSecret: string | undefined;
  // Path to the encrypted JSON store. Defaults to /data/admin-keys.json.
  storePath?: string;
  // Path to the agent-policy JSON. Defaults to /data/admin-policies.json.
  policiesPath?: string;
  // Whether to set the Secure flag on session cookies. Defaults to true.
  secureCookie?: boolean;
  // Realm role required to use the panel. Defaults to 'agent-admin'.
  requiredRole?: string;
  // Optional LibreChat MongoDB URI. When set, capability changes are pushed
  // into the seeded manager agent's `tools` array so disabling a capability
  // actually removes the matching tool from the LibreChat runtime.
  librechatMongoUri?: string;
  // Optional manager agent id (defaults to the seeded `agent_aios_manager`).
  managerAgentId?: string;
}

const DEFAULT_STORE_PATH = '/data/admin-keys.json';
const DEFAULT_POLICIES_PATH = '/data/admin-policies.json';

export async function registerAdminKeysRoutes(
  app: FastifyInstance,
  opts: AdminKeysRoutesOptions,
): Promise<void> {
  const masterKey = opts.masterKey;
  const issuer = opts.keycloakIssuer;
  const adminClientId = opts.keycloakAdminClientId;
  const adminClientSecret = opts.keycloakAdminClientSecret;

  if (!masterKey || !issuer || !adminClientId || !adminClientSecret) {
    app.log.warn(
      'admin keys panel disabled (set KEYS_MASTER_KEY + KEYCLOAK_ISSUER + KEYCLOAK_ADMIN_BRIDGE_CLIENT_ID + KEYCLOAK_ADMIN_BRIDGE_SECRET to enable)',
    );
    app.get('/admin/keys', async (_req, reply) => {
      reply.code(503).type('text/html').send(renderDisabledPage());
    });
    return;
  }

  const keycloak = new KeycloakAdmin({
    issuer,
    clientId: adminClientId,
    clientSecret: adminClientSecret,
  });
  const auth = buildAdminAuth({
    sessionKey: masterKey,
    keycloak,
    secureCookie: opts.secureCookie ?? true,
    requiredRole: opts.requiredRole ?? 'agent-admin',
  });
  const store = createFileKeysStore({
    filePath: opts.storePath ?? DEFAULT_STORE_PATH,
    masterKey,
  });
  const policies = createFilePoliciesStore(opts.policiesPath ?? DEFAULT_POLICIES_PATH);

  // Allow inline <style>, <script>, Cairo from Google Fonts only on /admin/keys.
  // Every other route keeps the strict default-src 'self' policy.
  const adminPageCsp = [
    "default-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "script-src 'self' 'unsafe-inline'",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
  ].join('; ');

  app.get('/admin/keys', async (req, reply) => {
    const session = auth.validateSessionFromRequest(req);
    reply
      .type('text/html')
      .header('cache-control', 'no-store, max-age=0')
      .header('Content-Security-Policy', adminPageCsp)
      .send(
        renderAdminKeysPage({
          signedIn: session.ok,
          username: session.session?.username,
          email: session.session?.email,
        }),
      );
  });

  // POST /admin/keys/api/login — username + password -> session cookie
  app.post('/admin/keys/api/login', async (req, reply) => {
    const body = parseJSONBody(req);
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!username || !password) {
      return reply.code(400).send({ error: 'invalid_request', message: 'username and password are required' });
    }
    const outcome = await auth.loginWithPassword(username, password);
    if (!outcome.ok || !outcome.session) {
      return reply.code(outcome.status ?? 401).send({
        error: outcome.status === 403 ? 'forbidden' : 'unauthorized',
        message: outcome.reason ?? 'login failed',
      });
    }
    auth.setSessionCookie(reply, outcome.session);
    reply.send({
      ok: true,
      expiresAt: outcome.session.expiresAt,
      session: {
        username: outcome.session.username,
        email: outcome.session.email,
        roles: outcome.session.roles,
      },
    });
  });

  app.post('/admin/keys/api/logout', async (_req, reply) => {
    auth.clearSessionCookie(reply);
    reply.send({ ok: true });
  });

  // The remaining /admin/keys/api/* routes require a valid admin session.
  app.addHook('onRequest', async (req, reply) => {
    const url = req.url.split('?')[0]!;
    if (!url.startsWith('/admin/keys/api/')) return;
    if (url === '/admin/keys/api/login' || url === '/admin/keys/api/logout') return;
    const session = auth.validateSessionFromRequest(req);
    if (!session.ok) {
      return reply.code(401).send({ error: 'unauthorized', message: session.reason ?? 'login required' });
    }
    (req as FastifyRequest & { adminSession?: AdminSession }).adminSession = session.session;
  });

  // ------- API keys CRUD -------
  app.get('/admin/keys/api/list', async (_req, reply) => {
    const items = await Promise.all(
      PROVIDERS.map(async p => {
        const rec = await store.get(p.id);
        return {
          id: p.id,
          label: p.label,
          hint: p.hint,
          greenAccent: !!p.greenAccent,
          status: toPublicStatus(rec, p.id, masterKey),
        };
      }),
    );
    reply.send({ providers: items });
  });

  app.post('/admin/keys/api/:provider', async (req: FastifyRequest, reply) => {
    const id = (req.params as { provider?: string }).provider ?? '';
    const provider = findProvider(id);
    if (!provider) {
      return reply.code(404).send({ error: 'not_found', message: `unknown provider: ${id}` });
    }
    const body = parseJSONBody(req);
    const value = typeof body.value === 'string' ? body.value.trim() : '';
    if (!value) {
      return reply.code(400).send({ error: 'invalid_request', message: 'value is required' });
    }
    const validationError = provider.validate(value);
    if (validationError) {
      return reply.code(400).send({ error: 'invalid_value', message: validationError });
    }
    const session = (req as FastifyRequest & { adminSession?: AdminSession }).adminSession;
    const rec = await store.set(provider.id, value, session?.username ?? 'admin');
    reply.send({ ok: true, status: toPublicStatus(rec, provider.id, masterKey) });
  });

  app.delete('/admin/keys/api/:provider', async (req, reply) => {
    const id = (req.params as { provider?: string }).provider ?? '';
    const provider = findProvider(id);
    if (!provider) {
      return reply.code(404).send({ error: 'not_found', message: `unknown provider: ${id}` });
    }
    await store.delete(provider.id);
    reply.send({ ok: true, status: toPublicStatus(null, provider.id, masterKey) });
  });

  app.post('/admin/keys/api/:provider/test', async (req, reply) => {
    const id = (req.params as { provider?: string }).provider ?? '';
    const provider = findProvider(id);
    if (!provider) {
      return reply.code(404).send({ error: 'not_found', message: `unknown provider: ${id}` });
    }
    const value = await store.decrypt(provider.id);
    if (!value) {
      return reply.code(400).send({ error: 'no_key', message: 'no key stored for this provider' });
    }
    if (!provider.testKey) {
      const status = await store.recordTest(provider.id, { ok: true, note: 'no live test available' });
      return reply.send({ ok: true, status: toPublicStatus(status, provider.id, masterKey) });
    }
    let result: { ok: boolean; note: string };
    try {
      result = await provider.testKey(value);
    } catch (err) {
      result = { ok: false, note: (err as Error).message.slice(0, 200) };
    }
    const rec = await store.recordTest(provider.id, result);
    reply.send({ ok: result.ok, status: toPublicStatus(rec, provider.id, masterKey) });
  });

  // ------- Account (current admin) -------
  app.get('/admin/keys/api/account', async (req, reply) => {
    const session = (req as FastifyRequest & { adminSession?: AdminSession }).adminSession!;
    reply.send({
      userId: session.userId,
      username: session.username,
      email: session.email,
      roles: session.roles,
      expiresAt: session.expiresAt,
    });
  });

  app.post('/admin/keys/api/account/password', async (req, reply) => {
    const session = (req as FastifyRequest & { adminSession?: AdminSession }).adminSession!;
    const body = parseJSONBody(req);
    const current = typeof body.currentPassword === 'string' ? body.currentPassword : '';
    const next = typeof body.newPassword === 'string' ? body.newPassword : '';
    if (!current || !next) {
      return reply.code(400).send({ error: 'invalid_request', message: 'currentPassword and newPassword are required' });
    }
    // Re-verify current password before allowing reset.
    const verify = await auth.loginWithPassword(session.username, current);
    if (!verify.ok) {
      return reply.code(401).send({ error: 'unauthorized', message: 'current password is wrong' });
    }
    try {
      await keycloak.resetPassword(session.userId, next, false);
    } catch (err) {
      return reply.code(400).send({ error: 'reset_failed', message: (err as Error).message });
    }
    reply.send({ ok: true });
  });

  // ------- Users CRUD (Keycloak Admin REST) -------
  app.get('/admin/keys/api/users', async (req, reply) => {
    try {
      const users = await keycloak.listUsers({ max: 100 });
      reply.send({ users });
    } catch (err) {
      reply.code(502).send({ error: 'keycloak_error', message: (err as Error).message });
    }
  });

  app.post('/admin/keys/api/users', async (req, reply) => {
    const body = parseJSONBody(req);
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const firstName = typeof body.firstName === 'string' ? body.firstName : undefined;
    const lastName = typeof body.lastName === 'string' ? body.lastName : undefined;
    const grantAdmin = body.grantAdmin === true;
    const temporary = body.temporary === true;
    if (!username || !password) {
      return reply.code(400).send({ error: 'invalid_request', message: 'username and password are required' });
    }
    try {
      const user = await keycloak.createUser({
        username,
        email: email || undefined,
        firstName,
        lastName,
        password,
        temporary,
        realmRoles: grantAdmin ? ['agent-admin', 'agent-user'] : ['agent-user'],
      });
      reply.send({ ok: true, user });
    } catch (err) {
      reply.code(400).send({ error: 'create_failed', message: (err as Error).message });
    }
  });

  app.delete('/admin/keys/api/users/:userId', async (req, reply) => {
    const session = (req as FastifyRequest & { adminSession?: AdminSession }).adminSession!;
    const userId = (req.params as { userId?: string }).userId ?? '';
    if (!userId) {
      return reply.code(400).send({ error: 'invalid_request', message: 'userId required' });
    }
    if (userId === session.userId) {
      return reply.code(400).send({ error: 'self_delete_blocked', message: 'cannot delete your own account from the panel' });
    }
    try {
      await keycloak.deleteUser(userId);
      reply.send({ ok: true });
    } catch (err) {
      reply.code(502).send({ error: 'keycloak_error', message: (err as Error).message });
    }
  });

  app.post('/admin/keys/api/users/:userId/password', async (req, reply) => {
    const userId = (req.params as { userId?: string }).userId ?? '';
    const body = parseJSONBody(req);
    const password = typeof body.password === 'string' ? body.password : '';
    const temporary = body.temporary === true;
    if (!userId || !password) {
      return reply.code(400).send({ error: 'invalid_request', message: 'userId and password required' });
    }
    try {
      await keycloak.resetPassword(userId, password, temporary);
      reply.send({ ok: true });
    } catch (err) {
      reply.code(400).send({ error: 'reset_failed', message: (err as Error).message });
    }
  });

  app.post('/admin/keys/api/users/:userId/roles', async (req, reply) => {
    const userId = (req.params as { userId?: string }).userId ?? '';
    const body = parseJSONBody(req);
    const grant = Array.isArray(body.grant) ? body.grant.filter((s): s is string => typeof s === 'string') : [];
    const revoke = Array.isArray(body.revoke) ? body.revoke.filter((s): s is string => typeof s === 'string') : [];
    try {
      if (grant.length > 0) await keycloak.assignRealmRoles(userId, grant);
      if (revoke.length > 0) await keycloak.removeRealmRoles(userId, revoke);
      reply.send({ ok: true });
    } catch (err) {
      reply.code(400).send({ error: 'role_update_failed', message: (err as Error).message });
    }
  });

  // ------- Agent permissions -------
  const managerAgentId = opts.managerAgentId ?? MANAGER_AGENT_ID;
  const librechatMongoUri = opts.librechatMongoUri;

  app.get('/admin/keys/api/policies', async (_req, reply) => {
    const doc = await policies.load();
    const manager = doc.agents.find(a => a.agentId === 'manager');
    const effective = manager ? computeEffectiveTools(manager) : [];
    reply.send({
      capabilities: CAPABILITIES,
      policy: doc,
      runtime: {
        agentId: managerAgentId,
        capabilityToTool: CAPABILITY_TO_TOOL,
        effectiveTools: effective,
        mongoConfigured: Boolean(librechatMongoUri),
      },
    });
  });

  app.put('/admin/keys/api/policies', async (req, reply) => {
    const body = parseJSONBody(req);
    const incoming = body.policy as PolicyDocument | undefined;
    if (!incoming || incoming.version !== 1 || !Array.isArray(incoming.agents)) {
      return reply.code(400).send({ error: 'invalid_request', message: 'expected { policy: { version: 1, agents: [...] } }' });
    }
    const saved = await policies.save(incoming);

    // Push the manager agent's effective tool list into LibreChat MongoDB so
    // disabling a capability really hides the corresponding tool from Gemini.
    let runtime: Record<string, unknown> | undefined;
    const manager = saved.agents.find(a => a.agentId === 'manager');
    if (manager) {
      const result = await syncAgentToolsToMongo({
        mongoUri: librechatMongoUri,
        policy: manager,
        agentId: managerAgentId,
      });
      runtime = result.ok
        ? {
            ok: true,
            agentId: result.agentId,
            toolsBefore: result.toolsBefore,
            toolsAfter: result.toolsAfter,
            changed: result.changed,
          }
        : {
            ok: false,
            agentId: result.agentId,
            reason: result.reason,
            message: result.message,
            toolsAfter: result.toolsAfter,
          };
      if (!result.ok && result.reason !== 'no_mongo_uri') {
        app.log.warn({ runtime }, 'agent-sync failed (policy still saved on volume)');
      }
    }

    reply.send({ ok: true, policy: saved, runtime });
  });

  // Read-only view of what LibreChat is actually exposing right now. The UI
  // calls this to render an "effective tools" pill so the operator sees the
  // mapping without leaving the panel.
  app.get('/admin/keys/api/agents/manager/effective-tools', async (_req, reply) => {
    const doc = await policies.load();
    const manager = doc.agents.find(a => a.agentId === 'manager');
    const effective = manager ? computeEffectiveTools(manager) : [];
    reply.send({
      agentId: managerAgentId,
      effectiveTools: effective,
      capabilityToTool: CAPABILITY_TO_TOOL,
      mongoConfigured: Boolean(librechatMongoUri),
    });
  });

  app.log.info(
    { providers: PROVIDERS.length, capabilities: CAPABILITIES.length },
    'admin keys panel registered at /admin/keys (SSO-gated)',
  );
}

function parseJSONBody(req: FastifyRequest): Record<string, unknown> {
  if (req.body && typeof req.body === 'object') {
    return req.body as Record<string, unknown>;
  }
  return {};
}

function renderDisabledPage(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><title>Admin panel disabled</title>
<style>
  html,body{margin:0;padding:0;background:#0b0f17;color:#f2f6fc;font-family:system-ui,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center}
  .card{max-width:560px;padding:32px;border:1px solid #29334a;border-radius:18px;background:#141a26;text-align:center}
  h1{margin:0 0 12px;font-size:20px}
  code{background:#1a2230;padding:2px 6px;border-radius:6px;border:1px solid #29334a;font-size:12px}
  p{color:#a4adc1;line-height:1.6}
  ul{text-align:left;color:#a4adc1;line-height:1.8;font-size:14px}
</style></head><body><main class="card">
<h1>Admin panel disabled</h1>
<p>The following Fly secrets are required to enable this page:</p>
<ul>
<li><code>KEYS_MASTER_KEY</code> — 32-byte hex master key for AES-256-GCM</li>
<li><code>KEYCLOAK_ISSUER</code> — e.g. https://kc.example.com/realms/ai-agent-os</li>
<li><code>KEYCLOAK_ADMIN_BRIDGE_CLIENT_ID</code> — confidential client with directAccessGrants + serviceAccounts</li>
<li><code>KEYCLOAK_ADMIN_BRIDGE_SECRET</code> — that client's secret</li>
</ul>
</main></body></html>`;
}

// Re-export for tests.
export type { KeysStore, AdminAuth };
