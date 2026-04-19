import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFalcoEvents } from '../../../dist/security/runtime/falco-event-reader.js';

async function writeLog(content: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'falco-test-'));
  const file = join(dir, 'falco.json');
  await writeFile(file, content, 'utf8');
  return file;
}

test('readFalcoEvents parses one JSON object per line', async () => {
  const lines = [
    JSON.stringify({
      time: '2024-05-01T12:00:00Z',
      rule: 'Write below etc',
      priority: 'Error',
      source: 'syscall',
      output: 'A file was written below /etc',
      tags: ['filesystem', 'mitre_persistence'],
      output_fields: { 'fd.name': '/etc/passwd' },
    }),
    JSON.stringify({
      time: '2024-05-01T12:00:05Z',
      rule: 'Shell in container',
      priority: 'Warning',
      source: 'syscall',
      output: 'Shell spawned in container',
      tags: ['container', 'shell'],
    }),
    'not-json',
    JSON.stringify({ notARule: true }),
  ].join('\n');
  const path = await writeLog(lines + '\n');
  const out = await readFalcoEvents({ path });
  assert.equal(out.total, 2);
  assert.equal(out.events[0].rule, 'Write below etc');
  assert.equal(out.events[0].priority, 'Error');
  assert.deepEqual(out.events[0].tags, ['filesystem', 'mitre_persistence']);
  assert.equal(out.byRule['Shell in container'], 1);
});

test('readFalcoEvents filters by minPriority, rule, tag, and source', async () => {
  const lines = [
    JSON.stringify({ time: 't1', rule: 'A', priority: 'Critical', source: 'syscall', output: 'critical', tags: ['x'] }),
    JSON.stringify({ time: 't2', rule: 'B', priority: 'Notice', source: 'syscall', output: 'notice', tags: ['x'] }),
    JSON.stringify({ time: 't3', rule: 'A', priority: 'Warning', source: 'k8s_audit', output: 'warn k8s', tags: ['y'] }),
  ].join('\n');
  const path = await writeLog(lines + '\n');

  const crit = await readFalcoEvents({ path, minPriority: 'Error' });
  assert.equal(crit.total, 1);
  assert.equal(crit.events[0].rule, 'A');

  const tagY = await readFalcoEvents({ path, tag: 'y' });
  assert.equal(tagY.total, 1);
  assert.equal(tagY.events[0].source, 'k8s_audit');

  const ruleB = await readFalcoEvents({ path, rule: 'B' });
  assert.equal(ruleB.total, 1);
  assert.equal(ruleB.events[0].priority, 'Notice');

  const syscallOnly = await readFalcoEvents({ path, source: 'syscall' });
  assert.equal(syscallOnly.total, 2);
});

test('readFalcoEvents returns an error when the file does not exist', async () => {
  const out = await readFalcoEvents({ path: '/tmp/definitely-not-a-falco-log-12345.json' });
  assert.equal(out.total, 0);
  assert.equal(out.errors.length, 1);
  assert.match(out.errors[0], /not found/);
});
