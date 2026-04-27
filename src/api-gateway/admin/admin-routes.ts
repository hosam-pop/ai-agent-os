import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AdminAuth, buildAdminAuth } from './admin-auth.js';
import { renderAdminKeysPage } from './admin-page.js';
import { createFileKeysStore, KeysStore, toPublicStatus } from './keys-store.js';
import { findProvider, PROVIDERS } from './providers.js';

export interface AdminKeysRoutesOptions {
  // Master encryption key. Required to enable the panel.
  masterKey: string | undefined;
  // Plaintext admin password. Required to enable the panel.
  adminPassword: string | undefined;
  // Path to the encrypted JSON store. Defaults to /data/admin-keys.json so it
  // lives on a Fly volume when one is attached.
  storePath?: string;
  // Whether to set the Secure flag on session cookies. Defaults to true.
  secureCookie?: boolean;
}

const DEFAULT_STORE_PATH = '/data/admin-keys.json';

export async function registerAdminKeysRoutes(
  app: FastifyInstance,
  opts: AdminKeysRoutesOptions,
): Promise<void> {
  const masterKey = opts.masterKey;
  const adminPassword = opts.adminPassword;
  if (!masterKey || !adminPassword) {
    app.log.warn('admin keys panel disabled (set KEYS_MASTER_KEY and KEYS_ADMIN_PASSWORD to enable)');
    app.get('/admin/keys', async (_req, reply) => {
      reply.code(503).type('text/html').send(renderDisabledPage());
    });
    return;
  }

  const auth = buildAdminAuth({
    password: adminPassword,
    sessionKey: masterKey,
    secureCookie: opts.secureCookie ?? true,
  });
  const store = createFileKeysStore({
    filePath: opts.storePath ?? DEFAULT_STORE_PATH,
    masterKey,
  });

  app.get('/admin/keys', async (req, reply) => {
    const session = auth.validateSessionFromRequest(req);
    reply
      .type('text/html')
      .header('cache-control', 'no-store, max-age=0')
      .send(renderAdminKeysPage({ signedIn: session.ok }));
  });

  // POST /admin/keys/api/login — exchange the admin password for a session cookie.
  app.post('/admin/keys/api/login', async (req, reply) => {
    const body = parseJSONBody(req);
    const password = typeof body.password === 'string' ? body.password : '';
    if (!password) {
      return reply.code(400).send({ error: 'invalid_request', message: 'password is required' });
    }
    if (!auth.verifyPassword(password)) {
      return reply.code(401).send({ error: 'unauthorized', message: 'wrong password' });
    }
    const sess = auth.issueSession();
    auth.setSessionCookie(reply, sess.token);
    reply.send({ ok: true, expiresAt: sess.expiresAt });
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
  });

  app.get('/admin/keys/api/list', async (_req, reply) => {
    const items = await Promise.all(
      PROVIDERS.map(async (p) => {
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
    const rec = await store.set(provider.id, value, 'admin');
    reply.send({
      ok: true,
      status: toPublicStatus(rec, provider.id, masterKey),
    });
  });

  app.delete('/admin/keys/api/:provider', async (req, reply) => {
    const id = (req.params as { provider?: string }).provider ?? '';
    const provider = findProvider(id);
    if (!provider) {
      return reply.code(404).send({ error: 'not_found', message: `unknown provider: ${id}` });
    }
    await store.delete(provider.id);
    reply.send({
      ok: true,
      status: toPublicStatus(null, provider.id, masterKey),
    });
  });

  app.post('/admin/keys/api/:provider/test', async (req, reply) => {
    const id = (req.params as { provider?: string }).provider ?? '';
    const provider = findProvider(id);
    if (!provider) {
      return reply.code(404).send({ error: 'not_found', message: `unknown provider: ${id}` });
    }
    const value = await store.decrypt(provider.id);
    if (!value) {
      return reply
        .code(400)
        .send({ error: 'no_key', message: 'no key stored for this provider' });
    }
    if (!provider.testKey) {
      const status = await store.recordTest(provider.id, { ok: true, note: 'no live test available' });
      return reply.send({
        ok: true,
        status: toPublicStatus(status, provider.id, masterKey),
      });
    }
    let result: { ok: boolean; note: string };
    try {
      result = await provider.testKey(value);
    } catch (err) {
      result = { ok: false, note: (err as Error).message.slice(0, 200) };
    }
    const rec = await store.recordTest(provider.id, result);
    reply.send({
      ok: result.ok,
      status: toPublicStatus(rec, provider.id, masterKey),
    });
  });

  app.log.info({ providers: PROVIDERS.length }, 'admin keys panel registered at /admin/keys');
}

function parseJSONBody(req: FastifyRequest): Record<string, unknown> {
  if (req.body && typeof req.body === 'object') {
    return req.body as Record<string, unknown>;
  }
  return {};
}

function renderDisabledPage(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><title>API Keys disabled</title>
<style>
  html,body{margin:0;padding:0;background:#0b0f17;color:#f2f6fc;font-family:system-ui,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center}
  .card{max-width:520px;padding:32px;border:1px solid #29334a;border-radius:18px;background:#141a26;text-align:center}
  h1{margin:0 0 12px;font-size:20px}
  code{background:#1a2230;padding:2px 6px;border-radius:6px;border:1px solid #29334a}
  p{color:#a4adc1;line-height:1.6}
</style></head><body><main class="card">
<h1>API Keys panel disabled</h1>
<p>Set the <code>KEYS_MASTER_KEY</code> and <code>KEYS_ADMIN_PASSWORD</code> Fly secrets on the gateway and redeploy to enable this page.</p>
</main></body></html>`;
}

// Re-export for tests.
export type { KeysStore, AdminAuth };
