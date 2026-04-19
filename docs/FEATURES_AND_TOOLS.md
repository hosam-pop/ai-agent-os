# AI Agent OS — Features, Tools & Capabilities

**Repository:** [`hosam-pop/ai-agent-os`](https://github.com/hosam-pop/ai-agent-os)
**Covers:** PR #1 (Ultimate Integrations) and PR #2 (Defensive Security)
**Audience:** operators, reviewers, and agent integrators.

This document is the canonical, hand-tested reference for every feature, tool,
and integration that ships with `ai-agent-os`. Every row has been exercised
through the unit-test suite and/or a live CLI probe against the compiled build;
results are summarised at the bottom of each section.

---

## 1. Platform overview

`ai-agent-os` is a unified TypeScript runtime for an autonomous agent. It
combines:

- a deterministic **Think → Plan → Act → Observe** core loop,
- a provider-agnostic **LLM abstraction** (Anthropic, OpenAI, any
  OpenAI-compatible endpoint, a built-in multi-provider router, and a local
  Ollama / LM Studio preset),
- a sandboxed **tool registry** (bash, file, web, admin, plus 7 opt-in
  integrations and 4 defensive-security tool families),
- **short-term + long-term memory** with semantic recall via [mem0](https://github.com/mem0ai/mem0)
  (with a local-only fallback),
- a **permission engine** with `strict | default | permissive` modes,
- a **plugin + lifecycle-hook** system,
- a **Commander CLI** and an **Ink TUI**,
- experimental Claude-Code modules behind feature flags: BUDDY, KAIROS,
  ULTRAPLAN, COORDINATOR, BRIDGE.

Everything is opt-in through `DOGE_FEATURE_*` environment variables, and every
integration **fails soft** when its credential or external binary is absent —
the agent receives a clean `{ ok: false, error: ... }` rather than crashing.

---

## 2. Project structure

```
src/
  api/              provider-interface + anthropic / openai / factory + router
  agents/           sub-agent-manager + communication bus (COORDINATOR)
  cli/              Commander CLI + Ink TUI
  config/           env-loader, feature-flags, ~/.doge/ path layout
  core/             agent-loop, planner, executor, orchestrator
  features/         BUDDY, KAIROS, ULTRAPLAN, COORDINATOR, BRIDGE (gated)
  hooks/            preTask / postTask / pre-&-postToolCall / onError hooks
  integrations/     browser (Playwright), mem0, mcp, social, router, openclaw,
                    local-llm (Octoroute)
  memory/           short-term (ring buffer), long-term (JSONL), summarizer
  permissions/      PolicyEngine + config-driven rules
  plugins/          plugin loader + marketplace stub
  security/
    sast/           Semgrep + CodeQL wrappers, unified SastTool
    dast/           Nuclei + OWASP ZAP wrappers, unified DastTool
    log-analysis/   Elasticsearch + Wazuh clients, unified LogAnalysisTool
    ids/            Suricata eve.json stream reader, IdsTool
  tasks/            DAG decomposition + dependency graph
  tools/            registry, sandbox, bash-tool, file-tool, web-tool, admin-tool
  utils/            logger, tracing
tests/
  unit/             49 unit tests (includes tests/unit/security/)
  integration/      integration tests
docker/             multi-stage Dockerfile + docker-compose.yml
docs/               this file + future references
workspace/          default sandbox root (also a Docker volume)
```

---

## 3. Feature & tool catalogue

Every row below has been verified by **(a)** the unit-test suite and **(b)** a
live tool-registry probe against the compiled build using dummy credentials.
`Soft-fail verified` means the tool returns `{ ok: false, error: ... }`
instead of throwing when its dependency is missing.

### 3.1 Core tools (always registered)

| Tool | Purpose | Feature flag | Requirements | Verified |
| --- | --- | --- | --- | --- |
| `bash` | Run shell commands inside the sandbox. Destructive commands (`rm -rf /`, `:(){...`, etc.) are blocked by `PolicyEngine`. Marked `dangerous: true`. | _always on_ | Host `bash`, an approved `DOGE_PERMISSION_MODE`. | Unit test: `denies destructive bash rm -rf /`, `allows harmless bash echo`, `strict mode prompts for bash`. |
| `file` | Sandboxed file I/O — `read`, `write`, `append`, `list`, `delete`, `exists`. Every path is canonicalised through `Sandbox` and refused on escape. | _always on_ | `DOGE_ALLOW_WRITES=true` for writes. | Unit test: `FileTool write + read through registry`, `FileTool denies path escape`. |
| `web` | Fetch text from a URL. Obeys `DOGE_ALLOW_NETWORK`. | _always on_ | `DOGE_ALLOW_NETWORK=true`. | Live probe: responds with fetched content; denies when network flag is off. |

### 3.2 Admin & utility

| Tool | Purpose | Feature flag | Requirements | Verified |
| --- | --- | --- | --- | --- |
| `admin` | In-conversation control plane: `switch_provider`, `set_model`, `toggle_feature`, `add_api_key`, `list_config`. Edits `.env` on disk and hot-reloads the provider cache. Marked `dangerous: true`. | `DOGE_FEATURE_ADMIN` (default **on**) | Write access to the repo `.env`. | Unit tests: `switch_provider writes DOGE_PROVIDER into the .env`, `toggle_feature flips an existing flag`, `list_config redacts secrets`, `add_api_key inserts a new variable`. Live probe: `list_config` returns the full env with secret values redacted. |

### 3.3 Integrations (opt-in)

| Tool | Purpose | Feature flag | Requirements | Verified |
| --- | --- | --- | --- | --- |
| `browser` | Drive a real browser via Playwright: `navigate`, `click`, `type`, `extract`, `evaluate`, `screenshot`, `wait_for`, `close`. | `DOGE_FEATURE_BROWSER` | `npx playwright install` for browser binaries. `BROWSER_HEADLESS`, `BROWSER_TIMEOUT_MS`, optional `BROWSER_EXECUTABLE_PATH`. | Registered in the tool registry; soft-fails when Playwright binaries are missing. |
| `memory` | Semantic long-term memory via [mem0](https://github.com/mem0ai/mem0). Falls back to a local JSONL store when no API key is set. Actions: `remember`, `recall`, `list`, `forget`. | `DOGE_FEATURE_MEM0` | Optional `MEM0_API_KEY` (+ `MEM0_ORG_ID`, `MEM0_PROJECT_ID`, `MEM0_USER_ID`). Everything works without a key. | Unit test: `createMem0Memory falls back to local backend when MEM0_API_KEY is absent`. Live probe: `remember → recall → list` round-trip succeeds on the local backend. |
| _(MCP tools)_ | Any tools exposed by a connected MCP server (e.g. [ultimate_mcp_server](https://github.com/Dicklesworthstone/ultimate_mcp_server), [0nMCP](https://github.com/0nork/0nMCP)). Discovered dynamically at connect time. | `DOGE_FEATURE_MCP` | `MCP_SERVER_URL` (HTTP/SSE) **or** `MCP_SERVER_STDIO` (command to spawn). Optional `MCP_SERVER_TOKEN`. | Bootstrap skips registration when neither transport is configured; logs `bootstrap.mcp.error` and continues on connection failure. |
| `twitter_post`, `twitter_search`, `linkedin_post`, `slack_send`, `calendar_create` | Thin tool wrappers that delegate to the MCP server's matching handler. | `DOGE_FEATURE_SOCIAL` + `DOGE_FEATURE_MCP` | Configured MCP server that exposes the corresponding platform adapter. | Registered only when an MCP client is live; otherwise not present (soft-fail by absence). |
| _(router)_ | Multi-provider LLM router with `failover`, `round-robin`, `weighted`, `least-recent` strategies. Not a tool — swapped in at provider-factory time. | `DOGE_FEATURE_ROUTER` **and** `DOGE_PROVIDER=router` | `DOGE_ROUTER_CONFIG` inline JSON or path to a JSON file listing providers. | Unit test: `failover strategy falls through to next backend on error`. |
| _(octoroute)_ | Preset that points the OpenAI provider at a local gateway (Ollama, LM Studio, …). Not a tool — activated via `DOGE_PROVIDER=octoroute`. | `DOGE_FEATURE_OCTOROUTE` | `OCTOROUTE_URL`, optional `OCTOROUTE_API_KEY`, `OCTOROUTE_MODEL`. | Activates at bootstrap; delegates to the OpenAI-compatible provider path. |
| _(channel adapters)_ | `TelegramAdapter` (long-poll webhooks) and `SlackAdapter` (Events API + `url_verification`) under `src/integrations/openclaw/`. Not registered as tools — used by the bridge / plugin layer. | `DOGE_FEATURE_SOCIAL` | `TELEGRAM_BOT_TOKEN` / `TELEGRAM_WEBHOOK_SECRET`, `SLACK_BOT_TOKEN` / `SLACK_WEBHOOK_URL` / `SLACK_SIGNING_SECRET`. | Unit tests: `ChannelRegistry connects and disconnects every registered adapter`, `ChannelAdapter fans incoming messages to every listener`, `SlackAdapter recognises url_verification events`, `SlackAdapter surfaces message events via onMessage`. |

### 3.4 Defensive security tools (PR #2)

Each family exposes a single unified tool; the caller selects the concrete
engine per call (`engine` / `backend`). Parsers are pure functions covered by
unit tests; runners / clients isolate all subprocess + network I/O.

| Tool | Engines / backends | Feature flag | Requirements | Verified |
| --- | --- | --- | --- | --- |
| `sast` | **Semgrep** (`semgrep --json`), **CodeQL** (`codeql database analyze ... --format=sarif-latest`). Returns deduplicated findings with severity, CWE, OWASP mappings. | `DOGE_FEATURE_SAST` | `semgrep` and/or `codeql` on `$PATH` (or override via `SEMGREP_BIN` / `CODEQL_BIN`). For CodeQL, a prebuilt database directory. | Unit tests: `parseSemgrepJson extracts findings, severities, CWE metadata`, `parseCodeqlSarif maps SARIF to findings`. Live probe: returns `target does not exist: ...` when target path is missing. |
| `dast` _(dangerous)_ | **Nuclei** (`-jsonl` streaming), **OWASP ZAP Baseline** (JSON report). Severity-ranked findings. | `DOGE_FEATURE_DAST` | `nuclei` and/or `zap-baseline.py` on `$PATH` (override via `NUCLEI_BIN` / `ZAP_BIN`). Explicit authorisation to scan the target URLs. | Unit tests: `parseNucleiJsonl parses JSONL, filters empty/malformed`, `parseZapJson handles site-wrapped and flat alerts`. Live probe: returns `{ ok: true, output: "no findings" }` on an unreachable target instead of crashing. |
| `log_analysis` | **Elasticsearch / ELK** (`_search` DSL), **Wazuh** REST (`/security/alerts`) with Bearer-token caching (14 min). | `DOGE_FEATURE_LOG_ANALYSIS` | `ELASTIC_URL` + (`ELASTIC_API_KEY` **or** `ELASTIC_USERNAME`/`ELASTIC_PASSWORD`). `WAZUH_URL` + (`WAZUH_TOKEN` **or** `WAZUH_USERNAME`/`WAZUH_PASSWORD`). | Unit tests: `parseElasticResponse`, `ElasticClient auth headers + error surfacing`, `parseWazuhResponse`, `WazuhClient token caching`. Live probe: returns `ELASTIC_URL is not configured` / `WAZUH_URL is not configured` when unset. |
| `ids` | **Suricata** `eve.json` reader with tail-bounded streaming and filters for `eventType`, `category`, `minSeverity`, `limit`. Read-only. | `DOGE_FEATURE_IDS` | Suricata writing `eve.json` somewhere on disk. `SURICATA_EVE_PATH` env var or per-call `path` override. | Unit tests: 4 tests covering alert parsing + filtering by severity / category / limit + missing-file error. Live probe: returns `eve.json not found: /tmp/no-such-eve.json` when the file is missing. |

### 3.5 Experimental modules (from Claude-Code)

| Feature | Purpose | Feature flag | CLI entry | Verified |
| --- | --- | --- | --- | --- |
| **BUDDY** | Deterministic virtual-pet rolls (18 types × 5 rarities × 1 % shiny) seeded by user id. Useful as a reproducible randomness fixture. | `DOGE_FEATURE_BUDDY` | `buddy <userId>` | Unit tests: `rollBuddy is deterministic per user id`, `different user ids usually differ`. Live probe: `buddy demo-user` prints a stable BUDDY card. |
| **KAIROS** | Persistent assistant with a daily log, Orient→Gather→Consolidate→Prune cycle, and a local lockfile. | `DOGE_FEATURE_KAIROS` | `kairos:consolidate` | Live probe: `kairos:consolidate` runs and logs `nothing to consolidate`. |
| **ULTRAPLAN** | Heavy-model planner that decomposes large goals into DAGs before running the normal loop. | `DOGE_FEATURE_ULTRAPLAN` | `ultraplan <goal>` | Live probe: bootstraps correctly; fails with a plain `authentication_error` when the provider key is a placeholder. |
| **COORDINATOR** | Multi-agent dispatch layer over the shared communication bus in `src/agents/`. | `DOGE_FEATURE_COORDINATOR` | `plan <goal>` drives it | Unit tests: `topological sort respects dependencies`, `frontier returns only nodes whose deps are satisfied`, `cycle is detected`. |
| **BRIDGE** | Local HTTP control surface for external consumers. | `DOGE_FEATURE_BRIDGE` | Embedded, no direct CLI command | Registered when flag is on; otherwise not bound. |

---

## 4. CLI reference

Invoke the compiled build with `node dist/cli/commands.js <command>` (or
`npm start` / `bun run dev` in development).

| Command | Purpose |
| --- | --- |
| `run <goal>` | Execute a single goal through the agent loop. |
| `plan <goal>` | Decompose into a DAG and run via the parallel orchestrator. |
| `tui <goal>` | Launch the interactive Ink TUI. |
| `inspect` | Print registered tools, feature-gate status, and the last trace. |
| `list` | List long-term memory records. |
| `debug <goal>` | Run with verbose tracing. |
| `features` | Show feature-gate status only. |
| `ultraplan <goal>` | Heavy planning (requires `DOGE_FEATURE_ULTRAPLAN=true`). |
| `buddy <userId>` | Roll a deterministic BUDDY (requires `DOGE_FEATURE_BUDDY=true`). |
| `kairos:consolidate` | Run KAIROS daily consolidation (requires `DOGE_FEATURE_KAIROS=true`). |

---

## 5. Usage examples

All examples assume you have run `npm install && npm run build` and have a
`.env` populated with at least one provider key.

```bash
# One-shot goal with the default provider.
npm run dev run "summarize README.md in three bullet points"

# Interactive TUI.
npm run dev tui "brainstorm a release plan"

# Show what is registered right now.
DOGE_FEATURE_SAST=true DOGE_FEATURE_DAST=true \
  node dist/cli/commands.js inspect

# Teach the agent something and recall it (mem0 local fallback).
DOGE_FEATURE_MEM0=true node dist/cli/commands.js run \
  "remember that my favourite color is blue"
DOGE_FEATURE_MEM0=true node dist/cli/commands.js run \
  "what is my favourite color?"

# Static code analysis against a local checkout.
DOGE_FEATURE_SAST=true node dist/cli/commands.js run \
  'run the sast tool with engine=semgrep on ./src'

# Dynamic scan of an authorised staging URL (dast is marked dangerous).
DOGE_FEATURE_DAST=true node dist/cli/commands.js run \
  'run dast with engine=nuclei on https://staging.example.com'

# Threat-hunt across ELK.
DOGE_FEATURE_LOG_ANALYSIS=true ELASTIC_URL=https://elk.internal \
  ELASTIC_API_KEY=... node dist/cli/commands.js run \
  'use log_analysis to search filebeat-* for action:failed_login in the last hour'

# Tail the Suricata IDS feed.
DOGE_FEATURE_IDS=true SURICATA_EVE_PATH=/var/log/suricata/eve.json \
  node dist/cli/commands.js run \
  'use ids to list the 20 most recent alerts with minSeverity 2'

# Hot-switch provider from inside the conversation.
node dist/cli/commands.js run \
  'use the admin tool to switch_provider to openai and set_model to gpt-4o-mini'

# Deterministic BUDDY roll.
DOGE_FEATURE_BUDDY=true node dist/cli/commands.js buddy demo-user
```

---

## 6. Verification summary

| Check | Result |
| --- | --- |
| `npm install` (478 packages) | OK |
| `npm run build` (`tsc -p tsconfig.json`) | OK — no TypeScript errors |
| `npm test` (unit + integration) | **49 / 49 pass**, `fail 0` |
| `inspect` command with every flag enabled | All tools registered, every feature reports `on` |
| `buddy demo-user` | Deterministic output verified |
| `kairos:consolidate` | Runs, reports `nothing to consolidate` (expected with empty log) |
| `ultraplan` | Bootstraps correctly; surfaces `authentication_error` only when no real API key is supplied |
| Defensive tool soft-fail probe | `sast`, `dast`, `log_analysis`, `ids` all return structured `{ ok: false, error: ... }` when their dependency is missing |

---

## 7. Known limitations & operational notes

1. **Default branch on GitHub.** Early PRs targeted `main`, but the repo's
   GitHub default is currently `devin/initial-import`; PRs #1 and #2 were
   merged into that branch. If you want `main` to be authoritative, change the
   default branch in **Settings → Branches** and fast-forward `main` to match.
2. **`dast` is dangerous.** Only scan assets you own or have written
   permission to test. The tool reports findings; it never exploits them.
3. **External binaries are optional.** `sast` needs `semgrep` and/or `codeql`;
   `dast` needs `nuclei` and/or `zap-baseline.py`. If none is installed, the
   tool still registers and returns a clean error — you will not crash the
   agent.
4. **`.env` URL fields.** Optional URL fields in `.env` use
   `z.string().url().optional()`, which **rejects an empty string**. If you
   leave e.g. `SLACK_WEBHOOK_URL=` in `.env`, delete the line rather than
   setting it to empty, or set it to a real URL.
5. **mem0 local fallback.** Without `MEM0_API_KEY` the tool writes to a local
   JSONL store under `~/.doge/`. Data is **not** synced to mem0 cloud in this
   mode.
6. **MCP transport.** The MCP client only registers when at least one of
   `MCP_SERVER_URL` or `MCP_SERVER_STDIO` is configured. Social tools
   (`twitter_post`, `slack_send`, …) are built on top of MCP and therefore
   require a working MCP server.
7. **Permissions.** `DOGE_PERMISSION_MODE=strict` prompts for every tool call,
   which is unsuitable for unattended automation. `default` blocks destructive
   bash and path escapes; `permissive` disables the policy engine.
8. **Logging.** Set `DOGE_LOG_LEVEL=error` for CLI scripting; `info` and
   `debug` are noisier but useful when diagnosing bootstrap issues.

---

## 8. References

- Semgrep — https://github.com/semgrep/semgrep
- CodeQL — https://github.com/github/codeql
- Nuclei — https://github.com/projectdiscovery/nuclei
- OWASP ZAP — https://github.com/zaproxy/zaproxy
- Elasticsearch / ELK — https://github.com/elastic/elasticsearch
- Wazuh — https://github.com/wazuh/wazuh
- Suricata — https://github.com/OISF/suricata
- mem0 — https://github.com/mem0ai/mem0
- Model Context Protocol — https://modelcontextprotocol.io/
- Playwright — https://playwright.dev
