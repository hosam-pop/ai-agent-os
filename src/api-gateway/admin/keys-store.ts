import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { decryptSecret, encryptSecret, maskSecret } from './crypto.js';
import type { ProviderId } from './providers.js';

export interface StoredKey {
  provider: ProviderId;
  ciphertext: string;
  updatedAt: string;
  updatedBy?: string;
  lastTestOk?: boolean;
  lastTestNote?: string;
  lastTestAt?: string;
}

export interface PublicKeyStatus {
  provider: ProviderId;
  configured: boolean;
  preview: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  lastTestOk: boolean | null;
  lastTestNote: string | null;
  lastTestAt: string | null;
}

export interface KeysStore {
  list(): Promise<StoredKey[]>;
  get(provider: ProviderId): Promise<StoredKey | null>;
  set(provider: ProviderId, plaintext: string, updatedBy: string): Promise<StoredKey>;
  recordTest(
    provider: ProviderId,
    result: { ok: boolean; note: string },
  ): Promise<StoredKey | null>;
  delete(provider: ProviderId): Promise<boolean>;
  decrypt(provider: ProviderId): Promise<string | null>;
}

interface InternalRecord extends StoredKey {}

interface FileFormat {
  version: 1;
  records: InternalRecord[];
}

// File-backed encrypted store. Suitable for single-instance deploys; the file
// path defaults to /data/admin-keys.json so it lives on a Fly volume when one
// is attached. Without a volume, falls back to a process-local path so the
// gateway still boots in dev.
export function createFileKeysStore(opts: {
  filePath: string;
  masterKey: string;
}): KeysStore {
  const { filePath, masterKey } = opts;
  let cache: FileFormat | null = null;
  let writeLock: Promise<void> = Promise.resolve();

  async function load(): Promise<FileFormat> {
    if (cache) return cache;
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw) as FileFormat;
      if (parsed?.version !== 1 || !Array.isArray(parsed.records)) {
        cache = { version: 1, records: [] };
      } else {
        cache = parsed;
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        cache = { version: 1, records: [] };
      } else {
        throw err;
      }
    }
    return cache;
  }

  async function save(): Promise<void> {
    const next = writeLock.then(async () => {
      if (!cache) return;
      await fs.mkdir(dirname(filePath), { recursive: true });
      const tmp = `${filePath}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(cache, null, 2), { mode: 0o600 });
      await fs.rename(tmp, filePath);
    });
    writeLock = next.catch(() => undefined);
    await next;
  }

  return {
    async list() {
      const f = await load();
      return f.records.slice();
    },
    async get(provider) {
      const f = await load();
      return f.records.find((r) => r.provider === provider) ?? null;
    },
    async set(provider, plaintext, updatedBy) {
      const f = await load();
      const ciphertext = encryptSecret(plaintext, masterKey);
      const now = new Date().toISOString();
      const existing = f.records.find((r) => r.provider === provider);
      if (existing) {
        existing.ciphertext = ciphertext;
        existing.updatedAt = now;
        existing.updatedBy = updatedBy;
        existing.lastTestOk = undefined;
        existing.lastTestNote = undefined;
        existing.lastTestAt = undefined;
        await save();
        return existing;
      }
      const rec: InternalRecord = {
        provider,
        ciphertext,
        updatedAt: now,
        updatedBy,
      };
      f.records.push(rec);
      await save();
      return rec;
    },
    async recordTest(provider, result) {
      const f = await load();
      const rec = f.records.find((r) => r.provider === provider);
      if (!rec) return null;
      rec.lastTestOk = result.ok;
      rec.lastTestNote = result.note;
      rec.lastTestAt = new Date().toISOString();
      await save();
      return rec;
    },
    async delete(provider) {
      const f = await load();
      const before = f.records.length;
      f.records = f.records.filter((r) => r.provider !== provider);
      if (f.records.length === before) return false;
      await save();
      return true;
    },
    async decrypt(provider) {
      const f = await load();
      const rec = f.records.find((r) => r.provider === provider);
      if (!rec) return null;
      return decryptSecret(rec.ciphertext, masterKey);
    },
  };
}

export function toPublicStatus(rec: StoredKey | null, provider: ProviderId, masterKey: string): PublicKeyStatus {
  if (!rec) {
    return {
      provider,
      configured: false,
      preview: null,
      updatedAt: null,
      updatedBy: null,
      lastTestOk: null,
      lastTestNote: null,
      lastTestAt: null,
    };
  }
  let preview: string | null = null;
  try {
    preview = maskSecret(decryptSecret(rec.ciphertext, masterKey));
  } catch {
    preview = '••••';
  }
  return {
    provider,
    configured: true,
    preview,
    updatedAt: rec.updatedAt,
    updatedBy: rec.updatedBy ?? null,
    lastTestOk: rec.lastTestOk ?? null,
    lastTestNote: rec.lastTestNote ?? null,
    lastTestAt: rec.lastTestAt ?? null,
  };
}
