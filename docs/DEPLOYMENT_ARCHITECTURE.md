# Deployment Architecture — AI Agent OS Unified Platform

> A secure, unified web control plane for AI Agent OS.
> Public components run on Fly.io with TLS + HSTS; private components run
> behind the API gateway on an internal network.

## TL;DR

```
                 ┌──────────────────────────────────────┐
                 │    User browser (TLS, HSTS, CSP)     │
                 └──────────────────────────────────────┘
                                  │
                                  ▼
  ┌─────────────────────────────────────────────────────────────┐
  │  Public edge  (https://ai-agent-os-librechat.fly.dev)       │
  │  LibreChat   ─── OIDC redirect ──► Keycloak (branded)       │
  │              ◄── JWT (access token) ─────                   │
  └─────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
  ┌─────────────────────────────────────────────────────────────┐
  │  API Gateway  (https://ai-agent-os-gateway.fly.dev)         │
  │  • Verifies Keycloak JWT via JWKS (issuer + audience)       │
  │  • Strips Authorization header before forwarding            │
  │  • Injects x-gateway-user-id / -username / -roles           │
  │  • Rate limit + HSTS + CSP + XFO DENY                       │
  └─────────────────────────────────────────────────────────────┘
         │              │               │              │
         ▼              ▼               ▼              ▼
   /api/agent     /api/orchestrate  /api/chat     /api/health
   ai-agent-os    Qualixar OS       LibreChat     (aggregator)
   backend
```

## Hosting choice: Fly.io

Chosen for:

1. **Free HTTPS with HSTS preload on every app** — no Let's Encrypt plumbing.
2. **Per-app IPv6 firewall** — internal services (Mongo, Meili, Postgres,
   Mission Control, god-panel) stay on the private `.internal` DNS and are
   never exposed to the public Internet.
3. **Secrets as first-class resources** (`flyctl secrets set`) — never
   materialised on disk, rotatable without a redeploy.
4. **Rolling deploys with health-checks** — bad images are rejected before
   traffic is shifted.

Alternatives considered and rejected for this cut:

- **Railway**: less granular private networking; no free HSTS preload.
- **Render**: no official distroless support; slower cold starts.
- **Raw Kubernetes**: overkill for a first-cut public URL; high operational
  burden.

## Public-facing vs internal services

| Service              | Public?      | Why                                                           |
| -------------------- | ------------ | ------------------------------------------------------------- |
| Keycloak             | **Yes**      | OIDC endpoint used by browsers during the login redirect.      |
| LibreChat            | **Yes**      | Primary chat UI end-users sign into.                          |
| API Gateway          | **Yes**      | Single REST entrypoint for `/api/*` from LibreChat.           |
| Mission Control      | **No**       | Upstream only ships basic auth — served only via `/api/mission/*`. |
| god-panel-nuxt       | **No**       | Upstream uses internal JWT — served only via `/api/panel/*`.  |
| Qualixar OS          | **No**       | MCP server, not browser-facing.                               |
| mcp-a2a-gateway      | **No**       | A2A bridge, called by agents only.                            |
| MongoDB / Postgres / Meili | **No** | Internal `.internal` DNS only.                                 |

## Authentication flow

```
1. User hits https://ai-agent-os-librechat.fly.dev/login
2. LibreChat redirects to
   https://ai-agent-os-keycloak.fly.dev/realms/ai-agent-os/
   protocol/openid-connect/auth?client_id=ai-agent-os-librechat&…
3. User authenticates against the branded Keycloak theme
4. Keycloak issues authorization code → LibreChat exchanges via back-channel
   (client_secret stored in Fly secrets, never in git)
5. LibreChat receives ID token + access token.
   The access token has:
     • iss = https://ai-agent-os-keycloak.fly.dev/realms/ai-agent-os
     • aud includes "ai-agent-os-gateway"
     • realm_access.roles contains "agent-user" or "agent-admin"
6. LibreChat calls /api/agent/v1/chat/completions on the gateway with
     Authorization: Bearer <access_token>
7. Gateway verifies the token against the JWKS URI, then forwards the
   request to the AI Agent OS backend with headers:
     x-gateway-user-id, x-gateway-username, x-gateway-email, x-gateway-roles
   (the raw Bearer is stripped — upstream services never see it)
```

## Security controls

### Transport / HTTP

- TLS terminated by Fly proxy; HTTP→HTTPS forced at the edge.
- `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`
- `Content-Security-Policy: default-src 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'`
- `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: geolocation=(), camera=(), microphone=()`
- `X-Powered-By` header is stripped.

### Auth

- Keycloak password policy: `length(12) + digits + upper + lower + special
  + passwordHistory(3) + notUsername + notEmail`.
- Brute-force protection: 5 failures → permanent IP lockout window up to
  900 s (see realm JSON `failureFactor`, `maxFailureWaitSeconds`).
- MFA: TOTP (SHA-256, 6 digits, 30 s) + WebAuthn enabled.
- Access tokens live 15 min; refresh tokens 10 h (`accessTokenLifespan`,
  `ssoSessionMaxLifespan`).

### Gateway

- JWKS-based signature verification (no shared secrets on the gateway).
- Issuer + audience bound to the Fly realm and `ai-agent-os-gateway` client.
- Rate limit: 300 req/min/IP by default (configurable).
- CORS closed by default; explicit origins via `GATEWAY_CORS_ORIGINS`.
- Request body capped at 10 MiB.
- Authorization header stripped before forwarding upstream.

### Secrets

Managed via `flyctl secrets set`. None are committed; `.env.stack.example`
ships with `CHANGE_ME_` placeholders only.

| Secret                         | Purpose                                  |
| ------------------------------ | ---------------------------------------- |
| `KEYCLOAK_ADMIN_PASSWORD`      | Realm admin console                      |
| `KC_DB_PASSWORD`               | Keycloak ↔ Postgres                       |
| `OPENID_CLIENT_SECRET_LIBRECHAT` | LibreChat ↔ Keycloak back-channel      |
| `OPENID_SESSION_SECRET`        | LibreChat session cookie HMAC            |
| `LIBRECHAT_JWT_SECRET`         | LibreChat internal JWT                   |
| `LIBRECHAT_JWT_REFRESH_SECRET` | LibreChat refresh token HMAC             |
| `LIBRECHAT_CREDS_KEY` / `_IV`  | LibreChat encrypted field AES key/IV     |
| `MEILI_MASTER_KEY`             | Meilisearch master key                   |
| `MISSION_CONTROL_PASS`         | Mission Control basic-auth fallback       |

Rotate at first login. All secrets are also set on Fly with
`--stage` + `flyctl deploy --immediate` to guarantee atomic rollout.

### Database hardening

- Fly Postgres with TLS (`sslmode=require`), restricted to the app's
  internal IPv6 only.
- No public IP, no port forwarding.
- Daily snapshots (Fly default).

## Disaster recovery

| Failure                                 | Response                                              |
| --------------------------------------- | ----------------------------------------------------- |
| Keycloak down                           | LibreChat shows "Sign in" error; no new logins.       |
| Gateway down                            | LibreChat chat calls fail; Fly health check restarts. |
| Upstream (ai-agent-os) down             | Gateway returns 502 with `upstream_failure` body.     |
| Upstream not configured                 | Gateway returns 503 with `upstream_unavailable`.      |
| JWT expired                             | 401 with `missing Bearer token` or `unauthorized`.    |
| Rate limit hit                          | 429 with `Retry-After` header.                        |

## Repeatable deployment

See <ref_file file="/home/ubuntu/repos/ai-agent-os/docs/SSO_SETUP.md" />
for the exact click-path to bring up the stack from scratch.
