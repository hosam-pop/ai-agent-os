/**
 * WasmSandbox — policy wrapper around the Asterai WASM runtime.
 *
 * The existing `src/core/security/sandbox.ts` (if present) spawns a
 * child process. That approach is fast but offers weak isolation: the
 * child inherits the parent's filesystem permissions. A WebAssembly
 * sandbox gives us three things `child_process` cannot:
 *
 *   1. Deterministic resource limits (fuel / memory pages).
 *   2. Zero filesystem access unless we explicitly wire WASI.
 *   3. Portable, language-agnostic module format.
 *
 * This class does NOT replace `child_process` globally. It is an
 * opt-in secondary path behind `ENABLE_ASTERAI_SANDBOX`. Callers wire
 * it into the places where they actually need hard isolation (e.g.
 * executing untrusted user code from chat).
 */

import { feature } from '../config/feature-flags.js';
import { AsteraiRuntime, type AsteraiRunResult } from '../integrations/asterai/asterai-runtime.js';

export interface WasmSandboxOptions {
  readonly runtime?: AsteraiRuntime;
  readonly wasmDir?: string;
  readonly timeoutMs?: number;
  /**
   * If provided, only modules whose basename is in this allow-list
   * may be executed.
   */
  readonly allowedModules?: readonly string[];
}

export interface WasmExecutionRequest {
  readonly modulePath: string;
  readonly exportName: string;
  readonly payload: string;
}

export interface WasmExecutionResult extends AsteraiRunResult {
  readonly sandbox: 'wasm' | 'disabled';
}

export class WasmSandbox {
  private readonly runtime: AsteraiRuntime;
  private readonly opts: WasmSandboxOptions;

  constructor(opts: WasmSandboxOptions = {}) {
    this.opts = opts;
    this.runtime =
      opts.runtime ??
      new AsteraiRuntime({
        wasmDir: opts.wasmDir,
        timeoutMs: opts.timeoutMs,
      });
  }

  /** Returns true when the feature flag is enabled AND an allow-list, if any, is satisfied. */
  canExecute(req: WasmExecutionRequest): boolean {
    if (!feature('ASTERAI_SANDBOX')) return false;
    if (!this.opts.allowedModules) return true;
    const basename = req.modulePath.split(/[\\/]/).pop() ?? req.modulePath;
    return this.opts.allowedModules.includes(basename);
  }

  async execute(req: WasmExecutionRequest): Promise<WasmExecutionResult> {
    if (!this.canExecute(req)) {
      return {
        ok: false,
        error: 'wasm-sandbox-disabled',
        durationMs: 0,
        sandbox: 'disabled',
      };
    }
    const result = await this.runtime.run(req.modulePath, req.exportName, req.payload);
    return { ...result, sandbox: 'wasm' };
  }
}
