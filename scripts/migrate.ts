import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { createPool } from '../src/db.js';
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('Configure DATABASE_URL no .env.');
const pool = createPool(connectionString);
const db = await pool.connect();
try {
  await db.query('BEGIN');
  await db.query('SELECT pg_advisory_xact_lock(20261104)');
  await db.query('CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const version = '001_initial';
  if (!(await db.query('SELECT version FROM schema_migrations WHERE version=$1', [version])).rowCount) {
    await db.query(await readFile(new URL('../migrations/001_initial.sql', import.meta.url), 'utf8'));
    await db.query('INSERT INTO schema_migrations(version) VALUES($1)', [version]);
    console.log('Migração 001 aplicada.');
  } else console.log('Banco atualizado.');
  await db.query('COMMIT');
} catch (error) { await db.query('ROLLBACK'); throw error; }
finally { db.release(); await pool.end(); }
