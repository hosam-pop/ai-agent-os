import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { decryptSecret, encryptSecret, maskSecret } from './crypto.js';
import type { ProviderId } from './providers.js';

// Per-key state. A provider can hold multiple keys (e.g. five DeepSeek keys to
// round-robin through), and each one tracks its own liveness probe so the
// chat_failover/rotation logic can prefer fresh slots over slots that just
// failed with HTTP 402.
export interface KeySlot {
  ciphertext: string;
  addedAt: string;
  addedBy?: string;
  label?: string;
  lastTestOk?: boolean;
  lastTestNote?: string;
  lastTestAt?: string;
}

export interface StoredKey {
  provider: ProviderId;
  slots: KeySlot[];
  // Round-robin cursor — incremented every time decryptNext() hands out a key
  // so consecutive callers see different slots even when none have failed.
  cursor?: number;
  updatedAt: string;
  updatedBy?: string;
}

export interface PublicSlotStatus {
  index: number;
  preview: string;
  addedAt: string;
  addedBy: string | null;
  label: string | null;
  lastTestOk: boolean | null;
  lastTestNote: string | null;
  lastTestAt: string | null;
}

export interface PublicKeyStatus {
  provider: ProviderId;
  configured: boolean;
  count: number;
  slots: PublicSlotStatus[];
  // Back-compat fields — mirror slot[0] so older UIs/agents still see a single
  // "the key" for each provider when they don't care about rotation.
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
  /** Append a new key slot. */
  add(provider: ProviderId, plaintext: string, updatedBy: string, label?: string): Promise<StoredKey>;
  /** Replace an existing slot in place. Throws if index is out of range. */
  replace(provider: ProviderId, index: number, plaintext: string, updatedBy: string, label?: string): Promise<StoredKey>;
  /**
   * Legacy back-compat: replaces all slots with a single one. The chat UI and
   * admin REST routes still call this when the operator presses Save.
   */
  set(provider: ProviderId, plaintext: string, updatedBy: string): Promise<StoredKey>;
  /** Run the recorded liveness result against a specific slot (defaults to 0). */
  recordTest(
    provider: ProviderId,
    result: { ok: boolean; note: string },
    index?: number,
  ): Promise<StoredKey | null>;
  /** Delete one slot, or every slot if `index` is undefined. */
  delete(provider: ProviderId, index?: number): Promise<boolean>;
  /** Decrypt slot 0 (legacy callers). */
  decrypt(provider: ProviderId): Promise<string | null>;
  /** Decrypt a specific slot. */
  decryptAt(provider: ProviderId, index: number): Promise<string | null>;
  /** Decrypt every slot in order — used by chat_failover for rotation. */
  decryptAll(provider: ProviderId): Promise<Array<{ index: number; key: string }>>;
  /**
   * Round-robin: returns the next slot from the rotation cursor and advances
   * the cursor. Returns null when no slots are configured.
   */
  decryptNext(provider: ProviderId): Promise<{ index: number; key: string } | null>;
}

interface FileFormatV1 {
  version: 1;
  records: Array<{
    provider: ProviderId;
    ciphertext: string;
    updatedAt: string;
    updatedBy?: string;
    lastTestOk?: boolean;
    lastTestNote?: string;
    lastTestAt?: string;
  }>;
}

interface FileFormatV2 {
  version: 2;
  records: StoredKey[];
}

type AnyFile = FileFormatV1 | FileFormatV2;

function migrate(parsed: AnyFile): FileFormatV2 {
  if (parsed.version === 2) return parsed;
  if (parsed.version === 1) {
    return {
      version: 2,
      records: parsed.records.map((r) => ({
        provider: r.provider,
        slots: [
          {
            ciphertext: r.ciphertext,
            addedAt: r.updatedAt,
            addedBy: r.updatedBy,
            lastTestOk: r.lastTestOk,
            lastTestNote: r.lastTestNote,
            lastTestAt: r.lastTestAt,
          },
        ],
        cursor: 0,
        updatedAt: r.updatedAt,
        updatedBy: r.updatedBy,
      })),
    };
  }
  return { version: 2, records: [] };
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
  let cache: FileFormatV2 | null = null;
  let writeLock: Promise<void> = Promise.resolve();

  async function load(): Promise<FileFormatV2> {
    if (cache) return cache;
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw) as AnyFile;
      cache = migrate(parsed);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        cache = { version: 2, records: [] };
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

  function findRec(f: FileFormatV2, provider: ProviderId): StoredKey | undefined {
    return f.records.find((r) => r.provider === provider);
  }

  function ensureRec(f: FileFormatV2, provider: ProviderId): StoredKey {
    let rec = findRec(f, provider);
    if (!rec) {
      rec = { provider, slots: [], cursor: 0, updatedAt: new Date().toISOString() };
      f.records.push(rec);
    }
    return rec;
  }

  return {
    async list() {
      const f = await load();
      return f.records.slice();
    },
    async get(provider) {
      const f = await load();
      return findRec(f, provider) ?? null;
    },
    async add(provider, plaintext, updatedBy, label) {
      const f = await load();
      const rec = ensureRec(f, provider);
      const now = new Date().toISOString();
      rec.slots.push({
        ciphertext: encryptSecret(plaintext, masterKey),
        addedAt: now,
        addedBy: updatedBy,
        label,
      });
      rec.updatedAt = now;
      rec.updatedBy = updatedBy;
      await save();
      return rec;
    },
    async replace(provider, index, plaintext, updatedBy, label) {
      const f = await load();
      const rec = ensureRec(f, provider);
      if (index < 0 || index >= rec.slots.length) {
        throw new Error(`slot index ${index} out of range (have ${rec.slots.length})`);
      }
      const now = new Date().toISOString();
      rec.slots[index] = {
        ciphertext: encryptSecret(plaintext, masterKey),
        addedAt: now,
        addedBy: updatedBy,
        label,
      };
      rec.updatedAt = now;
      rec.updatedBy = updatedBy;
      await save();
      return rec;
    },
    async set(provider, plaintext, updatedBy) {
      const f = await load();
      const rec = ensureRec(f, provider);
      const now = new Date().toISOString();
      rec.slots = [
        {
          ciphertext: encryptSecret(plaintext, masterKey),
          addedAt: now,
          addedBy: updatedBy,
        },
      ];
      rec.cursor = 0;
      rec.updatedAt = now;
      rec.updatedBy = updatedBy;
      await save();
      return rec;
    },
    async recordTest(provider, result, index = 0) {
      const f = await load();
      const rec = findRec(f, provider);
      if (!rec || !rec.slots[index]) return null;
      rec.slots[index].lastTestOk = result.ok;
      rec.slots[index].lastTestNote = result.note;
      rec.slots[index].lastTestAt = new Date().toISOString();
      await save();
      return rec;
    },
    async delete(provider, index) {
      const f = await load();
      const rec = findRec(f, provider);
      if (!rec) return false;
      if (index === undefined) {
        f.records = f.records.filter((r) => r.provider !== provider);
        await save();
        return true;
      }
      if (index < 0 || index >= rec.slots.length) return false;
      rec.slots.splice(index, 1);
      if (typeof rec.cursor === 'number' && rec.cursor >= rec.slots.length) {
        rec.cursor = 0;
      }
      rec.updatedAt = new Date().toISOString();
      if (rec.slots.length === 0) {
        f.records = f.records.filter((r) => r.provider !== provider);
      }
      await save();
      return true;
    },
    async decrypt(provider) {
      const f = await load();
      const rec = findRec(f, provider);
      const slot = rec?.slots[0];
      if (!slot) return null;
      return decryptSecret(slot.ciphertext, masterKey);
    },
    async decryptAt(provider, index) {
      const f = await load();
      const rec = findRec(f, provider);
      const slot = rec?.slots[index];
      if (!slot) return null;
      return decryptSecret(slot.ciphertext, masterKey);
    },
    async decryptAll(provider) {
      const f = await load();
      const rec = findRec(f, provider);
      if (!rec) return [];
      return rec.slots.map((slot, idx) => ({
        index: idx,
        key: decryptSecret(slot.ciphertext, masterKey),
      }));
    },
    async decryptNext(provider) {
      const f = await load();
      const rec = findRec(f, provider);
      if (!rec || rec.slots.length === 0) return null;
      const idx = (rec.cursor ?? 0) % rec.slots.length;
      rec.cursor = (idx + 1) % rec.slots.length;
      await save();
      const slot = rec.slots[idx];
      return { index: idx, key: decryptSecret(slot.ciphertext, masterKey) };
    },
  };
}

export function toPublicStatus(rec: StoredKey | null, provider: ProviderId, masterKey: string): PublicKeyStatus {
  if (!rec || rec.slots.length === 0) {
    return {
      provider,
      configured: false,
      count: 0,
      slots: [],
      preview: null,
      updatedAt: null,
      updatedBy: null,
      lastTestOk: null,
      lastTestNote: null,
      lastTestAt: null,
    };
  }
  const slots: PublicSlotStatus[] = rec.slots.map((slot, idx) => {
    let preview = '••••';
    try {
      preview = maskSecret(decryptSecret(slot.ciphertext, masterKey));
    } catch {
      // keep placeholder
    }
    return {
      index: idx,
      preview,
      addedAt: slot.addedAt,
      addedBy: slot.addedBy ?? null,
      label: slot.label ?? null,
      lastTestOk: slot.lastTestOk ?? null,
      lastTestNote: slot.lastTestNote ?? null,
      lastTestAt: slot.lastTestAt ?? null,
    };
  });
  return {
    provider,
    configured: true,
    count: slots.length,
    slots,
    preview: slots[0].preview,
    updatedAt: rec.updatedAt,
    updatedBy: rec.updatedBy ?? null,
    lastTestOk: slots[0].lastTestOk,
    lastTestNote: slots[0].lastTestNote,
    lastTestAt: slots[0].lastTestAt,
  };
}
