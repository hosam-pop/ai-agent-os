# ai-agent-os — demo & feature-flag cheat-sheet

This file documents how to run the agent locally, how to enable the
optional enterprise integrations, and how to bring up the **unified web
control plane** (Keycloak SSO + LibreChat UI + API Gateway).

## Quick start — core CLI

```bash
npm install
npm run build
npm test     # 265 tests expected
```

Set `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY`) in `.env`, then:

```bash
npm run dev
```

## Unified Web Control Plane (Keycloak + LibreChat + API Gateway)

The PR `feat/unified-platform-v1` adds a full, secure web platform on top
of the agent. Three public-facing services:

| Service              | URL (production)                                 | Purpose                       |
| -------------------- | ------------------------------------------------ | ----------------------------- |
| **LibreChat**        | `https://ai-agent-os-librechat.fly.dev`          | Chat with the agent (OIDC).   |
| **Keycloak IAM**     | `https://ai-agent-os-keycloak.fly.dev`           | Branded login + user admin.   |
| **Unified Gateway**  | `https://ai-agent-os-gateway.fly.dev`            | `/api/*` JWT-verified proxy.  |

Plus the full fleet (Mission Control, god-panel-nuxt, Qualixar OS,
mcp-a2a-gateway, OpenFang) reachable via the gateway's `/api/*` routes
and bootable locally with a single `docker compose` command.

### Live demo

1. Open the LibreChat URL above.
2. Click **Sign in with AI Agent OS**.
3. You'll be redirected to a branded Keycloak login page (dark theme,
   AI Agent OS palette).
4. Log in with the admin credentials (**shared separately, never
   committed** — see `docs/UNIFIED_PLATFORM_GUIDE.md` for user
   provisioning).
5. Chat as normal — each request carries a Keycloak-signed JWT that the
   gateway verifies against the JWKS before forwarding to the agent
   runtime.

### Run locally (full fleet)

```bash
# 1. Seed secrets (each CHANGE_ME entry: openssl rand -base64 32)
cp .env.stack.example .env.stack
$EDITOR .env.stack

# 2. Bring up everything
docker compose --env-file .env.stack up -d

# 3. Check health
curl -s http://localhost:4000/api/health | jq .
```

- Keycloak admin: `http://localhost:8080` — log in with
  `KEYCLOAK_ADMIN` / `KEYCLOAK_ADMIN_PASSWORD` from `.env.stack`.
- LibreChat: `http://localhost:3080` — click *Sign in with AI Agent OS*.
- Gateway: `http://localhost:4000/api/health` — aggregated upstream status.

### Security posture (what's enforced at deploy time)

- TLS + HSTS preload on every public app (Fly default).
- CSP `default-src 'self'; frame-ancestors 'none'`, XFO `DENY`, nosniff,
  Permissions-Policy empty.
- Rate limit: 300 req/min/IP on the gateway (configurable).
- Keycloak password policy: length≥12 + mixed case + digit + special +
  no username/email reuse + 3-password history.
- Brute-force lockout: 5 failures → backoff up to 15 min.
- MFA (TOTP SHA-256 + WebAuthn) enabled in the realm.
- All secrets live in `flyctl secrets` / env vars — never in git.
- Internal services (Mongo, Meili, Postgres, Mission Control, god-panel)
  stay on Fly's private `.internal` DNS — never publicly reachable.
- Gateway strips `Authorization` before forwarding; upstreams see only
  `x-gateway-user-id` / `x-gateway-username` / `x-gateway-roles`.

Deep dives:
- <ref_file file="/home/ubuntu/repos/ai-agent-os/docs/DEPLOYMENT_ARCHITECTURE.md" />
- <ref_file file="/home/ubuntu/repos/ai-agent-os/docs/SSO_SETUP.md" />
- <ref_file file="/home/ubuntu/repos/ai-agent-os/docs/UNIFIED_PLATFORM_GUIDE.md" />

## Enterprise Integrations (Optional)

Every integration below is **off by default**. Turning a flag on loads
the adapter; leaving it off makes the code path a no-op.

### 1. Rust / WASM runtime bridges

| Flag | Env vars | Purpose |
| :--- | :--- | :--- |
| `ENABLE_OPENFANG` | `OPENFANG_ENDPOINT`, `OPENFANG_API_KEY` | Delegate named "Hands" to the OpenFang binary via HTTP. |
| `ENABLE_ARGENTOR` | `ARGENTOR_ENDPOINT`, `ARGENTOR_API_KEY` | Policy / compliance checks through the Argentor MCP server. |
| `ENABLE_QUALIXAR` | `QUALIXAR_ENDPOINT`, `QUALIXAR_API_KEY` | Federate tool calls through the Qualixar SLM MCP Hub. |
| `ENABLE_ASTERAI_SANDBOX` | `ASTERAI_WASM_DIR`, `ASTERAI_DEFAULT_FUEL` | Execute untrusted code inside a WASM sandbox. |

Example:

```bash
export ENABLE_OPENFANG=true
export OPENFANG_ENDPOINT=http://localhost:4200
export OPENFANG_API_KEY=...
npm run dev
```

None of these ship a native binary; you are expected to run the upstream
daemon separately (e.g. `openfang start`).

### 2. Memory architecture

| Flag | Env vars | Purpose |
| :--- | :--- | :--- |
| `ENABLE_GRAPH_MEMORY` | `KUZU_DB_PATH` | Relationship-aware memory. Uses Kùzu when the native binding is installed; falls back to an in-memory triple store otherwise. |
| `ENABLE_TEMPORAL_MEMORY` | *(reuses `ZEP_URL`, `ZEP_API_KEY`, `ZEP_SESSION_ID`)* | Track how facts about a subject evolve over time. |
| `ENABLE_HYBRID_RETRIEVAL` | `HYBRID_BM25_WEIGHT`, `HYBRID_VECTOR_WEIGHT` | Combine BM25 with vector search for improved recall + precision. |

The existing Mem0 + Chroma wiring is untouched. Hybrid retrieval plugs
on top: callers supply a `vectorSearch` callback that already talks to
their chosen vector store.

### 3. Auto-dream background compression

| Flag | Env vars | Purpose |
| :--- | :--- | :--- |
| `ENABLE_AUTO_DREAM` | `AUTO_DREAM_INTERVAL_MS`, `AUTO_DREAM_MIN_ENTRIES` | Periodically summarise the working buffer into long-term memory. |

Programmatic use:

```ts
import { startAutoDream } from './src/core/auto-dream.js';

const handle = startAutoDream(provider, source, sink, {
  model: 'claude-3-5-sonnet-latest',
  keepRecent: 6,
  minMessages: 20,
  intervalMs: 10 * 60_000,
});
// later: handle.stop();
```

## What is intentionally excluded

Several tools requested in the upstream brief are Python-only and do
not belong in the Node runtime. They are documented for a later PR in
[`docs/PYTHON_INTEGRATION_ROADMAP.md`](docs/PYTHON_INTEGRATION_ROADMAP.md):

- TurboQuant-Pro (CUDA + Python)
- ZeroKV-Neo (Python)
- openDB (Python)
- Cognee (Python)
- AgentOpt (Python)

The Qualixar-OS repository referenced in the brief (`varunpratap/Qualixar-OS`)
does not exist. The adapter in this PR targets the real
`qualixar/slm-mcp-hub` project instead.
