import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hashPassword,
  verifyPassword,
  hasPermission,
  ROLE_PERMISSIONS
} from './auth.js';

test('v1 RBAC defines exactly cashier, barista and admin', () => {
  assert.deepEqual(
    Object.keys(ROLE_PERMISSIONS).sort(),
    ['admin', 'barista', 'cashier']
  );
});

test('cashier can sell but cannot use KDS or manage users', () => {
  assert.equal(hasPermission('cashier', 'sale.use'), true);
  assert.equal(hasPermission('cashier', 'kds.use'), false);
  assert.equal(hasPermission('cashier', 'users.manage'), false);
});

test('barista can use KDS but cannot sell or manage shifts', () => {
  assert.equal(hasPermission('barista', 'kds.use'), true);
  assert.equal(hasPermission('barista', 'sale.use'), false);
  assert.equal(hasPermission('barista', 'shift.manage'), false);
});

test('admin can use all v1 permissions', () => {
  for (const permission of ROLE_PERMISSIONS.admin) {
    assert.equal(hasPermission('admin', permission), true);
  }
});

test('password hashing uses a salted scrypt hash', async () => {
  const hash = await hashPassword('coffee-pos-test');
  assert.match(hash, /^scrypt\$[^$]+\$[0-9a-f]+$/);
  assert.equal(await verifyPassword('coffee-pos-test', hash), true);
  assert.equal(await verifyPassword('wrong-password', hash), false);
});

test('VND-style arithmetic stays integer-safe', () => {
  const total = 45000 + (35000 * 2);
  assert.equal(total, 115000);
  assert.equal(200000 - total, 85000);
});
