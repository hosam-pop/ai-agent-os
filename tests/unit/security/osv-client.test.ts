import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOsvQuery, parseOsvVulnerability, OsvClient } from '../../../dist/security/threat-intel/osv-client.js';

test('parseOsvQuery extracts id, severity, and fixed versions', () => {
  const raw = {
    vulns: [
      {
        id: 'GHSA-xxxx-yyyy-zzzz',
        aliases: ['CVE-2024-1234'],
        summary: 'example vulnerability',
        severity: [{ type: 'CVSS_V3', score: '9.8' }],
        references: [{ type: 'ADVISORY', url: 'https://example.org/advisory' }],
        affected: [
          {
            package: { name: 'left-pad', ecosystem: 'npm' },
            ranges: [
              {
                type: 'ECOSYSTEM',
                events: [{ introduced: '0' }, { fixed: '1.3.0' }],
              },
            ],
          },
        ],
      },
    ],
  };
  const out = parseOsvQuery(raw);
  assert.equal(out.total, 1);
  const v = out.vulns[0];
  assert.equal(v.id, 'GHSA-xxxx-yyyy-zzzz');
  assert.equal(v.severity, 'CRITICAL');
  assert.equal(v.cvss, 9.8);
  assert.equal(v.affectedPackage, 'left-pad');
  assert.equal(v.affectedEcosystem, 'npm');
  assert.deepEqual(v.fixedVersions, ['1.3.0']);
  assert.ok(v.references.includes('https://example.org/advisory'));
});

test('parseOsvQuery uses database-specific severity when CVSS is absent', () => {
  const out = parseOsvQuery({
    vulns: [
      {
        id: 'OSV-2024-0001',
        database_specific: { severity: 'moderate' },
        affected: [{ package: { name: 'foo', ecosystem: 'PyPI' } }],
      },
    ],
  });
  assert.equal(out.vulns[0].severity, 'MODERATE');
  assert.equal(out.vulns[0].affectedEcosystem, 'PyPI');
});

test('parseOsvQuery returns empty summary for empty or malformed payloads', () => {
  assert.equal(parseOsvQuery({}).total, 0);
  assert.equal(parseOsvQuery({ vulns: [] }).total, 0);
  assert.equal(parseOsvQuery(null).errors.length, 1);
  assert.equal(parseOsvQuery({ vulns: [{ aliases: ['no id'] }] }).total, 0);
});

test('parseOsvVulnerability wraps a single-object response', () => {
  const out = parseOsvVulnerability({ id: 'CVE-2024-99999', summary: 'x' });
  assert.equal(out.total, 1);
  assert.equal(out.vulns[0].id, 'CVE-2024-99999');
});

test('OsvClient.query rejects empty input without hitting fetch', async () => {
  let called = false;
  const client = new OsvClient({
    fetchImpl: (async () => {
      called = true;
      return new Response('{}');
    }) as typeof fetch,
  });
  const out = await client.query({});
  assert.equal(called, false);
  assert.ok(out.errors[0].includes('package or commit is required'));
});

test('OsvClient.query POSTs to /v1/query and parses the body', async () => {
  let captured: { url?: string; init?: RequestInit } = {};
  const fetchImpl: typeof fetch = async (url, init) => {
    captured = { url: String(url), init };
    return new Response(
      JSON.stringify({ vulns: [{ id: 'CVE-1', severity: [{ type: 'CVSS_V3', score: '7.1' }] }] }),
      { status: 200 },
    );
  };
  const client = new OsvClient({ baseUrl: 'https://osv.local', fetchImpl });
  const out = await client.query({ package: { name: 'lodash', ecosystem: 'npm' }, version: '4.17.20' });
  assert.equal(out.total, 1);
  assert.equal(out.vulns[0].severity, 'HIGH');
  assert.ok((captured.url as string).endsWith('/v1/query'));
  assert.equal((captured.init as RequestInit).method, 'POST');
});

test('OsvClient.getById GETs /v1/vulns/{id}', async () => {
  let method: string | undefined;
  const fetchImpl: typeof fetch = async (_url, init) => {
    method = (init as RequestInit).method;
    return new Response(JSON.stringify({ id: 'CVE-2' }), { status: 200 });
  };
  const client = new OsvClient({ baseUrl: 'https://osv.local', fetchImpl });
  const out = await client.getById('CVE-2');
  assert.equal(out.vulns[0].id, 'CVE-2');
  assert.equal(method, 'GET');
});
