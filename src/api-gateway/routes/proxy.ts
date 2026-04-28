import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthContext } from '../middleware/jwt.js';

export interface ProxyRouteConfig {
  mountPath: string; // e.g. /api/agent
  upstreamUrl?: string;
  name: string;
  fetchImpl?: typeof fetch;
  // Optional: map the request path before forwarding.
  rewritePath?: (path: string) => string;
}

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
]);

export function buildForwardUrl(cfg: ProxyRouteConfig, incomingUrl: string): string {
  if (!cfg.upstreamUrl) {
    throw new Error(`upstream not configured for ${cfg.name}`);
  }
  // Strip the mount path.
  const [rawPath, search = ''] = incomingUrl.split('?');
  const relative = rawPath.startsWith(cfg.mountPath)
    ? rawPath.slice(cfg.mountPath.length) || '/'
    : rawPath;
  const mapped = cfg.rewritePath ? cfg.rewritePath(relative) : relative;
  const base = cfg.upstreamUrl.replace(/\/$/, '');
  const suffix = mapped.startsWith('/') ? mapped : `/${mapped}`;
  const query = search ? `?${search}` : '';
  return `${base}${suffix}${query}`;
}

export function filterRequestHeaders(headers: FastifyRequest['headers']): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    const key = k.toLowerCase();
    if (HOP_BY_HOP.has(key)) continue;
    if (key === 'authorization') continue; // stripped; gateway injects its own auth context
    if (Array.isArray(v)) out[key] = v.join(', ');
    else if (typeof v === 'string') out[key] = v;
  }
  return out;
}

export function registerProxyRoute(app: FastifyInstance, cfg: ProxyRouteConfig): void {
  const fetchImpl = cfg.fetchImpl ?? fetch;
  app.all(`${cfg.mountPath}/*`, async (req: FastifyRequest, reply: FastifyReply) => {
    if (!cfg.upstreamUrl) {
      return reply.code(503).send({
        error: 'upstream_unavailable',
        service: cfg.name,
      });
    }
    const auth = (req as FastifyRequest & { auth?: AuthContext }).auth;
    const headers = filterRequestHeaders(req.headers);
    if (auth) {
      headers['x-gateway-user-id'] = auth.sub;
      if (auth.preferredUsername) headers['x-gateway-username'] = auth.preferredUsername;
      if (auth.email) headers['x-gateway-email'] = auth.email;
      if (auth.roles.length) headers['x-gateway-roles'] = auth.roles.join(',');
    }
    headers['x-forwarded-by'] = 'ai-agent-os-gateway';

    const target = buildForwardUrl(cfg, req.url);
    const method = req.method.toUpperCase();
    const init: RequestInit = { method, headers };
    if (method !== 'GET' && method !== 'HEAD' && req.body !== undefined) {
      init.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      if (!headers['content-type']) headers['content-type'] = 'application/json';
    }

    try {
      const upstream = await fetchImpl(target, init);
      const responseHeaders: Record<string, string> = {};
      upstream.headers.forEach((value, key) => {
        if (!HOP_BY_HOP.has(key.toLowerCase())) responseHeaders[key] = value;
      });
      reply.headers(responseHeaders);
      reply.code(upstream.status);
      const buf = Buffer.from(await upstream.arrayBuffer());
      return reply.send(buf);
    } catch (err) {
      req.log.warn({ err, target }, 'proxy_upstream_failure');
      return reply.code(502).send({
        error: 'upstream_failure',
        service: cfg.name,
        message: (err as Error).message,
      });
    }
  });
}
