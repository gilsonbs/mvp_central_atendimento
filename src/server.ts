import 'dotenv/config';
import { z } from 'zod';
import { createPool } from './db.js';
import { createApp } from './app.js';
const parsed = z.object({
  DATABASE_URL: z.string().url(), JWT_SECRET: z.string().min(32),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('127.0.0.1')
}).safeParse(process.env);
if (!parsed.success) {
  console.error('Configure no .env:', parsed.error.issues.map(i => i.path.join('.')).join(', '));
  process.exit(1);
}
const config = parsed.data;
const pool = createPool(config.DATABASE_URL);
await pool.query('SELECT 1');
const app = await createApp(pool, config.JWT_SECRET);
const server = app.listen(config.PORT, config.HOST, () => console.log(`API em http://${config.HOST}:${config.PORT}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  server.close(() => { void pool.end().then(() => process.exit(0)); });
  setTimeout(() => process.exit(1), 10000).unref();
});
