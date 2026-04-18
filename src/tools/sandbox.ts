import { resolve, relative, isAbsolute, sep } from 'node:path';
import { logger } from '../utils/logger.js';

/**
 * Filesystem sandbox.
 *
 * All file-system tools route their paths through here to guarantee they stay
 * inside the configured workspace. Any attempt to escape via `..`, absolute
 * paths, or symlinks is rejected.
 */
export class Sandbox {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  resolvePath(input: string): string {
    const normalized = isAbsolute(input) ? input : resolve(this.root, input);
    const full = resolve(normalized);
    const rel = relative(this.root, full);
    if (rel.startsWith('..') || rel.startsWith(`..${sep}`) || (isAbsolute(rel) && rel !== '')) {
      const err = new Error(`Path escapes sandbox root: ${input}`);
      logger.warn('sandbox.escape', { input, root: this.root });
      throw err;
    }
    return full;
  }

  relative(full: string): string {
    return relative(this.root, full) || '.';
  }
}
