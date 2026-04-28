import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGrypeJson } from '../../../dist/security/container/grype-runner.js';
import { parseTrivyJson } from '../../../dist/security/container/trivy-runner.js';

test('parseGrypeJson extracts matches, cvss, and fix info', () => {
  const raw = {
    matches: [
      {
        vulnerability: {
          id: 'CVE-2024-1234',
          severity: 'High',
          description: 'Heap overflow in libfoo',
          fix: { versions: ['1.2.3'], state: 'fixed' },
          cvss: [{ metrics: { baseScore: 7.5 } }, { metrics: { baseScore: 8.1 } }],
          urls: ['https://nvd.nist.gov/vuln/detail/CVE-2024-1234'],
        },
        artifact: { name: 'libfoo', version: '1.0.0' },
      },
      {
        vulnerability: {
          id: 'CVE-2024-0001',
          severity: 'Low',
          fix: { versions: [] },
        },
        artifact: { name: 'openssl', version: '3.0.0' },
      },
    ],
  };
  const out = parseGrypeJson(raw, 'alpine:3.19');
  assert.equal(out.engine, 'grype');
  assert.equal(out.total, 2);
  assert.equal(out.vulns[0].id, 'CVE-2024-1234');
  assert.equal(out.vulns[0].fixedIn, '1.2.3');
  assert.equal(out.vulns[0].cvss, 8.1);
  assert.equal(out.vulns[0].target, 'alpine:3.19');
  assert.equal(out.bySeverity.High, 1);
  assert.equal(out.bySeverity.Low, 1);
  assert.equal(out.vulns[1].fixedIn, undefined);
});

test('parseGrypeJson tolerates empty input', () => {
  const out = parseGrypeJson(null, 'img');
  assert.equal(out.total, 0);
  assert.equal(out.errors.length, 1);
});

test('parseTrivyJson flattens Results[].Vulnerabilities[] into a single list', () => {
  const raw = {
    Results: [
      {
        Target: 'alpine:3.19 (alpine 3.19.1)',
        Vulnerabilities: [
          {
            VulnerabilityID: 'CVE-2024-9999',
            PkgName: 'busybox',
            InstalledVersion: '1.36.0',
            FixedVersion: '1.36.1',
            Severity: 'HIGH',
            Description: 'Integer overflow',
            PrimaryURL: 'https://avd.aquasec.com/nvd/cve-2024-9999',
            CVSS: {
              nvd: { V3Score: 7.5, V2Score: 6.1 },
              redhat: { V3Score: 7.8 },
            },
          },
        ],
      },
      {
        Target: 'Node.js',
        Vulnerabilities: [
          {
            VulnerabilityID: 'GHSA-1111-2222-3333',
            PkgName: 'express',
            InstalledVersion: '4.17.0',
            Severity: 'MEDIUM',
          },
        ],
      },
      { Target: 'no-vulns', Vulnerabilities: [] },
    ],
  };
  const out = parseTrivyJson(raw, 'alpine:3.19');
  assert.equal(out.engine, 'trivy');
  assert.equal(out.total, 2);
  assert.equal(out.bySeverity.HIGH, 1);
  assert.equal(out.bySeverity.MEDIUM, 1);
  assert.equal(out.vulns[0].cvss, 7.8);
  assert.equal(out.vulns[0].target, 'alpine:3.19 (alpine 3.19.1)');
  assert.equal(out.vulns[0].fixedIn, '1.36.1');
  assert.ok(out.vulns[0].urls?.includes('https://avd.aquasec.com/nvd/cve-2024-9999'));
});
