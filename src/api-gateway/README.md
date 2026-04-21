# Unified API Gateway

Lightweight Fastify-based gateway that:

1. Verifies Keycloak-issued JWTs on every `/api/*` request (via JWKS).
2. Proxies requests to the appropriate backend based on the path prefix.
3. Aggregates health from every known upstream into `/api/health`.

## Route table

| Path prefix        | Upstream env var               | Target service             |
| ------------------ | ------------------------------ | -------------------------- |
| `/api/agent/*`     | `UPSTREAM_AI_AGENT_OS`         | AI Agent OS backend        |
| `/api/orchestrate/*` | `UPSTREAM_QUALIXAR`         | Qualixar OS                |
| `/api/chat/*`      | `UPSTREAM_LIBRECHAT`           | LibreChat                  |
| `/api/mission/*`   | `UPSTREAM_MISSION_CONTROL`     | Mission Control dashboard  |
| `/api/panel/*`     | `UPSTREAM_GOD_PANEL`           | god-panel-nuxt             |
| `/api/boardroom/*` | `UPSTREAM_BOARDROOM`           | Boardroom OS               |
| `/api/tigerpaw/*`  | `UPSTREAM_TIGERPAW`            | Tigerpaw gateway           |
| `/api/mcp-a2a/*`   | `UPSTREAM_MCP_A2A_GATEWAY`     | MCP ↔ A2A bridge           |
| `/api/claw/*`      | `UPSTREAM_CLAW_BRIDGE`         | Claw bridge (OpenFang)     |
| `/api/health`      | — (aggregator)                 | All upstreams              |
| `/livez`           | — (unauth’d liveness)          | Gateway itself             |

## Running locally

```bash
KEYCLOAK_ISSUER=https://keycloak.example/realms/ai-agent-os \
KEYCLOAK_AUDIENCE=ai-agent-os-gateway \
UPSTREAM_AI_AGENT_OS=http://localhost:3100 \
UPSTREAM_LIBRECHAT=http://localhost:3080 \
node --experimental-strip-types src/api-gateway/server.ts
```

## Security posture

- Strict transport: HSTS, X-Frame-Options DENY, nosniff, CSP default-src `'self'`.
- Rate limit defaults to 300 req/min per IP (configurable via
  `GATEWAY_RATE_LIMIT_MAX` / `GATEWAY_RATE_LIMIT_WINDOW`).
- CORS is **closed by default**; opt in via `GATEWAY_CORS_ORIGINS` (comma list).
- `authorization` header is stripped before forwarding; instead the gateway
  forwards `x-gateway-user-id`, `x-gateway-username`, `x-gateway-email`,
  `x-gateway-roles` so upstreams never see raw bearer tokens.
- Upstream timeouts default to 2s for `/api/health` probes.
