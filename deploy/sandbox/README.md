# Code-execution sandbox

Tiny Python service that exposes a single MCP tool — `run_code(language, code, timeout)` — to the LibreChat Manager Agent. It is **not** a UI, it is a worker; the existing admin panel and chat UI are unchanged.

## Architecture

```
LibreChat (agent)  ──MCP/streamable-http──▶  ai-agent-os-sandbox (this Fly app)
                                                     │
                                                     ▼
                                          subprocess (python|bash|node|sh)
                                          inside /tmp/aaos-sandbox-* (ephemeral)
                                          + GITHUB_PAT and GEMINI_API_KEY
                                            forwarded into the child env
                                            iff present.
```

Auth: bearer token (`SANDBOX_TOKEN`). LibreChat reads it via the
`headers.Authorization` field in `librechat.yaml` (`mcpServers.code-sandbox`).

Capability gating: turning **`sandbox.run`** off in `/admin/keys → Agent
Permissions` removes `code_sandbox` from the Manager Agent's MongoDB `tools`
array on the next save, exactly like the other gated capabilities (PR #20).

## Deploy

The Fly app is **not yet created**. To create + deploy after merging this PR:

```bash
# 1. Create the app
flyctl apps create ai-agent-os-sandbox --org personal

# 2. Generate a strong shared bearer token (32 random bytes, base64).
SANDBOX_TOKEN="$(openssl rand -base64 32)"

# 3. Set secrets on the sandbox app. GITHUB_PAT and GEMINI_API_KEY are
#    OPTIONAL — they are forwarded into the executed code's environment when
#    present so that snippets can do `git push` or call the Google Generative
#    Language API. Leave either out and the corresponding integration is
#    silently disabled (`integrations_status` reports false).
flyctl secrets set --app ai-agent-os-sandbox \
  SANDBOX_TOKEN="$SANDBOX_TOKEN"
# Optional:
# flyctl secrets set --app ai-agent-os-sandbox GITHUB_PAT="..."
# flyctl secrets set --app ai-agent-os-sandbox GEMINI_API_KEY="..."

# 4. Deploy.
flyctl deploy --config deploy/fly/sandbox.fly.toml --app ai-agent-os-sandbox

# 5. Wire the sandbox into LibreChat. The same bearer token must be visible
#    to LibreChat so it can call the MCP server.
flyctl secrets set --app ai-agent-os-librechat \
  SANDBOX_TOKEN="$SANDBOX_TOKEN" \
  SANDBOX_MCP_URL="https://ai-agent-os-sandbox.fly.dev/mcp"

# 6. Restart LibreChat so the new mcpServers entry is picked up.
flyctl machine restart --app ai-agent-os-librechat
```

After deploy, toggle **`sandbox.run`** ON in `/admin/keys → Agent Permissions →
AI Agent OS Manager → Save permissions`. The Manager will then expose
`code_sandbox` to Gemini.

## API surface

The MCP server is mounted at `/mcp` (streamable-http transport). It speaks
JSON-RPC 2.0 over HTTP per the MCP spec. The tools it exposes:

- `run_code(language: str, code: str, timeout: int = 30) → object`
- `integrations_status() → { github: bool, gemini: bool }`

`/healthz` is the only unauthenticated endpoint (used by Fly's health check).
Every other path requires `Authorization: Bearer $SANDBOX_TOKEN`.

## Limits

- 64 KiB max code body
- 8 KiB max stdout / 4 KiB max stderr (truncated tail)
- 1..120 s wall-clock timeout (default 30 s)
- 256 MB RAM, 1 shared CPU (Fly free-tier vm)
- No persistent volume — every invocation starts in a fresh `/tmp/aaos-sandbox-*`
