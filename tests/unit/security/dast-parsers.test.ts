import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNucleiJsonl } from '../../../dist/security/dast/nuclei-runner.js';
import { parseZapJson } from '../../../dist/security/dast/zap-runner.js';

test('parseNucleiJsonl parses one-object-per-line output', () => {
  const stdout = [
    JSON.stringify({
      'template-id': 'http-missing-security-headers',
      info: { name: 'Missing Security Headers', severity: 'info', tags: 'misconfig,generic' },
      type: 'http',
      host: 'https://example.test',
      'matched-at': 'https://example.test',
    }),
    '',
    JSON.stringify({
      'template-id': 'CVE-2023-9999',
      info: { name: 'Mock CVE', severity: 'high', tags: ['cve', 'cve2023'] },
      type: 'http',
      host: 'https://example.test',
      'matched-at': 'https://example.test/admin',
    }),
  ].join('\n');

  const out = parseNucleiJsonl(stdout);
  assert.equal(out.total, 2);
  assert.equal(out.bySeverity.info, 1);
  assert.equal(out.bySeverity.high, 1);
  assert.equal(out.findings[0].templateId, 'http-missing-security-headers');
  assert.deepEqual(out.findings[0].tags, ['misconfig', 'generic']);
  assert.deepEqual(out.findings[1].tags, ['cve', 'cve2023']);
});

test('parseNucleiJsonl ignores non-JSON lines and empty stdout', () => {
  const stdout = 'banner line\nnot json\n{"invalid"';
  const out = parseNucleiJsonl(stdout);
  assert.equal(out.total, 0);
  assert.equal(out.errors.length, 0);
});

test('parseZapJson handles traditional site-wrapped reports', () => {
  const report = {
    site: [
      {
        '@name': 'https://example.test',
        alerts: [
          {
            name: 'Cross-Site Scripting (Reflected)',
            riskdesc: 'High (Medium)',
            confidence: 'Medium',
            description: 'XSS via q param',
            cweid: '79',
            wascid: '8',
            pluginid: '40012',
            instances: [
              { uri: 'https://example.test/search?q=<script>', method: 'GET', evidence: '<script>' },
            ],
          },
          {
            name: 'X-Frame-Options Header Not Set',
            riskdesc: 'Medium (Medium)',
            confidence: 'Medium',
            description: 'XFO missing',
            instances: [],
          },
        ],
      },
    ],
  };
  const out = parseZapJson(report);
  assert.equal(out.total, 2);
  assert.equal(out.byRisk['High (Medium)'], 1);
  assert.equal(out.byRisk['Medium (Medium)'], 1);
  assert.equal(out.alerts[0].cweid, '79');
  assert.equal(out.alerts[0].instances.length, 1);
});

test('parseZapJson handles flat alerts array from automation framework', () => {
  const report = {
    alerts: [
      {
        name: 'Content Security Policy Missing',
        risk: 'Medium',
        confidence: 'High',
        description: 'CSP missing',
        instances: [{ uri: 'https://example.test', method: 'GET' }],
      },
    ],
  };
  const out = parseZapJson(report);
  assert.equal(out.total, 1);
  assert.equal(out.alerts[0].riskdesc, 'Medium');
});

test('parseZapJson returns empty on malformed input', () => {
  const out = parseZapJson(null);
  assert.equal(out.total, 0);
  assert.ok(out.errors.length > 0);
});
