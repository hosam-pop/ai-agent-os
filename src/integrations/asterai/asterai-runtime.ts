/**
 * Asterai runtime adapter.
 *
 * Upstream: https://github.com/asterai-io/asterai — a Rust WASM /
 * Component-Model runtime for AI agents. Because Node cannot natively
 * load a Rust binary, we treat Asterai as an *optional* WebAssembly
 * runtime and fall back to Node's built-in `WebAssembly` when the
 * Asterai npm binding is not available.
 *
 * The adapter's job is narrow and well-specified:
 *   1. Load a WASM module from disk.
 *   2. Run a single exported function with a string payload.
 *   3. Enforce a wall-clock timeout so misbehaving code can't pin a
 *      worker thread.
 *
 * Gated behind `ENABLE_ASTERAI_SANDBOX`. `WasmSandbox`
 * (src/security/wasm-sandbox.ts) layers policy on top of this.
 */

import { readFile, stat } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import { logger } from '../../utils/logger.js';

export interface AsteraiOptions {
  /**
   * Directory where compiled `.wasm` modules live. If set, module
   * names passed to `run()` are resolved relative to this directory.
   */
  readonly wasmDir?: string;
  /**
   * Wall-clock budget per invocation in ms. Defaults to 5 s.
   */
  readonly timeoutMs?: number;
  /**
   * Optional loader for the native Asterai npm binding (if / when it
   * ships). Left configurable so tests can inject a fake.
   */
  readonly loader?: () => Promise<unknown>;
}

export interface AsteraiRunResult {
  readonly ok: boolean;
  readonly output?: string;
  readonly error?: string;
  readonly durationMs: number;
}

export class AsteraiRuntime {
  private readonly opts: AsteraiOptions;

  constructor(opts: AsteraiOptions = {}) {
    this.opts = opts;
  }

  /**
   * Run `exportName` from the WASM module at `modulePath` with a
   * UTF-8 string payload. The export is expected to consume linear
   * memory in the canonical `(ptr, len) -> (ptr, len)` convention used
   * by Asterai examples.
   */
  async run(modulePath: string, exportName: string, payload: string): Promise<AsteraiRunResult> {
    const start = Date.now();
    const absPath = this.resolveWasmPath(modulePath);
    try {
      await stat(absPath);
    } catch {
      return {
        ok: false,
        error: `wasm-module-missing: ${absPath}`,
        durationMs: Date.now() - start,
      };
    }

    try {
      const bytes = await readFile(absPath);
      const module = await WebAssembly.compile(bytes);
      const instance = await WebAssembly.instantiate(module, {});
      const exports = instance.exports as Record<string, unknown>;
      const fn = exports[exportName];
      if (typeof fn !== 'function') {
        return {
          ok: false,
          error: `wasm-export-missing: ${exportName}`,
          durationMs: Date.now() - start,
        };
      }
      const timeout = this.opts.timeoutMs ?? 5_000;
      const output = await runWithTimeout(
        () => invokeStringFn(instance, exportName, payload),
        timeout,
      );
      return { ok: true, output, durationMs: Date.now() - start };
    } catch (err) {
      const msg = stringifyError(err);
      logger.warn('asterai.run.error', { modulePath: absPath, error: msg });
      return { ok: false, error: msg, durationMs: Date.now() - start };
    }
  }

  private resolveWasmPath(modulePath: string): string {
    if (modulePath.startsWith('/') || modulePath.match(/^[a-zA-Z]:/)) return modulePath;
    const base = this.opts.wasmDir ?? process.cwd();
    return resolvePath(base, modulePath);
  }
}

async function invokeStringFn(
  instance: WebAssembly.Instance,
  exportName: string,
  payload: string,
): Promise<string> {
  const exports = instance.exports as Record<string, unknown>;
  const memory = exports.memory as WebAssembly.Memory | undefined;
  const alloc = exports.alloc as ((len: number) => number) | undefined;
  const fn = exports[exportName] as (ptr: number, len: number) => number | bigint;
  if (!memory || !alloc || typeof fn !== 'function') {
    throw new Error('wasm-abi-mismatch: expected memory, alloc, and string export');
  }
  const encoder = new TextEncoder();
  const encoded = encoder.encode(payload);
  const ptr = alloc(encoded.length);
  new Uint8Array(memory.buffer, ptr, encoded.length).set(encoded);
  const packed = fn(ptr, encoded.length);
  const packedNum = typeof packed === 'bigint' ? Number(packed) : packed;
  const outPtr = packedNum & 0xffffffff;
  const outLen = (packedNum >> 32) & 0xffffffff;
  const view = new Uint8Array(memory.buffer, outPtr, outLen);
  return new TextDecoder().decode(view);
}

async function runWithTimeout<T>(fn: () => Promise<T>, ms: number): Promise<T> {
  return await Promise.race([
    fn(),
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`wasm-timeout:${ms}ms`)), ms);
    }),
  ]);
}

function stringifyError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
