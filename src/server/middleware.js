import { hashSessionToken, hasPermission } from './auth.js';
import { query } from './db.js';

export async function authenticate(req, res, next) {
  try {
    const header = String(req.headers.authorization || '');
    if (!header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    const token = header.slice(7).trim();
    if (!token) return res.status(401).json({ error: 'Authentication required.' });

    const tokenHash = hashSessionToken(token);
    const { rows } = await query(`
      SELECT s.id AS session_id, u.id, u.username, u.display_name, u.role, u.active
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > NOW() AND u.active = TRUE
      LIMIT 1
    `, [tokenHash]);

    if (!rows[0]) return res.status(401).json({ error: 'Session expired or invalid.' });

    req.user = rows[0];
    req.tokenHash = tokenHash;
    next();
  } catch (error) {
    next(error);
  }
}

export function authorizeRoles(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have permission for this action.' });
    }
    next();
  };
}

export function authorizePermission(permission) {
  return (req, res, next) => {
    if (!req.user || !hasPermission(req.user.role, permission)) {
      return res.status(403).json({ error: 'You do not have permission for this action.' });
    }
    next();
  };
}
