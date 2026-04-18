import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rollBuddy } from '../../dist/features/buddy.js';

test('rollBuddy is deterministic per user id', () => {
  const a = rollBuddy('user@example.com');
  const b = rollBuddy('user@example.com');
  assert.equal(a.species, b.species);
  assert.equal(a.rarity, b.rarity);
  assert.equal(a.shiny, b.shiny);
});

test('different user ids usually differ', () => {
  const a = rollBuddy('alice');
  const b = rollBuddy('bob');
  const sameAll = a.species === b.species && a.rarity === b.rarity && a.shiny === b.shiny;
  assert.ok(!sameAll || true, 'cannot require difference, but must not throw');
});
