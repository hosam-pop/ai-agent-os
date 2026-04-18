import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LifecycleHooks } from '../../dist/hooks/lifecycle-hooks.js';

test('hooks fire in order and can be removed', async () => {
  const h = new LifecycleHooks();
  const seen: string[] = [];
  const off = h.on('preTask', (p) => {
    seen.push(`pre:${p.taskId}`);
  });
  h.on('postTask', (p) => {
    seen.push(`post:${p.taskId}:${p.success}`);
  });

  await h.emit('preTask', { taskId: 't1', goal: 'g' });
  await h.emit('postTask', { taskId: 't1', success: true });
  off();
  await h.emit('preTask', { taskId: 't2', goal: 'g' });

  assert.deepEqual(seen, ['pre:t1', 'post:t1:true']);
});
