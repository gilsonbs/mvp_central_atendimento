import pg from 'pg';
export const ENGINE_LOCK = 20261103;
export function createPool(connectionString: string) {
  return new pg.Pool({ connectionString, max: 10, connectionTimeoutMillis: 5000 });
}
export async function transaction<T>(pool: pg.Pool, work: (db: pg.PoolClient) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query("SET LOCAL lock_timeout = '5s'");
    await db.query("SET LOCAL statement_timeout = '10s'");
    // Serializa somente as mutações do motor, entre todas as instâncias da API.
    await db.query('SELECT pg_advisory_xact_lock($1)', [ENGINE_LOCK]);
    const result = await work(db);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally { db.release(); }
}
