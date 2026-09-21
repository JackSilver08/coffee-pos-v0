import express from 'express';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { pool, query, withTransaction } from './db.js';

const app = express();

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '256kb' }));

app.get('/api/health', async (_req, res) => {
  try {
    await query('SELECT 1');
    res.json({ ok: true, database: 'connected', service: 'coffee-pos-api' });
  } catch (error) {
    res.status(503).json({ ok: false, database: 'disconnected', error: error.message });
  }
});

app.get('/api/products', async (_req, res) => {
  try {
    const { rows } = await query(`
      SELECT
        p.id,
        p.sku,
        p.name,
        p.price::float8 AS price,
        c.id AS category_id,
        c.name AS category_name,
        c.sort_order
      FROM products p
      JOIN categories c ON c.id = p.category_id
      WHERE p.active = TRUE AND c.active = TRUE
      ORDER BY c.sort_order, c.name, p.name
    `);

    res.json({ data: rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/categories', async (_req, res) => {
  try {
    const { rows } = await query(`
      SELECT id, name, sort_order
      FROM categories
      WHERE active = TRUE
      ORDER BY sort_order, name
    `);
    res.json({ data: rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/shifts/current', async (_req, res) => {
  try {
    const { rows } = await query(`
      SELECT
        id,
        opened_by,
        opening_cash::float8 AS opening_cash,
        opened_at,
        status
      FROM shifts
      WHERE status = 'OPEN'
      ORDER BY opened_at DESC
      LIMIT 1
    `);
    res.json({ data: rows[0] ?? null });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/shifts/open', async (req, res) => {
  const openedBy = String(req.body?.openedBy || '').trim() || 'Manager';
  const openingCash = Number(req.body?.openingCash ?? 0);

  if (!Number.isFinite(openingCash) || openingCash < 0) {
    return res.status(400).json({ error: 'openingCash must be a non-negative number.' });
  }

  try {
    const { rows } = await query(`
      INSERT INTO shifts (opened_by, opening_cash)
      VALUES ($1, $2)
      RETURNING id, opened_by, opening_cash::float8 AS opening_cash, opened_at, status
    `, [openedBy, openingCash]);

    res.status(201).json({ data: rows[0] });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'There is already an open shift.' });
    }
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/shifts/:id/close', async (req, res) => {
  const closingCash = Number(req.body?.closingCash);
  if (!Number.isFinite(closingCash) || closingCash < 0) {
    return res.status(400).json({ error: 'closingCash must be a non-negative number.' });
  }

  try {
    const { rows } = await query(`
      UPDATE shifts
      SET status = 'CLOSED', closing_cash = $2, closed_at = NOW()
      WHERE id = $1 AND status = 'OPEN'
      RETURNING id, status, closing_cash::float8 AS closing_cash, closed_at
    `, [req.params.id, closingCash]);

    if (!rows[0]) return res.status(404).json({ error: 'Open shift not found.' });
    res.json({ data: rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/orders/today', async (_req, res) => {
  try {
    const { rows } = await query(`
      SELECT
        o.id,
        ('CF-' || LPAD(o.order_number::text, 6, '0')) AS order_code,
        o.total::float8 AS total,
        o.payment_status,
        p.method AS payment_method,
        o.created_at,
        COALESCE(SUM(oi.quantity), 0)::int AS item_count
      FROM orders o
      LEFT JOIN payments p ON p.order_id = o.id AND p.status = 'SUCCESS'
      LEFT JOIN order_items oi ON oi.order_id = o.id
      WHERE o.created_at >= CURRENT_DATE
      GROUP BY o.id, p.method
      ORDER BY o.created_at DESC
      LIMIT 30
    `);
    res.json({ data: rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/reports/today', async (_req, res) => {
  try {
    const [summary, topProducts] = await Promise.all([
      query(`
        SELECT
          COUNT(*)::int AS order_count,
          COALESCE(SUM(total), 0)::float8 AS revenue,
          COALESCE(SUM(CASE WHEN payment_status = 'PAID' THEN total ELSE 0 END), 0)::float8 AS paid_revenue
        FROM orders
        WHERE created_at >= CURRENT_DATE AND status = 'COMPLETED'
      `),
      query(`
        SELECT
          product_name_snapshot AS name,
          SUM(quantity)::int AS quantity,
          SUM(line_total)::float8 AS revenue
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        WHERE o.created_at >= CURRENT_DATE AND o.status = 'COMPLETED'
        GROUP BY product_name_snapshot
        ORDER BY quantity DESC, revenue DESC
        LIMIT 5
      `)
    ]);

    res.json({ data: { summary: summary.rows[0], topProducts: topProducts.rows } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/orders', async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  const paymentMethod = String(req.body?.paymentMethod || 'CASH').toUpperCase();
  const receivedAmount = Number(req.body?.receivedAmount ?? 0);
  const shiftId = req.body?.shiftId || null;

  if (!items.length) return res.status(400).json({ error: 'Order must contain at least one item.' });
  if (!['CASH', 'QR'].includes(paymentMethod)) {
    return res.status(400).json({ error: 'Unsupported payment method.' });
  }

  const normalized = items.map((item) => ({
    productId: String(item.productId),
    quantity: Number(item.quantity)
  }));

  if (normalized.some((item) => !item.productId || !Number.isInteger(item.quantity) || item.quantity <= 0 || item.quantity > 99)) {
    return res.status(400).json({ error: 'Invalid order item.' });
  }

  try {
    const result = await withTransaction(async (client) => {
      const ids = [...new Set(normalized.map((item) => item.productId))];
      const productResult = await client.query(`
        SELECT id, name, price::float8 AS price
        FROM products
        WHERE active = TRUE AND id = ANY($1::uuid[])
        FOR SHARE
      `, [ids]);

      const productMap = new Map(productResult.rows.map((p) => [p.id, p]));
      const expanded = [];

      for (const item of normalized) {
        const product = productMap.get(item.productId);
        if (!product) throw new Error(`Product not found: ${item.productId}`);
        expanded.push({
          productId: product.id,
          name: product.name,
          unitPrice: Number(product.price),
          quantity: item.quantity,
          lineTotal: Number(product.price) * item.quantity
        });
      }

      const subtotal = expanded.reduce((sum, item) => sum + item.lineTotal, 0);
      const discount = 0;
      const total = subtotal - discount;

      if (paymentMethod === 'CASH' && receivedAmount < total) {
        throw new Error(`Cash received (${receivedAmount}) is less than total (${total}).`);
      }

      const orderInsert = await client.query(`
        INSERT INTO orders (shift_id, payment_status, subtotal, discount, total)
        VALUES ($1, 'PAID', $2, $3, $4)
        RETURNING id, order_number, total::float8 AS total, created_at
      `, [shiftId, subtotal, discount, total]);

      const order = orderInsert.rows[0];

      for (const item of expanded) {
        await client.query(`
          INSERT INTO order_items (
            order_id, product_id, product_name_snapshot, unit_price, quantity, line_total
          ) VALUES ($1, $2, $3, $4, $5, $6)
        `, [order.id, item.productId, item.name, item.unitPrice, item.quantity, item.lineTotal]);
      }

      const change = paymentMethod === 'CASH' ? receivedAmount - total : 0;
      await client.query(`
        INSERT INTO payments (order_id, method, amount, received_amount, change_amount, status)
        VALUES ($1, $2, $3, $4, $5, 'SUCCESS')
      `, [order.id, paymentMethod, total, paymentMethod === 'CASH' ? receivedAmount : total, change]);

      await client.query(`
        INSERT INTO audit_logs (actor, action, entity_type, entity_id, payload)
        VALUES ($1, 'ORDER_CREATED', 'ORDER', $2, $3::jsonb)
      `, ['local-cashier', order.id, JSON.stringify({ paymentMethod, total })]);

      return {
        id: order.id,
        orderCode: `CF-${String(order.order_number).padStart(6, '0')}`,
        subtotal,
        discount,
        total,
        paymentMethod,
        receivedAmount: paymentMethod === 'CASH' ? receivedAmount : total,
        change,
        createdAt: order.created_at,
        items: expanded
      };
    });

    res.status(201).json({ data: result });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: 'Internal server error.' });
});

export async function waitForDatabase(retries = 30, delayMs = 1000) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
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
