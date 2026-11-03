import { before, beforeEach, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import { createPool } from '../src/db.js';
import { createEngine, type Actor } from '../src/engine.js';
import { createApp } from '../src/app.js';
import { hashPassword, verifyPassword, tokenService } from '../src/security.js';
if (!process.env.TEST_DATABASE_URL) throw new Error('Execute npm test para usar um banco descartável.');
const pool = createPool(process.env.TEST_DATABASE_URL);
const engine = createEngine(pool);
const secret = randomBytes(32).toString('hex');
const tokens = tokenService(secret);
let admin: Actor, seller: Actor, other: Actor, server: Server, base: string;
let passwordHash: string;
async function user(role: Actor['role'], email: string): Promise<Actor> {
  return (await pool.query('INSERT INTO users(name,email,password_hash,role,available) VALUES($1,$1,$2,$3,true) RETURNING id,role', [email, passwordHash, role])).rows[0];
}
async function queue(priority = 0) {
  const customer = (await pool.query('INSERT INTO customers(name,phone) VALUES($1,$2) RETURNING id', ['Cliente teste', `+55${Math.floor(Math.random() * 9e10 + 1e10)}`])).rows[0];
  return engine.enqueue(admin, customer.id, priority);
}
async function call(path: string, actor?: Actor, body?: unknown, method = 'POST') {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (actor) headers.Authorization = `Bearer ${await tokens.issue(actor.id)}`;
  return fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}
before(async () => {
  await pool.query(await readFile(new URL('../migrations/001_initial.sql', import.meta.url), 'utf8'));
  passwordHash = await hashPassword('test-password-only-123');
  const app = await createApp(pool, secret);
  server = await new Promise<Server>(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Servidor indisponível.');
  base = `http://127.0.0.1:${address.port}`;
});
beforeEach(async () => {
  await pool.query('TRUNCATE attendance_events,attendances,customers,users RESTART IDENTITY CASCADE');
  admin = await user('admin', 'admin@example.invalid');
  seller = await user('seller', 'seller@example.invalid');
  other = await user('seller', 'other@example.invalid');
});
after(async () => { if (server) await new Promise<void>(resolve => server.close(() => resolve())); await pool.end(); });
test('senhas são verificadas sem armazenar texto puro', async () => {
  assert.equal(await verifyPassword('test-password-only-123', passwordHash), true);
  assert.equal(await verifyPassword('wrong-password', passwordHash), false);
  assert.equal(passwordHash.includes('test-password'), false);
});
test('dez pedidos simultâneos nunca ultrapassam duas vagas', async () => {
  const items = await Promise.all(Array.from({ length: 10 }, () => queue()));
  const results = await Promise.allSettled(items.map(item => engine.claim(admin, item.id, seller.id)));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 2);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM attendances WHERE status='active'")).rows[0].n, 2);
});
test('dois vendedores disputando o mesmo cliente: apenas um assume', async () => {
  const item = await queue();
  const results = await Promise.allSettled([engine.claim(seller, item.id, seller.id), engine.claim(other, item.id, other.id)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM attendance_events WHERE action='claimed'")).rows[0].n, 1);
});
test('entrada repetida do cliente reutiliza atendimento aberto', async () => {
  const item = await queue();
  const results = await Promise.all(Array.from({ length: 5 }, () => engine.enqueue(admin, item.customer_id, 0)));
  assert.ok(results.every(r => r.id === item.id));
});
test('sugestão respeita prioridade e não reserva vaga', async () => {
  await queue(0); const urgent = await queue(10);
  const result = await engine.suggest();
  assert.equal(result.attendance.id, urgent.id);
  assert.equal(result.reserved, false);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM attendances WHERE status='active'")).rows[0].n, 0);
});
test('vendedor segue a fila e não assume para outro vendedor', async () => {
  const low = await queue(0); await queue(10);
  await assert.rejects(engine.claim(seller, low.id, seller.id), /primeiro atendimento/);
  await assert.rejects(engine.claim(seller, low.id, other.id), /para si/);
});
test('transferência para vendedor cheio falha sem alterar proprietário', async () => {
  const a = await queue(), b = await queue(), c = await queue();
  await engine.claim(admin, a.id, seller.id);
  await engine.claim(admin, b.id, other.id); await engine.claim(admin, c.id, other.id);
  await assert.rejects(engine.transfer(admin, a.id, other.id), /dois atendimentos/);
  assert.equal((await pool.query('SELECT seller_id FROM attendances WHERE id=$1', [a.id])).rows[0].seller_id, seller.id);
  await assert.rejects(engine.transfer(seller, a.id, other.id), /administrador/);
});
test('finalização libera vaga; transferência registra origem e destino', async () => {
  const a = await queue(), b = await queue(), c = await queue();
  await engine.claim(admin, a.id, seller.id); await engine.claim(admin, b.id, seller.id);
  await assert.rejects(engine.close(other, a.id), /outro vendedor/);
  await engine.close(seller, a.id); await engine.claim(admin, c.id, seller.id);
  await engine.transfer(admin, c.id, other.id);
  const events = (await pool.query("SELECT * FROM attendance_events WHERE attendance_id=$1 AND action='transferred'", [c.id])).rows;
  assert.equal(events[0].from_seller_id, seller.id); assert.equal(events[0].to_seller_id, other.id);
});
test('vendedor indisponível não recebe novos atendimentos', async () => {
  await engine.setAvailability(seller, false); const item = await queue();
  await assert.rejects(engine.claim(admin, item.id, seller.id), /indisponível/);
});
test('banco impede terceira vaga mesmo em SQL direto', async () => {
  const a = await queue(), b = await queue(), c = await queue();
  await engine.claim(admin, a.id, seller.id); await engine.claim(admin, b.id, seller.id);
  await assert.rejects(pool.query("UPDATE attendances SET status='active',seller_id=$2,slot=3,started_at=now() WHERE id=$1", [c.id, seller.id]), (e: any) => e.code === '23514');
  await assert.rejects(pool.query("UPDATE attendances SET status='active',seller_id=$2,slot=1,started_at=now() WHERE id=$1", [c.id, seller.id]), (e: any) => e.code === '23505');
});
test('API autentica, valida entrada e restringe administração', async () => {
  assert.equal((await call('/queue', undefined, undefined, 'GET')).status, 401);
  assert.equal((await call('/customers', seller, { name: 'A', phone: '+5511999999999' })).status, 403);
  assert.equal((await call('/customers', admin, { name: 'A', phone: 'invalid' })).status, 400);
  assert.equal((await call('/auth/login', undefined, { email: 'admin@example.invalid', password: 'wrong' })).status, 401);
  const login = await call('/auth/login', undefined, { email: 'admin@example.invalid', password: 'test-password-only-123' });
  assert.equal(login.status, 200); assert.equal(typeof (await login.json()).token, 'string');
  const missing = await call('/attendances/not-a-uuid/close', admin, {});
  assert.equal(missing.status, 400);
});
test('API oculta atendimentos alheios e rejeita token de usuário desativado', async () => {
  const item = await queue(); await engine.claim(admin, item.id, seller.id);
  const response = await call('/attendances', other, undefined, 'GET');
  assert.deepEqual(await response.json(), []);
  await pool.query('UPDATE users SET enabled=false WHERE id=$1', [seller.id]);
  assert.equal((await call('/me', seller, undefined, 'GET')).status, 401);
});
