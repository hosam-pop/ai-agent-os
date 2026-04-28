import { z } from 'zod';

// Environment configuration for the unified API Gateway.
// All values are optional so the gateway can boot in restricted modes
// (e.g. health-only) when upstreams are unavailable.
const GatewayEnvSchema = z.object({
  GATEWAY_HOST: z.string().default('0.0.0.0'),
  GATEWAY_PORT: z.coerce.number().int().positive().default(8080),
  GATEWAY_PUBLIC_URL: z.string().url().optional(),
  GATEWAY_LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),

  // Keycloak / OIDC
  KEYCLOAK_ISSUER: z.string().url().optional(),
  KEYCLOAK_AUDIENCE: z.string().optional(),
  KEYCLOAK_JWKS_URI: z.string().url().optional(),
  KEYCLOAK_REQUIRED_ROLES: z.string().optional(),

  // Upstream services (used by /api/* routes and /api/health aggregator)
  UPSTREAM_AI_AGENT_OS: z.string().url().optional(),
  UPSTREAM_QUALIXAR: z.string().url().optional(),
  UPSTREAM_LIBRECHAT: z.string().url().optional(),
  UPSTREAM_MISSION_CONTROL: z.string().url().optional(),
  UPSTREAM_GOD_PANEL: z.string().url().optional(),
  UPSTREAM_BOARDROOM: z.string().url().optional(),
  UPSTREAM_TIGERPAW: z.string().url().optional(),
  UPSTREAM_MCP_A2A_GATEWAY: z.string().url().optional(),
  UPSTREAM_CLAW_BRIDGE: z.string().url().optional(),

  // Hardening
  GATEWAY_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  GATEWAY_RATE_LIMIT_WINDOW: z.string().default('1 minute'),
  GATEWAY_CORS_ORIGINS: z.string().default(''),
  GATEWAY_TRUST_PROXY: z.coerce.boolean().default(true),
  GATEWAY_REQUIRE_AUTH: z.coerce.boolean().default(true),

  // Admin keys panel (/admin/keys) — SSO-gated via Keycloak ROPC + service account.
  KEYS_MASTER_KEY: z.string().optional(),
  KEYS_STORE_PATH: z.string().optional(),
  KEYS_POLICIES_PATH: z.string().optional(),
  KEYS_COOKIE_SECURE: z.coerce.boolean().default(true),
  KEYS_REQUIRED_ROLE: z.string().default('agent-admin'),
  KEYCLOAK_ADMIN_BRIDGE_CLIENT_ID: z.string().optional(),
  KEYCLOAK_ADMIN_BRIDGE_SECRET: z.string().optional(),
  // LibreChat MongoDB URI used by /admin/keys/api/policies to push capability
  // changes into the seeded manager agent's tools array. When unset, policy
  // saves still persist on the volume but have no runtime effect.
  LIBRECHAT_MONGO_URI: z.string().optional(),
  // Stable LibreChat agent id whose tools are kept in sync with the manager
  // policy. Defaults to the value used by seed-manager-agent.js.
  MANAGER_AGENT_ID: z.string().optional(),
  // Legacy break-glass password from before SSO; ignored when set, kept here so
  // existing Fly secrets don't fail validation. Will be removed in a follow-up.
  KEYS_ADMIN_PASSWORD: z.string().optional(),
});

export type GatewayEnv = z.infer<typeof GatewayEnvSchema>;

export function loadGatewayEnv(source: NodeJS.ProcessEnv = process.env): GatewayEnv {
  const parsed = GatewayEnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid gateway environment: ${issues}`);
  }
  return parsed.data;
}

export interface UpstreamDescriptor {
  key: string;
  name: string;
  url?: string;
  healthPath: string;
}

export function describeUpstreams(env: GatewayEnv): UpstreamDescriptor[] {
  return [
    { key: 'ai-agent-os', name: 'AI Agent OS backend', url: env.UPSTREAM_AI_AGENT_OS, healthPath: '/health' },
    { key: 'qualixar', name: 'Qualixar OS orchestration', url: env.UPSTREAM_QUALIXAR, healthPath: '/health' },
    { key: 'librechat', name: 'LibreChat UI', url: env.UPSTREAM_LIBRECHAT, healthPath: '/api/config' },
    { key: 'mission-control', name: 'Mission Control dashboard', url: env.UPSTREAM_MISSION_CONTROL, healthPath: '/' },
    { key: 'god-panel', name: 'god-panel admin dashboard', url: env.UPSTREAM_GOD_PANEL, healthPath: '/' },
    { key: 'boardroom', name: 'Boardroom OS', url: env.UPSTREAM_BOARDROOM, healthPath: '/health' },
    { key: 'tigerpaw', name: 'Tigerpaw multi-channel gateway', url: env.UPSTREAM_TIGERPAW, healthPath: '/health' },
    { key: 'mcp-a2a-gateway', name: 'MCP ↔ A2A bridge', url: env.UPSTREAM_MCP_A2A_GATEWAY, healthPath: '/health' },
    { key: 'claw-bridge', name: 'Claw bridge (OpenFang)', url: env.UPSTREAM_CLAW_BRIDGE, healthPath: '/health' },
  ];
}
