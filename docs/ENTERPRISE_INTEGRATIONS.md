# Enterprise Integrations

This PR wires eight real, maintained npm packages into `ai-agent-os` behind
feature flags. Every adapter is off by default and soft-fails when its env
vars are missing, so enabling a subset never destabilizes the baseline
agent loop.

## Layers at a glance

| Layer | Adapter | Package | Flag |
|---|---|---|---|
| Gateway | `ComposioGateway` | `@composio/core` | `DOGE_FEATURE_COMPOSIO` |
| Vault | `ArcadeVault` | `@arcadeai/arcadejs` | `DOGE_FEATURE_ARCADE` |
| Security | `IronCurtainGuard` | local TS (no dep) | `DOGE_FEATURE_IRON_CURTAIN` |
| Identity | `KavachAuth` | `kavachos` | `DOGE_FEATURE_KAVACH` |
| Observability | `LangfuseTracer` | `langfuse` | `DOGE_FEATURE_LANGFUSE` |
| Observability | `PostHogAnalytics` | `posthog-node` | `DOGE_FEATURE_POSTHOG` |
| Observability | `OpenLITTracer` | `openlit` | `DOGE_FEATURE_OPENLIT` |
| Observability | `AgentWatchAdapter` | `@nicofains1/agentwatch` | `DOGE_FEATURE_AGENTWATCH` |
| Testing | `AgentestRunner` | `@agentesting/agentest` | `DOGE_FEATURE_AGENTEST` |
| Orchestration | `ToolDiscoveryNode` | (uses `ComposioGateway`) | `DOGE_FEATURE_TOOL_DISCOVERY` |

## Tool execution pipeline

`ToolRegistry.invoke` now supports an optional policy chain:

```
caller -> zod schema parse
       -> IronCurtainGuard.checkInput    (input deny rules)
       -> KavachAuth.authorize           (agent identity + scope)
       -> ArcadeVault.executeTool        (if the tool is vault-claimed)
          OR local Tool.run
       -> IronCurtainGuard.sanitizeOutput (secret scrubbing)
       -> caller
```

The policy is wired via `registry.configurePolicy({ guard, auth, vault })`.
When `configurePolicy` is never called the registry is byte-for-byte
compatible with the pre-PR behavior — this is how the 169 existing tests
stay green.

## Intent-aware tool discovery

`buildToolDiscoveryNode({ gateway })` returns a `NodeFn` that can be
dropped into any `StateGraph` flow. Before each planner step, the node
asks `ComposioGateway.suggestBetterTool(intent, plannedTool)` and, if a
candidate beats the score threshold, updates `state.selectedTool`.
Inspiration: ACI.dev's "agents should pick the best tool at runtime"
philosophy.

## Excluded references and why

The second reference list requested several packages that are not
viable for a TypeScript integration:

- **TurboQuant-Pro / ZeroKV-Neo** — KV-cache compression research,
  Python + CUDA only. No npm distribution.
- **wuwangzhang1216/openDB** — Python research project, not on npm.
- **Kleos / engram** — the author states the project is being rewritten
  in Rust and "probably won't be updated in its current state".
- **OneCLI / Wirken** — Rust services; no npm SDK. If you run them
  locally you can wire HTTP adapters the same way we wired the Vigil /
  Semgrep-MCP adapters in prior PRs.
- **Jarvis-Registry (ascending-llc)** — Python MCP gateway service, not
  an npm package. Same story as OneCLI / Wirken.
- **IronCurtain (helpnetsecurity/IronCurtain)** — the repo at that path
  does not exist. The real project is `provos/ironcurtain`, which its
  author explicitly labels "Research Prototype. APIs may change." We
  therefore ship a local TypeScript implementation with the same input
  and output-guard responsibilities (`IronCurtainGuard`), so the idea is
  in the codebase without a pre-alpha dependency.
- **ZeroID** — the upstream repository is 95% Go; there is no `zeroid`
  package on npm. We replace it with `kavachos`, which is TS-first and
  provides the same "agent identity + scoped permissions" capability.
- **Mem0** — already integrated in PR #1.

## Enabling a layer

Example (Composio + Arcade + Langfuse):

```
# .env
DOGE_FEATURE_COMPOSIO=true
COMPOSIO_API_KEY=ck_live_...
COMPOSIO_USER_ID=hosam-pop

DOGE_FEATURE_ARCADE=true
ARCADE_API_KEY=arc_...

DOGE_FEATURE_LANGFUSE=true
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
```

No other code change is required; each adapter picks up the env vars
the first time it is constructed.

## Tests

- `npm test` — 207/207 pass (169 baseline + 38 new).
- New suites live under `tests/unit/enterprise/`:
  - `composio-gateway.test.ts`
  - `arcade-vault.test.ts`
  - `iron-curtain-guard.test.ts`
  - `kavach-auth.test.ts`
  - `observability.test.ts` (Langfuse + PostHog + OpenLIT + AgentWatch)
  - `agentest-runner.test.ts`
  - `tool-discovery-node.test.ts`
  - `registry-policy.test.ts` (end-to-end pipeline)

Each adapter test injects a fake `loader` so the real SDK is never
contacted during `npm test`. The production path uses the real SDK via
a dynamic `import('...')`.
