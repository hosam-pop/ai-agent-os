# Python Integration Roadmap

This repository targets the Node.js / TypeScript runtime. Several tools
the community keeps requesting — TurboQuant-Pro, ZeroKV-Neo, openDB,
Cognee, AgentOpt — are distributed only as Python packages. Rather than
vendor broken Node shims, this document captures the two integration
patterns we consider *ready to implement* when a concrete need appears.

## When to reach for Python

Use the subprocess pattern when:

- The tool ships a stable CLI, no HTTP daemon.
- Latency is not in the hot path (daily ingest, offline compression).
- You control the host and can install Python dependencies.

Use the FastAPI-sidecar pattern when:

- The tool is stateful (model weights, ANN indexes) and reload cost is
  high.
- Multiple TypeScript callers need concurrent access.
- The tool has an existing FastAPI / gRPC surface upstream.

## Pattern 1 — One-shot subprocess

```ts
import { spawn } from 'node:child_process';

export async function runPythonTool(
  bin: string,
  args: readonly string[],
  stdin: string,
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return await new Promise((resolve) => {
    const proc = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => (stdout += d));
    proc.stderr.on('data', (d) => (stderr += d));
    proc.on('close', (code) => {
      resolve({ ok: code === 0, stdout, stderr });
    });
    proc.stdin.end(stdin);
  });
}
```

Wrap the call in a feature flag (`ENABLE_PY_TURBOQUANT`, etc.) and
log stderr through `utils/logger.ts` so failures are visible in
production traces.

## Pattern 2 — FastAPI sidecar

1. Stand up `python -m uvicorn <tool>.server:app --port 8765` as a
   systemd / docker-compose service.
2. Create a thin HTTP adapter in `src/integrations/<tool>/` that follows
   the same shape used by `OpenFangBridge` and `QualixarBridge` in this
   PR: `endpoint`, `apiKey`, `fetchImpl`, soft-fail on missing config.
3. Expose a single method surface (`compress`, `store`, `retrieve`) so
   swapping implementations later is a drop-in change.

## Tool-by-tool notes

| Tool | Strategy | Notes |
| :--- | :--- | :--- |
| **TurboQuant-Pro** | FastAPI sidecar | CUDA-only. Pin a GPU host. |
| **ZeroKV-Neo** | subprocess | Stateless compression; no sidecar needed. |
| **openDB** | FastAPI sidecar | Document store; stateful. |
| **Cognee** | FastAPI sidecar | Knowledge-graph ingest; keep single writer. |
| **AgentOpt** | subprocess | Router evaluation runs offline. |

All of the above remain intentionally *not implemented* in this PR.
When a concrete workload justifies one of them, open a follow-up PR
that adds the adapter plus a feature flag in `src/config/env-loader.ts`.
