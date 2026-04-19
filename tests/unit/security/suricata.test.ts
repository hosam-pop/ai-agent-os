import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSuricataEve } from '../../../dist/security/ids/suricata-eve-reader.js';

function writeFixture(contents) {
  const dir = mkdtempSync(join(tmpdir(), 'suri-'));
  const path = join(dir, 'eve.json');
  writeFileSync(path, contents, 'utf-8');
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('readSuricataEve parses alert events and ignores non-alert types', async () => {
  const lines = [
    JSON.stringify({
      timestamp: '2025-04-18T22:00:00Z',
      event_type: 'alert',
      src_ip: '10.0.0.5',
      src_port: 55000,
      dest_ip: '10.0.0.10',
      dest_port: 22,
      proto: 'TCP',
      alert: { signature: 'ET SCAN NMAP', signature_id: 2010937, category: 'Network Scan', severity: 2 },
    }),
    JSON.stringify({
      timestamp: '2025-04-18T22:00:01Z',
      event_type: 'flow',
      src_ip: '10.0.0.5',
    }),
    JSON.stringify({
      timestamp: '2025-04-18T22:00:02Z',
      event_type: 'alert',
      src_ip: '10.0.0.6',
      dest_ip: '10.0.0.11',
      alert: { signature: 'ET POLICY TLS 1.0', signature_id: 2023000, category: 'Policy', severity: 3 },
    }),
  ];
  const { path, cleanup } = writeFixture(lines.join('\n') + '\n');
  try {
    const out = await readSuricataEve({ path });
    assert.equal(out.total, 2);
    assert.equal(out.alerts[0].signatureId, 2010937);
    assert.equal(out.alerts[0].protocol, 'TCP');
    assert.equal(out.bySeverity['2'], 1);
    assert.equal(out.bySeverity['3'], 1);
    assert.equal(out.byCategory['Network Scan'], 1);
  } finally {
    cleanup();
  }
});

test('readSuricataEve applies minSeverity and category filters (inverse severity)', async () => {
  const lines = [
    JSON.stringify({
      timestamp: '2025-04-18T22:00:00Z',
      event_type: 'alert',
      src_ip: '10.0.0.5',
      dest_ip: '10.0.0.10',
      alert: { signature: 'A', signature_id: 1, category: 'Network Scan', severity: 1 },
    }),
    JSON.stringify({
      timestamp: '2025-04-18T22:00:01Z',
      event_type: 'alert',
      src_ip: '10.0.0.5',
      dest_ip: '10.0.0.10',
      alert: { signature: 'B', signature_id: 2, category: 'Noise', severity: 3 },
    }),
    JSON.stringify({
      timestamp: '2025-04-18T22:00:02Z',
      event_type: 'alert',
      src_ip: '10.0.0.5',
      dest_ip: '10.0.0.10',
      alert: { signature: 'C', signature_id: 3, category: 'Network Scan', severity: 2 },
    }),
  ];
  const { path, cleanup } = writeFixture(lines.join('\n') + '\n');
  try {
    const severe = await readSuricataEve({ path, minSeverity: 2 });
    assert.equal(severe.total, 2);
    assert.deepEqual(severe.alerts.map((a) => a.signatureId), [1, 3]);

    const scansOnly = await readSuricataEve({ path, category: 'Network Scan' });
    assert.equal(scansOnly.total, 2);
    assert.deepEqual(scansOnly.alerts.map((a) => a.signatureId), [1, 3]);
  } finally {
    cleanup();
  }
});

test('readSuricataEve returns an error if the file is missing', async () => {
  const out = await readSuricataEve({ path: '/nonexistent/eve.json' });
  assert.equal(out.total, 0);
  assert.match(out.errors[0], /not found/);
});

test('readSuricataEve respects the limit cap', async () => {
  const lines = Array.from({ length: 10 }, (_, i) =>
    JSON.stringify({
      timestamp: `2025-04-18T22:00:${String(i).padStart(2, '0')}Z`,
      event_type: 'alert',
      src_ip: '10.0.0.5',
      dest_ip: '10.0.0.10',
      alert: { signature: `S${i}`, signature_id: i, category: 'Noise', severity: 3 },
    }),
  );
  const { path, cleanup } = writeFixture(lines.join('\n') + '\n');
  try {
    const out = await readSuricataEve({ path, limit: 4 });
    assert.equal(out.total, 4);
  } finally {
    cleanup();
  }
});
