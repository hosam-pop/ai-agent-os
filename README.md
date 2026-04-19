# AI Agent OS

Unified autonomous agent runtime that integrates architectural ideas from two
open-source projects — [pengchengneo/Claude-Code](https://github.com/pengchengneo/Claude-Code)
and [HELPMEEADICE/doge-code](https://github.com/HELPMEEADICE/doge-code) — into a
clean, cohesive TypeScript stack.

It provides a Think → Plan → Act → Observe agent loop, a pluggable provider
layer (Anthropic, OpenAI, or any OpenAI-compatible endpoint), short- and
long-term memory with automatic context compression, a sandboxed tool
registry (bash / file / web), task decomposition with a parallel DAG
orchestrator, plugin hooks, a permission engine, and an interactive Ink TUI.
The experimental Claude-Code modules — BUDDY, KAIROS, ULTRAPLAN, COORDINATOR,
BRIDGE — are included behind feature flags.

On top of that base, **Ultimate Integrations** add an in-conversation AdminTool
and seven opt-in integration slots under `src/integrations/`:

| Slot | What you get | Feature flag |
| --- | --- | --- |
| `browser/` | Playwright-based `BrowserTool` (navigate, click, type, extract, screenshot) | `DOGE_FEATURE_BROWSER` |
| `mem0/` | Semantic long-term memory via the [mem0ai](https://github.com/mem0ai/mem0) SDK, with local fallback | `DOGE_FEATURE_MEM0` |
| `mcp/` | Generic MCP client (connects to [ultimate_mcp_server](https://github.com/Dicklesworthstone/ultimate_mcp_server), [0nMCP](https://github.com/0nork/0nMCP), or any other MCP server over stdio/HTTP) | `DOGE_FEATURE_MCP` |
| `social/` | Twitter / LinkedIn / Slack / Calendar tool wrappers that delegate to the MCP server | `DOGE_FEATURE_SOCIAL` |
| `router/` | Multi-provider router (failover / round-robin / weighted / least-recent) across any mix of Anthropic, OpenAI, and OpenAI-compatible endpoints | `DOGE_FEATURE_ROUTER` |
| `openclaw/` | Channel adapters inspired by [openclaw](https://github.com/openclaw/openclaw): pluggable base + concrete Telegram long-poll and Slack Events/webhook adapters | `DOGE_FEATURE_SOCIAL` |
| `local-llm/` | [Octoroute](https://github.com/slb350/octoroute)-style preset pointing the OpenAI provider at a local Ollama / LM Studio gateway | `DOGE_FEATURE_OCTOROUTE` |

The `admin` tool (on by default via `DOGE_FEATURE_ADMIN=true`) lets the agent
switch providers, change the default model, toggle feature gates, and add API
keys from inside a conversation — it writes the `.env` and hot-reloads the
provider cache without a restart.

## Defensive security tools (`src/security/`)

A four-family defensive command centre lives under `src/security/`. Every
family is opt-in via its own feature flag and every external binary / service
is optional — tools return a clean `ok: false` error if their dependency is
missing instead of crashing the agent.

| Family | Purpose | Engines / clients | Feature flag |
| --- | --- | --- | --- |
| `sast/` | Static code analysis — find bugs and vulnerabilities in source before it ships | [Semgrep](https://github.com/semgrep/semgrep) (via `semgrep --json`), [CodeQL](https://github.com/github/codeql) (via `codeql database analyze ... --format=sarif-latest`), [Bearer](https://github.com/Bearer/bearer) (via `bearer scan ... --format json`) | `DOGE_FEATURE_SAST` |
| `dast/` | Dynamic analysis of running web apps | [Nuclei](https://github.com/projectdiscovery/nuclei) (JSONL streaming), [OWASP ZAP](https://github.com/zaproxy/zaproxy) baseline (JSON report) | `DOGE_FEATURE_DAST` |
| `container/` | Container-image and SBOM vulnerability scanning | [Grype](https://github.com/anchore/grype) (`grype <target> -o json`), [Trivy](https://github.com/aquasecurity/trivy) (`trivy image/fs/repo --format json`) | `DOGE_FEATURE_CONTAINER_SCAN` |
| `log-analysis/` | Threat hunting across centralised logs | [Elasticsearch / ELK](https://github.com/elastic/elasticsearch) (`_search` DSL), [Wazuh](https://github.com/wazuh/wazuh) REST API | `DOGE_FEATURE_LOG_ANALYSIS` |
| `ids/` | Monitor network traffic for malicious activity | [Suricata](https://github.com/OISF/suricata) `eve.json` stream reader | `DOGE_FEATURE_IDS` |
| `runtime/` | Runtime-security telemetry from Linux kernel hooks | [Falco](https://github.com/falcosecurity/falco) JSON log reader (`/var/log/falco/falco.json`) | `DOGE_FEATURE_RUNTIME_MONITOR` |

Each family exposes a single unified tool to the agent (`sast`, `dast`,
`container_scan`, `log_analysis`, `ids`, `runtime_monitor`) that selects the
concrete engine at call time. Parsers are pure functions — the heavy lifting
(process execution, HTTP, streaming files) is isolated in the runners /
clients so the parsing logic is easy to unit-test without touching the
network or any external binary.

## Agent orchestration primitives (`src/orchestration/`)

Four lightweight orchestration building blocks, each inspired by a widely
used open-source framework and ported as a native TypeScript module. They
are library-level primitives — enable `DOGE_FEATURE_ORCHESTRATION=true` to
signal they are in use and import them directly from `src/orchestration/`.

| Primitive | Inspiration | What it models |
| --- | --- | --- |
| `Crew` (`crew.ts`) | [CrewAI](https://github.com/crewAIInc/crewAI) | A team of role-bearing agents executing a task list sequentially or hierarchically, with dependency-aware ordering. |
| `GroupChat` (`group-chat.ts`) | [AutoGen](https://github.com/microsoft/autogen) | Multi-agent conversations with pluggable speaker selectors (round-robin, keyword) and termination predicates. |
| `StateGraph` (`state-graph.ts`) | [LangGraph](https://github.com/langchain-ai/langgraph) | Directed graph of async nodes over an immutable state, with conditional routing and an `END` sentinel. |
| `TaskQueue` (`task-queue.ts`) | [SuperAGI](https://github.com/TransformerOptimus/SuperAGI) | Priority-ordered queue with a goal decomposer; executors may enqueue follow-up tasks until the budget drains. |

**Authorisation**: `dast` is marked `dangerous: true`. Only scan assets you own
or have written permission to test. The tool will never exploit findings — it
reports them for a human or another defensive tool to triage.

## Requirements

- Node.js **≥ 20**
- Bun **≥ 1.1** (for `bun run dev`; optional — `npm` works too)
- An API key for your chosen provider (Anthropic or OpenAI)

## Install

```bash
git clone https://github.com/<your-account>/ai-agent-os.git
cd ai-agent-os
npm install
cp .env.example .env
# fill in ANTHROPIC_API_KEY or OPENAI_API_KEY in .env
```

## Run

Development (no build step, via Bun):

```bash
bun run dev run "summarize README.md in 3 bullets"
```

Production (compile then run on Node):

```bash
npm run build
npm start run "summarize README.md in 3 bullets"
```

## CLI

| Command | Purpose |
| --- | --- |
| `run <goal>` | Execute a single goal through the agent loop |
| `plan <goal>` | Decompose into a DAG and run with the parallel orchestrator |
| `tui <goal>` | Launch the interactive Ink TUI |
| `inspect` | Print registered tools, feature gates, and last trace |
| `list` | List long-term memory records |
| `debug <goal>` | Run with verbose tracing |
| `features` | Show feature-gate status |
| `ultraplan <goal>` | Heavy planning (requires `DOGE_FEATURE_ULTRAPLAN=true`) |
| `buddy <userId>` | Roll deterministic virtual buddy (requires `DOGE_FEATURE_BUDDY=true`) |
| `kairos:consolidate` | Run KAIROS daily consolidation (requires `DOGE_FEATURE_KAIROS=true`) |

## Environment variables

See [`.env.example`](./.env.example) for the full list. Highlights:

- `DOGE_PROVIDER` — `anthropic` | `openai` | `custom`
- `DOGE_MODEL` — model name passed to the provider
- `DOGE_HOME` — on-disk state directory (default `~/.doge/`, mirroring doge-code)
- `DOGE_WORKSPACE` — sandbox root for file & bash tools
- `DOGE_PERMISSION_MODE` — `strict` | `default` | `permissive`
- `DOGE_ALLOW_NETWORK`, `DOGE_ALLOW_WRITES` — hard switches for the web/file tools
- `DOGE_FEATURE_BUDDY`, `DOGE_FEATURE_KAIROS`, `DOGE_FEATURE_ULTRAPLAN`, `DOGE_FEATURE_COORDINATOR`, `DOGE_FEATURE_BRIDGE` — experimental modules
- `DOGE_FEATURE_ADMIN`, `DOGE_FEATURE_BROWSER`, `DOGE_FEATURE_MEM0`, `DOGE_FEATURE_MCP`, `DOGE_FEATURE_ROUTER`, `DOGE_FEATURE_SOCIAL`, `DOGE_FEATURE_OCTOROUTE` — Ultimate Integrations
- `DOGE_FEATURE_SAST`, `DOGE_FEATURE_DAST`, `DOGE_FEATURE_LOG_ANALYSIS`, `DOGE_FEATURE_IDS` — defensive security tool families
- `MEM0_API_KEY`, `MCP_SERVER_URL` / `MCP_SERVER_STDIO`, `DOGE_ROUTER_CONFIG`, `OCTOROUTE_URL`, `TELEGRAM_BOT_TOKEN`, `SLACK_BOT_TOKEN` / `SLACK_WEBHOOK_URL` — integration credentials (all optional, every integration fails soft when its key is missing)
- `SEMGREP_BIN`, `CODEQL_BIN`, `NUCLEI_BIN`, `ZAP_BIN` — override binary lookup for SAST / DAST engines
- `ELASTIC_URL` + (`ELASTIC_API_KEY` | `ELASTIC_USERNAME`/`ELASTIC_PASSWORD`), `WAZUH_URL` + credentials, `SURICATA_EVE_PATH` — defensive backends

## Docker

```bash
npm run docker:build                 # build the image
docker compose -f docker/docker-compose.yml up    # bring up the container
```

The compose file mounts `./workspace` as `/workspace` inside the container so
any files the agent reads or writes live on your host. A named volume
(`doge-home`) preserves `~/.doge/` state across restarts.

Pass commands to the container:

```bash
docker compose -f docker/docker-compose.yml run --rm ai-agent-os run "hello"
```

## Architecture

```
src/
  core/            agent-loop, planner, executor, orchestrator
  api/             provider-interface + anthropic/openai/factory
  memory/          short-term, long-term, summarizer
  tools/           registry, bash, file, web, sandbox, admin
  tasks/           decomposition, dependency-graph
  agents/          sub-agent-manager, communication bus
  cli/             commander CLI + Ink TUI
  permissions/     policy-engine + config-rules
  plugins/         plugin loader + marketplace
  hooks/           lifecycle hooks (preTask, postTask, pre/postToolCall, onError)
  utils/           logger, debug/tracing
  config/          env-loader, paths (~/.doge by default), feature-flags
  features/        BUDDY, KAIROS, ULTRAPLAN, COORDINATOR, BRIDGE (gated)
  integrations/    browser, mem0, mcp, social, router, openclaw, local-llm
  security/        sast (Semgrep, CodeQL), dast (Nuclei, ZAP),
                   log-analysis (Elasticsearch, Wazuh), ids (Suricata)
tests/
  unit/            unit tests
  integration/     integration tests
docker/            Dockerfile (multi-stage) + docker-compose.yml
workspace/         default sandbox root (mounted as a Docker volume)
```

## Tests

```bash
npm run build       # required once, because tests import the compiled dist
npm test
```

## Integrated components

| From | Component | Where it lives |
| --- | --- | --- |
| Claude-Code | BUDDY (virtual pet, deterministic rolls) | `src/features/buddy.ts` |
| Claude-Code | KAIROS (persistent assistant, daily logs, consolidation) | `src/features/kairos.ts` |
| Claude-Code | ULTRAPLAN (heavy-model planner) | `src/features/ultraplan.ts` |
| Claude-Code | COORDINATOR (multi-agent dispatch) | `src/features/coordinator.ts`, `src/agents/` |
| Claude-Code | BRIDGE (local HTTP control surface) | `src/features/bridge.ts` |
| Claude-Code | Feature-gating pattern | `src/config/feature-flags.ts` |
| doge-code | `~/.doge/` path layout | `src/config/paths.ts` |
| doge-code | Custom OpenAI-compatible provider | `src/api/openai-provider.ts`, `src/api/provider-factory.ts` |
| doge-code | Bun-first dev, Node.js-compatible runtime | `package.json`, `docker/Dockerfile` |
| New | Unified agent loop and DAG orchestrator | `src/core/`, `src/tasks/` |
| New | Provider-agnostic abstraction | `src/api/provider-interface.ts` |
| New | Sandboxed tool registry and policy engine | `src/tools/`, `src/permissions/` |

## License

MIT — see [LICENSE](LICENSE) if present. Experimental modules ported from
Claude-Code are named after their upstream origins; the code here is an
independent re-implementation.
