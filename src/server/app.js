import express from 'express';
import helmet from 'helmet';
import { pool, query, withTransaction } from './db.js';
import {
  createSessionToken,
  hashPassword,
  hashSessionToken,
  sessionExpiry,
  verifyPassword
} from './auth.js';
import { authenticate, authorizePermission, authorizeRoles } from './middleware.js';

const app = express();
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '256kb' }));

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const userProjection = `
  id, username, display_name, role, active, last_login_at, created_at
`;

app.get('/api/health', async (_req, res) => {
  try {
    await query('SELECT 1');
    res.json({ ok: true, service: 'coffee-pos-api', database: 'connected', version: '1.0.0' });
  } catch (error) {
    res.status(503).json({ ok: false, database: 'disconnected', error: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const username = String(req.body?.username || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!username || !password) return res.status(400).json({ error: 'Username và password là bắt buộc.' });

  try {
    const { rows } = await query(`
      SELECT id, username, display_name, password_hash, role, active
      FROM users
      WHERE LOWER(username) = LOWER($1)
      LIMIT 1
    `, [username]);
    const user = rows[0];

    if (!user || !user.active || !(await verifyPassword(password, user.password_hash))) {
      return res.status(401).json({ error: 'Sai tài khoản hoặc mật khẩu.' });
    }

    await query('DELETE FROM sessions WHERE expires_at <= NOW() OR user_id = $1', [user.id]);
    const token = createSessionToken();
    await query(
      'INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [user.id, hashSessionToken(token), sessionExpiry()]
    );
    await query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);
    await query(
      `INSERT INTO audit_logs (actor, action, entity_type, entity_id, payload)
       VALUES ($1, 'LOGIN', 'USER', $2, $3::jsonb)`,
      [user.username, user.id, JSON.stringify({ role: user.role })]
    );

    res.json({
      data: {
        token,
        user: {
          id: user.id,
          username: user.username,
          displayName: user.display_name,
          role: user.role
        }
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/logout', authenticate, async (req, res) => {
  try {
    await query('DELETE FROM sessions WHERE token_hash = $1', [req.tokenHash]);
    await query(
      `INSERT INTO audit_logs (actor, action, entity_type, entity_id)
       VALUES ($1, 'LOGOUT', 'USER', $2)`,
      [req.user.username, req.user.id]
    );
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/auth/me', authenticate, (req, res) => {
  res.json({
    data: {
      id: req.user.id,
      username: req.user.username,
      displayName: req.user.display_name,
      role: req.user.role
    }
  });
});

app.get('/api/products', authenticate, async (req, res) => {
  try {
    const includeInactive = String(req.query.includeInactive || '').toLowerCase() === 'true' && req.user.role === 'admin';
    const { rows } = await query(`
      SELECT p.id, p.sku, p.name, p.price::float8 AS price, p.active,
             c.id AS category_id, c.name AS category_name, c.sort_order
      FROM products p
      JOIN categories c ON c.id = p.category_id
      WHERE c.active = TRUE AND (p.active = TRUE OR $1 = TRUE)
      ORDER BY c.sort_order, c.name, p.name
    `, [includeInactive]);
    res.json({ data: rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/categories', authenticate, async (_req, res) => {
  try {
    const { rows } = await query(`
      SELECT id, name, sort_order, active
      FROM categories WHERE active = TRUE
      ORDER BY sort_order, name
    `);
    res.json({ data: rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/categories', authenticate, authorizePermission('products.manage'), async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const sortOrder = Number(req.body?.sortOrder ?? 0);
  if (!name || !Number.isInteger(sortOrder)) return res.status(400).json({ error: 'Danh mục không hợp lệ.' });

  try {
    const { rows } = await query(
      'INSERT INTO categories (name, sort_order) VALUES ($1, $2) RETURNING id, name, sort_order, active',
      [name, sortOrder]
    );
    await audit(req, 'CATEGORY_CREATED', 'CATEGORY', rows[0].id, { name, sortOrder });
    res.status(201).json({ data: rows[0] });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Danh mục đã tồn tại.' });
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/products', authenticate, authorizePermission('products.manage'), async (req, res) => {
  const sku = String(req.body?.sku || '').trim() || null;
  const name = String(req.body?.name || '').trim();
  const categoryId = String(req.body?.categoryId || '').trim();
  const price = Number(req.body?.price);
  if (!name || !categoryId || !Number.isFinite(price) || price < 0) {
    return res.status(400).json({ error: 'Tên, danh mục và giá sản phẩm là bắt buộc.' });
  }

  try {
    const { rows } = await query(`
      INSERT INTO products (category_id, sku, name, price)
      VALUES ($1, $2, $3, $4)
      RETURNING id, sku, name, price::float8 AS price, category_id, active
    `, [categoryId, sku, name, price]);
    await audit(req, 'PRODUCT_CREATED', 'PRODUCT', rows[0].id, { sku, name, price });
    res.status(201).json({ data: rows[0] });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'SKU đã tồn tại.' });
    if (error.code === '23503') return res.status(400).json({ error: 'Danh mục không tồn tại.' });
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/products/:id', authenticate, authorizePermission('products.manage'), async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const price = Number(req.body?.price);
  const active = Boolean(req.body?.active);
  if (!name || !Number.isFinite(price) || price < 0) return res.status(400).json({ error: 'Dữ liệu sản phẩm không hợp lệ.' });

  try {
    const { rows } = await query(`
      UPDATE products SET name = $2, price = $3, active = $4
      WHERE id = $1
      RETURNING id, sku, name, price::float8 AS price, category_id, active
    `, [req.params.id, name, price, active]);
    if (!rows[0]) return res.status(404).json({ error: 'Product not found.' });
    await audit(req, 'PRODUCT_UPDATED', 'PRODUCT', req.params.id, { name, price, active });
    res.json({ data: rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/shifts/current', authenticate, authorizePermission('shift.manage'), async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT s.id, s.opened_by, s.opening_cash::float8 AS opening_cash, s.opened_at,
             s.status, s.opened_by_user_id
      FROM shifts s
      WHERE s.status = 'OPEN'
      ORDER BY s.opened_at DESC LIMIT 1
    `);
    res.json({ data: rows[0] ?? null });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/shifts/open', authenticate, authorizePermission('shift.manage'), async (req, res) => {
  const openingCash = Number(req.body?.openingCash ?? 0);
  if (!Number.isFinite(openingCash) || openingCash < 0) return res.status(400).json({ error: 'Tiền đầu ca không hợp lệ.' });

  try {
    const { rows } = await query(`
      INSERT INTO shifts (opened_by, opened_by_user_id, opening_cash)
      VALUES ($1, $2, $3)
      RETURNING id, opened_by, opened_by_user_id, opening_cash::float8 AS opening_cash, opened_at, status
    `, [req.user.username, req.user.id, openingCash]);
    await audit(req, 'SHIFT_OPENED', 'SHIFT', rows[0].id, { openingCash });
    res.status(201).json({ data: rows[0] });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Đã có một ca đang mở.' });
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/shifts/:id/close', authenticate, authorizePermission('shift.manage'), async (req, res) => {
  const closingCash = Number(req.body?.closingCash);
  if (!Number.isFinite(closingCash) || closingCash < 0) return res.status(400).json({ error: 'Tiền cuối ca không hợp lệ.' });

  try {
    const { rows: currentRows } = await query('SELECT id, opened_by_user_id, status FROM shifts WHERE id = $1', [req.params.id]);
    const shift = currentRows[0];
    if (!shift || shift.status !== 'OPEN') return res.status(404).json({ error: 'Ca đang mở không tồn tại.' });
    if (req.user.role !== 'admin' && shift.opened_by_user_id !== req.user.id) {
      return res.status(403).json({ error: 'Chỉ người mở ca mới được đóng ca.' });
    }

    const { rows } = await query(`
      UPDATE shifts
      SET status = 'CLOSED', closing_cash = $2, closed_at = NOW(), closed_by_user_id = $3
      WHERE id = $1 AND status = 'OPEN'
      RETURNING id, status, closing_cash::float8 AS closing_cash, closed_at
    `, [req.params.id, closingCash, req.user.id]);

    await audit(req, 'SHIFT_CLOSED', 'SHIFT', req.params.id, { closingCash });
    res.json({ data: rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/orders', authenticate, authorizePermission('sale.use'), async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  const paymentMethod = String(req.body?.paymentMethod || 'CASH').toUpperCase();
  const receivedAmount = Number(req.body?.receivedAmount ?? 0);
  const shiftId = req.body?.shiftId || null;

  if (!items.length) return res.status(400).json({ error: 'Order phải có ít nhất một món.' });
  if (!['CASH', 'QR'].includes(paymentMethod)) return res.status(400).json({ error: 'Phương thức thanh toán không hợp lệ.' });

  const normalized = items.map((item) => ({
    productId: String(item.productId || ''),
    quantity: Number(item.quantity)
  }));
  if (normalized.some((item) => !item.productId || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99)) {
    return res.status(400).json({ error: 'Order item không hợp lệ.' });
  }

  try {
    const result = await withTransaction(async (client) => {
      if (shiftId) {
        const shift = await client.query(
          'SELECT id FROM shifts WHERE id = $1 AND status = \'OPEN\' FOR UPDATE',
          [shiftId]
        );
        if (!shift.rows[0]) throw new Error('Ca bán hàng không còn mở.');
      }

      const ids = [...new Set(normalized.map((item) => item.productId))];
      const { rows: products } = await client.query(`
        SELECT id, name, price::float8 AS price
        FROM products
        WHERE id = ANY($1::uuid[]) AND active = TRUE
      `, [ids]);
      const byId = new Map(products.map((p) => [p.id, p]));

      const expanded = normalized.map((item) => {
        const product = byId.get(item.productId);
        if (!product) throw new Error('Có sản phẩm không tồn tại hoặc đã tắt bán.');
        return {
          productId: product.id,
          name: product.name,
          unitPrice: Number(product.price),
          quantity: item.quantity,
          lineTotal: Number(product.price) * item.quantity
        };
      });

      const subtotal = expanded.reduce((sum, item) => sum + item.lineTotal, 0);
      const total = subtotal;

      if (paymentMethod === 'CASH' && receivedAmount < total) {
        throw new Error('Tiền khách đưa chưa đủ.');
      }

      const { rows: orderRows } = await client.query(`
        INSERT INTO orders (
          shift_id, created_by_user_id, payment_status, kitchen_status, subtotal, discount, total
        )
        VALUES ($1, $2, 'PAID', 'NEW', $3, 0, $4)
        RETURNING id, order_number, subtotal::float8 AS subtotal, total::float8 AS total, created_at
      `, [shiftId, req.user.id, subtotal, total]);
      const order = orderRows[0];

      for (const item of expanded) {
        await client.query(`
          INSERT INTO order_items (
            order_id, product_id, product_name_snapshot, unit_price, quantity, line_total
          )
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [order.id, item.productId, item.name, item.unitPrice, item.quantity, item.lineTotal]);
      }

      const change = paymentMethod === 'CASH' ? receivedAmount - total : 0;
      await client.query(`
        INSERT INTO payments (
          order_id, method, amount, received_amount, change_amount, status
        )
        VALUES ($1, $2, $3, $4, $5, 'SUCCESS')
      `, [order.id, paymentMethod, total, paymentMethod === 'CASH' ? receivedAmount : total, change]);

      await client.query(`
        INSERT INTO audit_logs (actor, action, entity_type, entity_id, payload)
        VALUES ($1, 'ORDER_CREATED', 'ORDER', $2, $3::jsonb)
      `, [req.user.username, order.id, JSON.stringify({ paymentMethod, total })]);

      return {
        id: order.id,
        orderCode: `CF-${String(order.order_number).padStart(6, '0')}`,
        subtotal,
        discount: 0,
        total,
        paymentMethod,
        receivedAmount: paymentMethod === 'CASH' ? receivedAmount : total,
        change,
        kitchenStatus: 'NEW',
        createdAt: order.created_at,
        items: expanded
      };
    });

    res.status(201).json({ data: result });
  } catch (error) {
    res.status(error.statusCode || 400).json({ error: error.message });
  }
});

app.get('/api/orders/today', authenticate, authorizePermission('orders.view'), async (_req, res) => {
  try {
    const { rows } = await query(`
      SELECT o.id,
             ('CF-' || LPAD(o.order_number::text, 6, '0')) AS order_code,
             o.total::float8 AS total,
             o.payment_status,
             o.kitchen_status,
             o.created_at,
             COALESCE(SUM(oi.quantity), 0)::int AS item_count
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      WHERE o.created_at >= CURRENT_DATE
      GROUP BY o.id
      ORDER BY o.created_at DESC
      LIMIT 50
    `);
    res.json({ data: rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/kds/orders', authenticate, authorizePermission('kds.use'), async (_req, res) => {
  try {
    const { rows } = await query(`
      SELECT
        o.id,
        ('CF-' || LPAD(o.order_number::text, 6, '0')) AS order_code,
        o.kitchen_status,
        o.created_at,
        json_agg(
          json_build_object('name', oi.product_name_snapshot, 'quantity', oi.quantity)
          ORDER BY oi.product_name_snapshot
        ) AS items
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
      WHERE o.created_at >= CURRENT_DATE
        AND o.payment_status = 'PAID'
        AND o.kitchen_status IN ('NEW', 'PREPARING', 'READY')
      GROUP BY o.id
      ORDER BY o.created_at ASC
      LIMIT 50
    `);
    res.json({ data: rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/kds/orders/:id/status', authenticate, authorizePermission('kds.use'), async (req, res) => {
  const requested = String(req.body?.status || '').toUpperCase();
  const allowed = new Set(['NEW', 'PREPARING', 'READY', 'DONE', 'CANCELLED']);
  if (!allowed.has(requested)) return res.status(400).json({ error: 'Trạng thái KDS không hợp lệ.' });

  try {
    const result = await withTransaction(async (client) => {
      const { rows } = await client.query(
        'SELECT id, kitchen_status FROM orders WHERE id = $1 FOR UPDATE',
        [req.params.id]
      );
      const order = rows[0];
      if (!order) return null;

      const nextByState = { NEW: 'PREPARING', PREPARING: 'READY', READY: 'DONE' };
      if (req.user.role !== 'admin' && requested !== 'CANCELLED' && requested !== nextByState[order.kitchen_status]) {
        const error = new Error(`Không thể chuyển ${order.kitchen_status} → ${requested}.`);
        error.statusCode = 409;
        throw error;
      }

      const { rows: updated } = await client.query(
        'UPDATE orders SET kitchen_status = $2 WHERE id = $1 RETURNING id, kitchen_status',
        [req.params.id, requested]
      );

      await client.query(`
        INSERT INTO audit_logs (actor, action, entity_type, entity_id, payload)
        VALUES ($1, 'KDS_STATUS_CHANGED', 'ORDER', $2, $3::jsonb)
      `, [req.user.username, req.params.id, JSON.stringify({ from: order.kitchen_status, to: requested })]);

      return updated[0];
    });

    if (!result) return res.status(404).json({ error: 'Order không tồn tại.' });
    res.json({ data: result });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

app.get('/api/reports/today', authenticate, authorizePermission('reports.view'), async (_req, res) => {
  try {
    const [summary, topProducts, payments] = await Promise.all([
      query(`
        SELECT
          COUNT(*)::int AS order_count,
          COALESCE(SUM(total), 0)::float8 AS revenue,
          COALESCE(AVG(total), 0)::float8 AS average_order
        FROM orders
        WHERE created_at >= CURRENT_DATE AND status = 'COMPLETED'
      `),
      query(`
        SELECT product_name_snapshot AS name,
               SUM(quantity)::int AS quantity,
               SUM(line_total)::float8 AS revenue
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        WHERE o.created_at >= CURRENT_DATE AND o.status = 'COMPLETED'
        GROUP BY product_name_snapshot
        ORDER BY quantity DESC, revenue DESC
        LIMIT 8
      `),
      query(`
        SELECT method, COALESCE(SUM(amount),0)::float8 AS amount, COUNT(*)::int AS count
        FROM payments p
        JOIN orders o ON o.id = p.order_id
        WHERE o.created_at >= CURRENT_DATE AND p.status = 'SUCCESS'
        GROUP BY method
        ORDER BY amount DESC
      `)
    ]);

    res.json({
      data: {
        summary: summary.rows[0],
        topProducts: topProducts.rows,
        payments: payments.rows
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/users', authenticate, authorizeRoles('admin'), async (_req, res) => {
  try {
    const { rows } = await query(`SELECT ${userProjection} FROM users ORDER BY role, username`);
    res.json({ data: rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/users', authenticate, authorizeRoles('admin'), async (req, res) => {
  const username = String(req.body?.username || '').trim().toLowerCase();
  const displayName = String(req.body?.displayName || '').trim();
  const password = String(req.body?.password || '');
  const role = String(req.body?.role || '').trim().toLowerCase();

  if (!/^[a-z0-9._-]{3,32}$/.test(username)) return res.status(400).json({ error: 'Username 3-32 ký tự, chỉ a-z, 0-9, ., _, -.' });
  if (!displayName || password.length < 6 || !['cashier', 'barista', 'admin'].includes(role)) {
    return res.status(400).json({ error: 'Thông tin tài khoản không hợp lệ.' });
  }

  try {
    const passwordHash = await hashPassword(password);
    const { rows } = await query(`
      INSERT INTO users (username, display_name, password_hash, role, active)
      VALUES ($1, $2, $3, $4, TRUE)
      RETURNING ${userProjection}
    `, [username, displayName, passwordHash, role]);
    await audit(req, 'USER_CREATED', 'USER', rows[0].id, { username, role });
    res.status(201).json({ data: rows[0] });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Username đã tồn tại.' });
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/users/:id/status', authenticate, authorizeRoles('admin'), async (req, res) => {
  const active = Boolean(req.body?.active);
  if (req.params.id === req.user.id && !active) {
    return res.status(400).json({ error: 'Không thể tự khóa tài khoản đang đăng nhập.' });
  }

  try {
    const { rows: targetRows } = await query('SELECT id, username, role FROM users WHERE id = $1', [req.params.id]);
    const target = targetRows[0];
    if (!target) return res.status(404).json({ error: 'User không tồn tại.' });

    if (!active && target.role === 'admin') {
      const { rows } = await query(`SELECT COUNT(*)::int AS count FROM users WHERE role = 'admin' AND active = TRUE AND id <> $1`, [target.id]);
      if (Number(rows[0].count) === 0) return res.status(400).json({ error: 'Không thể khóa admin cuối cùng.' });
    }

    const { rows } = await query(
      `UPDATE users SET active = $2 WHERE id = $1 RETURNING ${userProjection}`,
      [req.params.id, active]
    );
    if (!active) await query('DELETE FROM sessions WHERE user_id = $1', [req.params.id]);
    await audit(req, 'USER_STATUS_CHANGED', 'USER', req.params.id, { active });
    res.json({ data: rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

async function audit(req, action, entityType, entityId, payload = {}) {
  await query(
    `INSERT INTO audit_logs (actor, action, entity_type, entity_id, payload)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [req.user.username, action, entityType, entityId, JSON.stringify(payload)]
  );
}

export async function waitForDatabase(retries = 30, delayMs = 1000) {
  let lastError;
  for (let i = 0; i < retries; i += 1) {
    try {
      await query('SELECT 1');
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

export async function closeDatabase() {
  await pool.end();
}

export default app;
