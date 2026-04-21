# ai-agent-os — demo & feature-flag cheat-sheet

This file documents how to run the agent locally and how to enable the
optional enterprise integrations shipped by the
`enterprise-architecture-v1` PR.

## Quick start

```bash
npm install
npm run build
npm test     # 241 tests expected
```

Set `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY`) in `.env`, then:

```bash
npm run dev
```

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
