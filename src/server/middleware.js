import { hashSessionToken, hasPermission } from './auth.js';
import { query } from './db.js';

export async function authenticate(req, res, next) {
  try {
    const header = req.get('authorization') || '';
    if (!header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    const tokenHash = hashSessionToken(header.slice(7).trim());
    const { rows } = await query(`
      SELECT
        u.id,
        u.username,
        u.display_name,
        u.role,
        s.id AS session_id
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1
        AND s.expires_at > NOW()
        AND u.active = TRUE
      LIMIT 1
    `, [tokenHash]);

    if (!rows[0]) return res.status(401).json({ error: 'Invalid or expired session.' });

    req.user = {
      id: rows[0].id,
      username: rows[0].username,
      displayName: rows[0].display_name,
      role: rows[0].role,
      sessionId: rows[0].session_id
    };

    return next();
  } catch (error) {
    return next(error);
  }
}

export function requirePermission(permission) {
  return (req, res, next) => {
    if (!hasPermission(req.user?.role, permission)) {
      return res.status(403).json({ error: 'You do not have permission for this action.' });
    }
    return next();
  };
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) {
      return res.status(403).json({ error: 'Your role cannot perform this action.' });
    }
    return next();
  };
}
