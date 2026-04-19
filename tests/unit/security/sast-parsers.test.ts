import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSemgrepJson } from '../../../dist/security/sast/semgrep-runner.js';
import { parseCodeqlSarif } from '../../../dist/security/sast/codeql-runner.js';

test('parseSemgrepJson extracts findings, severities, and CWE metadata', () => {
  const raw = {
    results: [
      {
        check_id: 'javascript.express.security.audit.xss',
        path: 'src/server.js',
        start: { line: 10 },
        end: { line: 12 },
        extra: {
          severity: 'ERROR',
          message: 'Potential XSS via unescaped input',
          lines: 'res.send(req.query.q)',
          metadata: {
            cwe: ['CWE-79: Improper Neutralization of Input'],
            owasp: 'A03:2021 – Injection',
          },
        },
      },
      {
        check_id: 'python.sqlalchemy.security.audit.sqli',
        path: 'app/db.py',
        start: { line: 42 },
        end: { line: 42 },
        extra: { severity: 'WARNING', message: 'Possible SQL injection' },
      },
    ],
    errors: [{ message: 'some rule failed to compile' }],
  };
  const out = parseSemgrepJson(raw);
  assert.equal(out.total, 2);
  assert.equal(out.bySeverity.ERROR, 1);
  assert.equal(out.bySeverity.WARNING, 1);
  assert.equal(out.findings[0].ruleId, 'javascript.express.security.audit.xss');
  assert.deepEqual(out.findings[0].cwe, ['CWE-79: Improper Neutralization of Input']);
  assert.deepEqual(out.findings[0].owasp, ['A03:2021 – Injection']);
  assert.equal(out.findings[0].line, 10);
  assert.equal(out.findings[0].endLine, 12);
  assert.deepEqual(out.errors, ['some rule failed to compile']);
});

test('parseSemgrepJson handles empty/malformed input gracefully', () => {
  const empty = parseSemgrepJson(null);
  assert.equal(empty.total, 0);
  assert.ok(empty.errors.length > 0);

  const noResults = parseSemgrepJson({});
  assert.equal(noResults.total, 0);
});

test('parseCodeqlSarif maps SARIF runs/results to normalized findings', () => {
  const sarif = {
    runs: [
      {
        tool: {
          driver: {
            rules: [
              {
                id: 'js/sql-injection',
                defaultConfiguration: { level: 'error' },
                properties: { tags: ['security', 'cwe-089', 'external/cwe/cwe-089'] },
              },
            ],
          },
        },
        results: [
          {
            ruleId: 'js/sql-injection',
            level: 'error',
            message: { text: 'User input reaches SQL sink' },
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: 'src/db.ts' },
                  region: { startLine: 88 },
                },
              },
            ],
          },
          {
            ruleId: 'js/sql-injection',
            message: { text: 'Another SQL sink' },
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: 'src/db.ts' },
                  region: { startLine: 103 },
                },
              },
            ],
          },
        ],
      },
    ],
  };
  const out = parseCodeqlSarif(sarif);
  assert.equal(out.total, 2);
  assert.equal(out.byLevel.error, 2);
  assert.equal(out.findings[0].ruleId, 'js/sql-injection');
  assert.equal(out.findings[0].line, 88);
  assert.equal(out.findings[0].path, 'src/db.ts');
  assert.deepEqual(out.findings[0].tags, ['security', 'cwe-089', 'external/cwe/cwe-089']);
});

test('parseCodeqlSarif returns an error for malformed SARIF', () => {
  const out = parseCodeqlSarif({ not_runs: [] });
  assert.equal(out.total, 0);
  assert.ok(out.errors.includes('missing "runs" in SARIF'));
});
