import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  decryptSecret,
  encryptSecret,
  maskSecret,
} from '../../../dist/api-gateway/admin/crypto.js';
import { buildAdminAuth } from '../../../dist/api-gateway/admin/admin-auth.js';
import {
  createFileKeysStore,
  toPublicStatus,
} from '../../../dist/api-gateway/admin/keys-store.js';

const MASTER = 'test-master-key-please-change';

test('crypto round-trips an arbitrary secret', () => {
  const ct = encryptSecret('AIzaSyExample-1234567890abcdef', MASTER);
  assert.notEqual(ct, '');
  const pt = decryptSecret(ct, MASTER);
  assert.equal(pt, 'AIzaSyExample-1234567890abcdef');
});

test('crypto fails to decrypt with the wrong master key', () => {
  const ct = encryptSecret('topsecret', MASTER);
  assert.throws(() => decryptSecret(ct, 'different-master-key'));
});

test('maskSecret keeps prefix/suffix only', () => {
  assert.equal(maskSecret(''), '');
  assert.equal(maskSecret('abcdefgh'), '••••');
  assert.equal(maskSecret('AIzaSyDFtSX28dFEHO2DgLewcDsMCQ2Iyk-cmLA'), 'AIza…cmLA');
});

test('admin auth signs and verifies session tokens', () => {
  const auth = buildAdminAuth({ password: 'p@ss', sessionKey: MASTER, ttlMs: 60_000, secureCookie: false });
  assert.equal(auth.verifyPassword('p@ss'), true);
  assert.equal(auth.verifyPassword('wrong'), false);
  const sess = auth.issueSession();
  assert.ok(sess.token.includes('.'));
  const r = auth.validateSessionToken(sess.token);
  assert.equal(r.ok, true);
});

test('admin auth rejects expired tokens', () => {
  const auth = buildAdminAuth({ password: 'p@ss', sessionKey: MASTER, ttlMs: 1, secureCookie: false });
  const sess = auth.issueSession();
  // Wait past the TTL
  return new Promise<void>((resolve) => {
    setTimeout(() => {
      const r = auth.validateSessionToken(sess.token);
      assert.equal(r.ok, false);
      assert.equal(r.reason, 'expired');
      resolve();
    }, 25);
  });
});

test('admin auth rejects tampered signatures', () => {
  const auth = buildAdminAuth({ password: 'p@ss', sessionKey: MASTER, ttlMs: 60_000, secureCookie: false });
  const sess = auth.issueSession();
  const tampered = sess.token.replace(/.$/, (c) => (c === '0' ? '1' : '0'));
  const r = auth.validateSessionToken(tampered);
  assert.equal(r.ok, false);
});

test('file keys store persists, decrypts and clears records', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aaos-keys-'));
  const filePath = join(dir, 'admin-keys.json');
  try {
    const store = createFileKeysStore({ filePath, masterKey: MASTER });
    const initial = await store.list();
    assert.equal(initial.length, 0);

    const rec = await store.set('gemini', 'AIzaTestValue1234567890abcd', 'admin');
    assert.equal(rec.provider, 'gemini');
    assert.equal(rec.slots.length, 1);
    assert.notEqual(rec.slots[0].ciphertext, '');

    const status = toPublicStatus(rec, 'gemini', MASTER);
    assert.equal(status.configured, true);
    assert.equal(status.count, 1);
    assert.equal(status.preview, 'AIza…abcd');
    assert.equal(status.slots[0].preview, 'AIza…abcd');

    // Append a second slot and verify rotation order.
    const rec2 = await store.add('gemini', 'AIzaSecondKey9876543210xyzw', 'admin');
    assert.equal(rec2.slots.length, 2);
    const all = await store.decryptAll('gemini');
    assert.equal(all.length, 2);
    assert.equal(all[0].key, 'AIzaTestValue1234567890abcd');
    assert.equal(all[1].key, 'AIzaSecondKey9876543210xyzw');

    // decryptNext should round-robin through the slots.
    const first = await store.decryptNext('gemini');
    const second = await store.decryptNext('gemini');
    const third = await store.decryptNext('gemini');
    assert.ok(first && second && third);
    assert.equal(first.index, 0);
    assert.equal(second.index, 1);
    assert.equal(third.index, 0);

    // Replace slot 1 in place.
    await store.replace('gemini', 1, 'AIzaReplacedKey1111111111aa', 'admin');
    const replaced = await store.decryptAt('gemini', 1);
    assert.equal(replaced, 'AIzaReplacedKey1111111111aa');

    // Re-open the store and ensure the records persisted.
    const store2 = createFileKeysStore({ filePath, masterKey: MASTER });
    const recAgain = await store2.get('gemini');
    assert.ok(recAgain);
    assert.equal(recAgain.slots.length, 2);
    const decrypted = await store2.decrypt('gemini');
    assert.equal(decrypted, 'AIzaTestValue1234567890abcd');

    // Drop a single slot.
    const droppedOne = await store2.delete('gemini', 0);
    assert.equal(droppedOne, true);
    const recAfterDrop = await store2.get('gemini');
    assert.ok(recAfterDrop);
    assert.equal(recAfterDrop.slots.length, 1);

    const cleared = await store2.delete('gemini');
    assert.equal(cleared, true);
    const after = await store2.list();
    assert.equal(after.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('toPublicStatus reports unset when record is missing', () => {
  const status = toPublicStatus(null, 'github', MASTER);
  assert.equal(status.configured, false);
  assert.equal(status.preview, null);
  assert.equal(status.provider, 'github');
});
