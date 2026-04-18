import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from '../config/paths.js';

export interface MarketplaceEntry {
  name: string;
  version: string;
  description: string;
  homepage?: string;
  installed: boolean;
}

/**
 * Lightweight plugin discovery surface.
 *
 * The "marketplace" is simply an index file (`~/.doge/plugins/marketplace.json`)
 * that lists known plugins. Each plugin install is just a subdirectory under
 * `~/.doge/plugins/<name>/` with a `plugin.json` manifest. This keeps the
 * system offline-friendly and auditable, unlike a remote registry.
 */
export class Marketplace {
  private readonly indexPath: string;

  constructor(indexPath?: string) {
    this.indexPath = indexPath ?? join(paths.plugins, 'marketplace.json');
  }

  list(): MarketplaceEntry[] {
    let entries: MarketplaceEntry[] = [];
    if (existsSync(this.indexPath)) {
      try {
        const raw = JSON.parse(readFileSync(this.indexPath, 'utf8')) as unknown;
        if (Array.isArray(raw)) entries = raw as MarketplaceEntry[];
      } catch {
        entries = [];
      }
    }
    const installedNames = new Set<string>();
    if (existsSync(paths.plugins)) {
      for (const d of readdirSync(paths.plugins, { withFileTypes: true })) {
        if (d.isDirectory()) installedNames.add(d.name);
      }
    }
    return entries.map((e) => ({ ...e, installed: installedNames.has(e.name) }));
  }

  findInstalledManifests(): Array<{ name: string; manifestPath: string }> {
    const out: Array<{ name: string; manifestPath: string }> = [];
    if (!existsSync(paths.plugins)) return out;
    for (const d of readdirSync(paths.plugins, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const m = join(paths.plugins, d.name, 'plugin.json');
      if (existsSync(m)) out.push({ name: d.name, manifestPath: m });
    }
    return out;
  }
}
