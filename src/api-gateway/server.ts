import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { describeUpstreams, loadGatewayEnv, type GatewayEnv } from './config/env.js';
import { buildJwtVerifier, makeJwtPreHandler } from './middleware/jwt.js';
import { registerSecurityHeaders } from './middleware/security-headers.js';
import { registerHealthRoute } from './routes/health.js';
import { registerProxyRoute } from './routes/proxy.js';

export interface GatewayOptions {
  env?: GatewayEnv;
  version?: string;
}

export async function buildGateway(opts: GatewayOptions = {}): Promise<FastifyInstance> {
  const env = opts.env ?? loadGatewayEnv();
  const version = opts.version ?? '1.0.0';
  const startedAt = new Date();

  const app = Fastify({
    logger: { level: env.GATEWAY_LOG_LEVEL },
    trustProxy: env.GATEWAY_TRUST_PROXY,
    disableRequestLogging: false,
    bodyLimit: 10 * 1024 * 1024,
  });

  await registerSecurityHeaders(app);

  const corsOrigins = env.GATEWAY_CORS_ORIGINS
    ? env.GATEWAY_CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)
    : [];
  await app.register(cors, {
    origin: corsOrigins.length ? corsOrigins : false,
    credentials: true,
  });

  await app.register(rateLimit, {
    max: env.GATEWAY_RATE_LIMIT_MAX,
    timeWindow: env.GATEWAY_RATE_LIMIT_WINDOW,
    allowList: (req) => req.url === '/livez',
  });

  // Root info (no auth) — advertises capabilities, NEVER leaks secrets.
  app.get('/', async () => ({
    service: 'ai-agent-os-unified-gateway',
    version,
    docs: '/api/health',
  }));

  const upstreams = describeUpstreams(env);
  await registerHealthRoute(app, {
    upstreams,
    version,
    startedAt,
  });

  // JWT gate for /api/* (except /api/health which was registered first and is open).
  if (env.KEYCLOAK_ISSUER && env.GATEWAY_REQUIRE_AUTH) {
    const verifier = buildJwtVerifier({
      issuer: env.KEYCLOAK_ISSUER,
      audience: env.KEYCLOAK_AUDIENCE,
      jwksUri: env.KEYCLOAK_JWKS_URI,
      requiredRoles: env.KEYCLOAK_REQUIRED_ROLES
        ? env.KEYCLOAK_REQUIRED_ROLES.split(',').map(s => s.trim()).filter(Boolean)
        : [],
    });
    const pre = makeJwtPreHandler(verifier);
    app.addHook('onRequest', async (req, reply) => {
      if (!req.url.startsWith('/api/')) return;
      if (req.url === '/api/health' || req.url.startsWith('/api/health?')) return;
      await pre(req, reply);
    });
  } else {
    app.log.warn('gateway running WITHOUT JWT verification (set KEYCLOAK_ISSUER to enable)');
  }

  // Route map: /api/<mount>/* → configured upstream.
  const routeTable: Array<{ mount: string; upstream: string | undefined; name: string }> = [
    { mount: '/api/agent', upstream: env.UPSTREAM_AI_AGENT_OS, name: 'ai-agent-os' },
    { mount: '/api/orchestrate', upstream: env.UPSTREAM_QUALIXAR, name: 'qualixar' },
    { mount: '/api/chat', upstream: env.UPSTREAM_LIBRECHAT, name: 'librechat' },
    { mount: '/api/mission', upstream: env.UPSTREAM_MISSION_CONTROL, name: 'mission-control' },
    { mount: '/api/panel', upstream: env.UPSTREAM_GOD_PANEL, name: 'god-panel' },
    { mount: '/api/boardroom', upstream: env.UPSTREAM_BOARDROOM, name: 'boardroom' },
    { mount: '/api/tigerpaw', upstream: env.UPSTREAM_TIGERPAW, name: 'tigerpaw' },
    { mount: '/api/mcp-a2a', upstream: env.UPSTREAM_MCP_A2A_GATEWAY, name: 'mcp-a2a-gateway' },
    { mount: '/api/claw', upstream: env.UPSTREAM_CLAW_BRIDGE, name: 'claw-bridge' },
  ];

  for (const entry of routeTable) {
    registerProxyRoute(app, {
      mountPath: entry.mount,
      upstreamUrl: entry.upstream,
      name: entry.name,
    });
  }

  return app;
}

export async function startGateway(): Promise<FastifyInstance> {
  const env = loadGatewayEnv();
  const app = await buildGateway({ env });
  await app.listen({ host: env.GATEWAY_HOST, port: env.GATEWAY_PORT });
  return app;
}

const isDirectRun = (() => {
  try {
    return import.meta.url === `file://${process.argv[1]}`;
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  startGateway().catch(err => {
    console.error('gateway failed to start', err);
    process.exitCode = 1;
  });
}
