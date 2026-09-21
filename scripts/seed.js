import dotenv from 'dotenv';
import pg from 'pg';
import { hashPassword } from '../src/server/auth.js';

dotenv.config({ override: true });
const { Client } = pg;
const client = new Client({ connectionString: process.env.DATABASE_URL });

const data = {
  'Cà phê': [
    ['CF-001', 'Espresso', 30000],
    ['CF-002', 'Americano', 35000],
    ['CF-003', 'Cà phê sữa', 39000],
    ['CF-004', 'Latte', 45000],
    ['CF-005', 'Cappuccino', 45000]
  ],
  'Trà': [
    ['TR-001', 'Trà đào cam sả', 49000],
    ['TR-002', 'Trà vải', 45000],
    ['TR-003', 'Trà chanh mật ong', 39000]
  ],
  'Trà sữa': [
    ['TS-001', 'Trà sữa truyền thống', 42000],
    ['TS-002', 'Trà sữa matcha', 49000],
    ['TS-003', 'Trà sữa ô long', 47000]
  ],
  'Bánh': [
    ['BK-001', 'Croissant bơ', 35000],
    ['BK-002', 'Tiramisu', 52000],
    ['BK-003', 'Cheesecake', 55000]
  ]
};

const users = [
  { username: 'admin', displayName: 'Quản trị viên', role: 'admin', password: 'admin123' },
  { username: 'cashier', displayName: 'Thu ngân 01', role: 'cashier', password: 'cashier123' },
  { username: 'barista', displayName: 'Barista 01', role: 'barista', password: 'barista123' }
];

await client.connect();
try {
  let sortOrder = 1;
  for (const [categoryName, products] of Object.entries(data)) {
    const category = await client.query(`
      INSERT INTO categories (name, sort_order)
      VALUES ($1, $2)
      ON CONFLICT (name) DO UPDATE SET active = TRUE, sort_order = EXCLUDED.sort_order
      RETURNING id
    `, [categoryName, sortOrder++]);

    const categoryId = category.rows[0].id;

    for (const [sku, name, price] of products) {
      await client.query(`
        INSERT INTO products (category_id, sku, name, price)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (sku) DO UPDATE SET
          category_id = EXCLUDED.category_id,
          name = EXCLUDED.name,
          price = EXCLUDED.price,
          active = TRUE
      `, [categoryId, sku, name, price]);
    }
  }

  for (const user of users) {
    const passwordHash = await hashPassword(user.password);
    await client.query(`
      INSERT INTO users (username, display_name, password_hash, role, active)
      VALUES ($1, $2, $3, $4, TRUE)
      ON CONFLICT (username) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        password_hash = EXCLUDED.password_hash,
        role = EXCLUDED.role,
        active = TRUE
    `, [user.username, user.displayName, passwordHash, user.role]);
  }

  console.log('Seed completed. Demo accounts: admin/admin123, cashier/cashier123, barista/barista123');
} finally {
  await client.end();
}
