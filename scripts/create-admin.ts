import 'dotenv/config';
import { z } from 'zod';
import { createPool } from '../src/db.js';
import { hashPassword } from '../src/security.js';
const parsed = z.object({
  DATABASE_URL: z.string().url(), ADMIN_NAME: z.string().trim().min(1).max(120),
  ADMIN_EMAIL: z.string().trim().toLowerCase().email().max(254), ADMIN_PASSWORD: z.string().min(12).max(128)
}).safeParse(process.env);
if (!parsed.success) {
  console.error('Configure no .env:', parsed.error.issues.map(i => i.path.join('.')).join(', '));
  process.exit(1);
}
const config = parsed.data;
const pool = createPool(config.DATABASE_URL);
try {
  await pool.query("INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,'admin')", [config.ADMIN_NAME, config.ADMIN_EMAIL, await hashPassword(config.ADMIN_PASSWORD)]);
  console.log('Administrador criado. Remova ADMIN_PASSWORD do .env.');
} catch { console.error('Não foi possível criar o administrador. Verifique a conexão, as migrações e se o e-mail já existe.'); process.exitCode = 1; }
finally { await pool.end(); }
