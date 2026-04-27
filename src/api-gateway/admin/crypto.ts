import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

// AES-256-GCM envelope. Master key is read from KEYS_MASTER_KEY (any length;
// hashed to 32 bytes). Output format: iv(12) || tag(16) || ciphertext, base64.
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class MasterKeyMissingError extends Error {}

function deriveKey(masterKey: string): Buffer {
  if (!masterKey) throw new MasterKeyMissingError('KEYS_MASTER_KEY is required');
  return createHash('sha256').update(masterKey, 'utf8').digest();
}

export function encryptSecret(plaintext: string, masterKey: string): string {
  const key = deriveKey(masterKey);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptSecret(ciphertext: string, masterKey: string): string {
  const key = deriveKey(masterKey);
  const buf = Buffer.from(ciphertext, 'base64');
  if (buf.length < IV_BYTES + TAG_BYTES) {
    throw new Error('ciphertext too short');
  }
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const enc = buf.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString('utf8');
}

export function maskSecret(secret: string): string {
  if (!secret) return '';
  if (secret.length <= 8) return '••••';
  return `${secret.slice(0, 4)}…${secret.slice(-4)}`;
}
