import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();
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

  console.log('Seed completed.');
} finally {
  await client.end();
}
