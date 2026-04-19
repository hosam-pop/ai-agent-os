import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBearerJson } from '../../../dist/security/sast/bearer-runner.js';

test('parseBearerJson bucketises findings across severity groups', () => {
  const raw = {
    critical: [
      {
        id: 'ruby_rails_logger',
        title: 'Sensitive data in logs',
        description: 'Passwords leaked into logs',
        filename: 'app/controllers/users.rb',
        line_number: 42,
        cwe_ids: ['CWE-532'],
        owasp_top_10: ['A09:2021'],
      },
    ],
    high: [
      {
        id: 'javascript_lang_hardcoded_secret',
        title: 'Hardcoded secret',
        description: '',
        filename: 'src/config.js',
        line_number: 7,
        cwe: 'CWE-798',
      },
    ],
    medium: [],
    errors: ['rule loading failed'],
  };
  const out = parseBearerJson(raw);
  assert.equal(out.total, 2);
  assert.equal(out.bySeverity.critical, 1);
  assert.equal(out.bySeverity.high, 1);
  assert.equal(out.findings[0].severity, 'critical');
  assert.equal(out.findings[0].path, 'app/controllers/users.rb');
  assert.equal(out.findings[0].line, 42);
  assert.deepEqual(out.findings[0].cwe, ['CWE-532']);
  assert.deepEqual(out.findings[0].owasp, ['A09:2021']);
  assert.deepEqual(out.findings[1].cwe, ['CWE-798']);
  assert.deepEqual(out.errors, ['rule loading failed']);
});

test('parseBearerJson handles empty reports and object-shaped errors', () => {
  const empty = parseBearerJson({});
  assert.equal(empty.total, 0);
  assert.deepEqual(empty.errors, []);

  const withObjectErrors = parseBearerJson({ errors: [{ message: 'parse error' }] });
  assert.deepEqual(withObjectErrors.errors, ['parse error']);

  const fromNull = parseBearerJson(null);
  assert.equal(fromNull.total, 0);
  assert.equal(fromNull.errors.length, 1);
});
