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
  tools/           registry, bash, file, web, sandbox
  tasks/           decomposition, dependency-graph
  agents/          sub-agent-manager, communication bus
  cli/             commander CLI + Ink TUI
  permissions/     policy-engine + config-rules
  plugins/         plugin loader + marketplace
  hooks/           lifecycle hooks (preTask, postTask, pre/postToolCall, onError)
  utils/           logger, debug/tracing
  config/          env-loader, paths (~/.doge by default), feature-flags
  features/        BUDDY, KAIROS, ULTRAPLAN, COORDINATOR, BRIDGE (gated)
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
