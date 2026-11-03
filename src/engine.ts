import type pg from 'pg';
import { transaction } from './db.js';
export class AppError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export type Actor = { id: string; role: 'admin' | 'seller' };
async function event(db: pg.PoolClient, id: string, actor: Actor, action: string, from: string | null, to: string | null) {
  await db.query('INSERT INTO attendance_events(attendance_id, actor_id, action, from_seller_id, to_seller_id) VALUES($1,$2,$3,$4,$5)', [id, actor.id, action, from, to]);
}
async function vacancy(db: pg.PoolClient, sellerId: string): Promise<number> {
  const seller = (await db.query("SELECT id FROM users WHERE id=$1 AND role='seller' AND enabled AND available", [sellerId])).rows[0];
  if (!seller) throw new AppError(409, 'Vendedor indisponível.');
  const occupied = (await db.query("SELECT slot FROM attendances WHERE seller_id=$1 AND status='active'", [sellerId])).rows.map(r => r.slot);
  const slot = [1, 2].find(value => !occupied.includes(value));
  if (!slot) throw new AppError(409, 'Vendedor já possui dois atendimentos ativos.');
  return slot;
}
export function createEngine(pool: pg.Pool) {
  return {
    enqueue: (actor: Actor, customerId: string, priority: number) => transaction(pool, async db => {
      if (actor.role !== 'admin') throw new AppError(403, 'Acesso restrito ao administrador.');
      if (!(await db.query('SELECT id FROM customers WHERE id=$1', [customerId])).rowCount) throw new AppError(404, 'Cliente não encontrado.');
      const existing = (await db.query("SELECT * FROM attendances WHERE customer_id=$1 AND status IN ('waiting','active')", [customerId])).rows[0];
      if (existing) return existing;
      const row = (await db.query('INSERT INTO attendances(customer_id, priority) VALUES($1,$2) RETURNING *', [customerId, priority])).rows[0];
      await event(db, row.id, actor, 'queued', null, null);
      return row;
    }),
    suggest: async () => {
      const customer = (await pool.query("SELECT * FROM attendances WHERE status='waiting' ORDER BY priority DESC, created_at, id LIMIT 1")).rows[0] ?? null;
      const seller = (await pool.query(`SELECT u.id, u.name, count(a.id)::int AS active_count
        FROM users u LEFT JOIN attendances a ON a.seller_id=u.id AND a.status='active'
        WHERE u.role='seller' AND u.enabled AND u.available
        GROUP BY u.id HAVING count(a.id)<2
        ORDER BY count(a.id), u.last_assigned_at NULLS FIRST, u.created_at, u.id LIMIT 1`)).rows[0] ?? null;
      return { attendance: customer, seller, reserved: false };
    },
    claim: (actor: Actor, id: string, sellerId: string) => transaction(pool, async db => {
      if (actor.role !== 'admin' && actor.id !== sellerId) throw new AppError(403, 'Você só pode assumir para si.');
      const row = (await db.query('SELECT * FROM attendances WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!row) throw new AppError(404, 'Atendimento não encontrado.');
      if (row.status !== 'waiting') throw new AppError(409, 'Atendimento não está na fila.');
      // Vendedores seguem a fila. O administrador pode direcionar outra posição.
      if (actor.role === 'seller') {
        const next = (await db.query("SELECT id FROM attendances WHERE status='waiting' ORDER BY priority DESC, created_at, id LIMIT 1")).rows[0];
        if (next?.id !== id) throw new AppError(409, 'Assuma o primeiro atendimento da fila.');
      }
      const slot = await vacancy(db, sellerId);
      const result = (await db.query("UPDATE attendances SET status='active', seller_id=$2, slot=$3, started_at=now() WHERE id=$1 RETURNING *", [id, sellerId, slot])).rows[0];
      await db.query('UPDATE users SET last_assigned_at=now() WHERE id=$1', [sellerId]);
      await event(db, id, actor, 'claimed', null, sellerId);
      return result;
    }),
    close: (actor: Actor, id: string) => transaction(pool, async db => {
      const row = (await db.query('SELECT * FROM attendances WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!row) throw new AppError(404, 'Atendimento não encontrado.');
      if (actor.role !== 'admin' && row.seller_id !== actor.id) throw new AppError(403, 'Atendimento pertence a outro vendedor.');
      if (row.status !== 'active') throw new AppError(409, 'Atendimento não está ativo.');
      const result = (await db.query("UPDATE attendances SET status='closed', slot=NULL, closed_at=now() WHERE id=$1 RETURNING *", [id])).rows[0];
      await event(db, id, actor, 'closed', row.seller_id, null);
      return result;
    }),
    transfer: (actor: Actor, id: string, sellerId: string) => transaction(pool, async db => {
      if (actor.role !== 'admin') throw new AppError(403, 'Somente o administrador pode transferir.');
      const row = (await db.query('SELECT * FROM attendances WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!row) throw new AppError(404, 'Atendimento não encontrado.');
      if (row.status !== 'active') throw new AppError(409, 'Atendimento não está ativo.');
      if (row.seller_id === sellerId) throw new AppError(409, 'Selecione outro vendedor.');
      const slot = await vacancy(db, sellerId);
      const result = (await db.query('UPDATE attendances SET seller_id=$2, slot=$3 WHERE id=$1 RETURNING *', [id, sellerId, slot])).rows[0];
      await db.query('UPDATE users SET last_assigned_at=now() WHERE id=$1', [sellerId]);
      await event(db, id, actor, 'transferred', row.seller_id, sellerId);
      return result;
    }),
    setAvailability: (actor: Actor, available: boolean) => transaction(pool, async db => {
      if (actor.role !== 'seller') throw new AppError(403, 'Disponibilidade se aplica a vendedores.');
      return (await db.query('UPDATE users SET available=$2 WHERE id=$1 RETURNING id,name,available', [actor.id, available])).rows[0];
    })
  };
}
