import test from 'node:test';
import assert from 'node:assert/strict';

test('v0 smoke test: money arithmetic stays integer-safe for VND-style amounts', () => {
  const total = 45000 + (35000 * 2);
  assert.equal(total, 115000);
  assert.equal(200000 - total, 85000);
});
