# SSO Setup — Keycloak + AI Agent OS Platforms

Everything below is already encoded in
`deploy/keycloak/realm/ai-agent-os-realm.json` and imported on first
Keycloak boot via `start --import-realm`. This document describes what
gets created, how to re-create it manually, and how to wire each
platform up to it.

## 1. The realm

- **Name**: `ai-agent-os`
- **Display name**: `AI Agent OS`
- **Login theme**: `ai-agent-os` (branded; see
  `deploy/keycloak/themes/ai-agent-os/`)
- **Default role**: `agent-user`
- **Registration**: disabled (admins create users)

## 2. Realm roles

| Role             | Purpose                                                   |
| ---------------- | --------------------------------------------------------- |
| `agent-admin`    | Full access to every dashboard and admin-only endpoints.  |
| `agent-user`     | Can talk to the agent via LibreChat, call `/api/agent/*`. |
| `agent-service`  | Service-account role for backend-to-backend calls.         |
| `agent-auditor`  | Read-only access to observability and audit logs.         |

Groups ship with sensible defaults:
`agent-admins`, `agent-users`, `agent-auditors`.

## 3. Clients

| `clientId`                       | Type           | Flow        | Callback                                  |
| -------------------------------- | -------------- | ----------- | ----------------------------------------- |
| `ai-agent-os-gateway`            | bearer-only    | —           | n/a (audience only)                       |
| `ai-agent-os-librechat`          | confidential   | auth code + PKCE | `/oauth/openid/callback`            |
| `ai-agent-os-panel`              | public         | auth code + PKCE | `/*`                                 |
| `ai-agent-os-mission-control`    | public         | auth code + PKCE | `/*`                                 |

Every client token is stamped with `aud: ai-agent-os-gateway` via the
`ai-agent-os-audience` client scope, which is what the unified API
gateway checks.

## 4. Wiring each platform

### LibreChat (public)

In `fly.toml` env or `.env.stack`:

```bash
OPENID_CLIENT_ID=ai-agent-os-librechat
OPENID_CLIENT_SECRET=<copy from Keycloak → Clients → ai-agent-os-librechat → Credentials>
OPENID_ISSUER=https://ai-agent-os-keycloak.fly.dev/realms/ai-agent-os
OPENID_SESSION_SECRET=<openssl rand -base64 32>
OPENID_SCOPE="openid profile email"
OPENID_CALLBACK_URL=/oauth/openid/callback
OPENID_REQUIRED_ROLE=agent-user
OPENID_BUTTON_LABEL="Sign in with AI Agent OS"
ALLOW_EMAIL_LOGIN=false
ALLOW_SOCIAL_LOGIN=true
ALLOW_SOCIAL_REGISTRATION=true
```

### API Gateway (public)

```bash
KEYCLOAK_ISSUER=https://ai-agent-os-keycloak.fly.dev/realms/ai-agent-os
KEYCLOAK_AUDIENCE=ai-agent-os-gateway
KEYCLOAK_JWKS_URI=https://ai-agent-os-keycloak.fly.dev/realms/ai-agent-os/protocol/openid-connect/certs
GATEWAY_REQUIRE_AUTH=true
```

Optionally force a role:
`KEYCLOAK_REQUIRED_ROLES=agent-user`.

### god-panel-nuxt (private, via gateway)

`god-panel-nuxt` does not ship Keycloak support natively; we front it
with the gateway and use the public client
`ai-agent-os-panel`:

```bash
NUXT_PUBLIC_KEYCLOAK_URL=https://ai-agent-os-keycloak.fly.dev/realms/ai-agent-os
NUXT_PUBLIC_KEYCLOAK_CLIENT_ID=ai-agent-os-panel
NUXT_PUBLIC_API_BASE=https://ai-agent-os-gateway.fly.dev
```

### Mission Control (private, via gateway)

Upstream `builderz-labs/mission-control` only ships basic auth. We keep
its private basic-auth as an internal fence and gate public access via
`/api/mission/*` on the gateway (which requires a valid Keycloak JWT).
The basic-auth credential is generated with `openssl rand -base64 32`
and stored in Fly secrets; it is never exposed outside the private
network.

### Qualixar OS, MCP↔A2A, OpenFang

These are machine-to-machine integrations — they never render a login
screen. The gateway enforces auth on `/api/orchestrate/*`,
`/api/mcp-a2a/*`, `/api/claw/*`. Client-credentials grants on the
`ai-agent-os-gateway` audience are the recommended way to call them
programmatically.

## 5. Rotating secrets

```bash
# New client secret for LibreChat
flyctl ssh console -a ai-agent-os-keycloak -C "\
  kcadm.sh config credentials --server http://localhost:8080 \
    --realm master --user $KEYCLOAK_ADMIN --password $KEYCLOAK_ADMIN_PASSWORD && \
  kcadm.sh update clients/<client-uuid>/client-secret -r ai-agent-os"

# Copy the new secret into Fly
flyctl secrets set -a ai-agent-os-librechat OPENID_CLIENT_SECRET=<new>
flyctl deploy -a ai-agent-os-librechat --strategy immediate
```

## 6. End-to-end smoke test

```bash
# 1. Ask the gateway who it is (unauthenticated).
curl -sS https://ai-agent-os-gateway.fly.dev/livez | jq .

# 2. Aggregated health.
curl -sS https://ai-agent-os-gateway.fly.dev/api/health | jq .

# 3. From LibreChat, log in; DevTools → Application → Cookies →
#    copy `refreshToken`, exchange it for an access token, then:
ACCESS_TOKEN=<paste>
curl -H "Authorization: Bearer $ACCESS_TOKEN" \
     https://ai-agent-os-gateway.fly.dev/api/agent/ping
# → 200 OK, x-gateway-user-id set on the backend's request.
```

If the token is wrong:

```json
{"error":"unauthorized","message":"..."}
```
