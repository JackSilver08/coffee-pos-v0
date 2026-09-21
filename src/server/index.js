import dotenv from 'dotenv';
import app, { closeDatabase, waitForDatabase } from './app.js';

dotenv.config({ override: true });

const port = Number(process.env.PORT || 4782);

await waitForDatabase();
const server = app.listen(port, '127.0.0.1', () => {
  console.log(`Coffee POS API listening on http://127.0.0.1:${port}`);
});

const shutdown = async () => {
  server.close(async () => {
    await closeDatabase();
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

export { server };
