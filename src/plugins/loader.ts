import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { paths, ensureDirs } from '../config/paths.js';
import { logger } from '../utils/logger.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { LifecycleHooks } from '../hooks/lifecycle-hooks.js';

export interface PluginManifest {
  name: string;
  version: string;
  description?: string;
  entry: string;
  enabled?: boolean;
}

export interface PluginContext {
  tools: ToolRegistry;
  hooks: LifecycleHooks;
  logger: typeof logger;
}

export interface PluginModule {
  default?: (ctx: PluginContext) => void | Promise<void>;
  activate?: (ctx: PluginContext) => void | Promise<void>;
}

export class PluginLoader {
  constructor(private readonly ctx: PluginContext) {
    ensureDirs();
  }

  async loadAll(dir?: string): Promise<PluginManifest[]> {
    const root = dir ?? paths.plugins;
    if (!existsSync(root)) return [];
    const loaded: PluginManifest[] = [];
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = join(root, entry.name, 'plugin.json');
      if (!existsSync(manifestPath)) continue;
      let manifest: PluginManifest;
      try {
        manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as PluginManifest;
      } catch (err) {
        logger.warn('plugin.manifest.parse-error', { dir: entry.name, error: String(err) });
        continue;
      }
      if (manifest.enabled === false) {
        logger.info('plugin.skip.disabled', { name: manifest.name });
        continue;
      }
      const entryPath = resolve(join(root, entry.name, manifest.entry));
      try {
        const mod = (await import(pathToFileURL(entryPath).href)) as PluginModule;
        const activator = mod.activate ?? mod.default;
        if (typeof activator === 'function') {
          await activator(this.ctx);
          loaded.push(manifest);
          logger.info('plugin.loaded', { name: manifest.name, version: manifest.version });
        } else {
          logger.warn('plugin.no-activator', { name: manifest.name });
        }
      } catch (err) {
        logger.error('plugin.load.error', {
          name: manifest.name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return loaded;
  }
}
