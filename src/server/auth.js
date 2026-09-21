import crypto from 'node:crypto';

const SESSION_HOURS = 12;

export const ROLES = Object.freeze({
  CASHIER: 'cashier',
  BARISTA: 'barista',
  ADMIN: 'admin'
});

export const ROLE_PERMISSIONS = Object.freeze({
  cashier: [
    'sale.use',
    'shift.manage',
    'orders.view'
  ],
  barista: [
    'kds.use'
  ],
  admin: [
    'sale.use',
    'shift.manage',
    'orders.view',
    'kds.use',
    'reports.view',
    'products.manage',
    'users.manage'
  ]
});

export function hasPermission(role, permission) {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex');
    crypto.scrypt(password, salt, 64, { N: 16_384, r: 8, p: 1 }, (error, derivedKey) => {
      if (error) return reject(error);
      resolve(`scrypt$${salt}$${derivedKey.toString('hex')}`);
    });
  });
}

export function verifyPassword(password, storedHash) {
  return new Promise((resolve, reject) => {
    const [algorithm, salt, hashHex] = String(storedHash || '').split('$');
    if (algorithm !== 'scrypt' || !salt || !hashHex) return resolve(false);

    crypto.scrypt(password, salt, 64, { N: 16_384, r: 8, p: 1 }, (error, derivedKey) => {
      if (error) return reject(error);
      const expected = Buffer.from(hashHex, 'hex');
      const actual = Buffer.from(derivedKey);
      resolve(expected.length === actual.length && crypto.timingSafeEqual(expected, actual));
    });
  });
}

export function createSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

export function hashSessionToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function sessionExpiry() {
  return new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000);
}
