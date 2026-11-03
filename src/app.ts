import express, { type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { z, ZodError } from 'zod';
import type pg from 'pg';
import { createEngine, AppError, type Actor } from './engine.js';
import { hashPassword, verifyPassword, tokenService } from './security.js';
const uuid = z.string().uuid();
const email = z.string().trim().toLowerCase().email().max(254);
const password = z.string().min(12).max(128);
const name = z.string().trim().min(1).max(120);
const requireAdmin = (_req: Request, res: Response, next: NextFunction) => {
  if (res.locals.actor.role !== 'admin') throw new AppError(403, 'Acesso restrito ao administrador.');
  next();
};
export async function createApp(pool: pg.Pool, secret: string) {
  const app = express();
  const engine = createEngine(pool);
  const tokens = tokenService(secret);
  const dummyHash = await hashPassword('unused-random-password-for-timing');
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '32kb' }));
  app.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  app.get('/health', async (_req, res) => { await pool.query('SELECT 1'); res.json({ status: 'ok' }); });
  app.post('/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false }), async (req, res) => {
    const data = z.object({ email, password: z.string().min(1).max(128) }).parse(req.body);
    const user = (await pool.query('SELECT * FROM users WHERE email=$1', [data.email])).rows[0];
    const valid = await verifyPassword(data.password, user?.password_hash ?? dummyHash);
    if (!user || !user.enabled || !valid) throw new AppError(401, 'E-mail ou senha inválidos.');
    res.json({ token: await tokens.issue(user.id), expiresIn: 28800, user: { id: user.id, name: user.name, role: user.role } });
  });
  app.use(async (req, res, next) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new AppError(401, 'Autenticação necessária.');
    let id;
    try { id = uuid.parse(await tokens.verify(header.slice(7))); }
    catch { throw new AppError(401, 'Token inválido ou expirado.'); }
    const user = (await pool.query('SELECT id,name,email,role,available FROM users WHERE id=$1 AND enabled', [id])).rows[0];
    if (!user) throw new AppError(401, 'Usuário indisponível.');
    res.locals.actor = user satisfies Actor;
    next();
  });
  app.get('/me', (_req, res) => { res.json(res.locals.actor); });
  app.post('/users', requireAdmin, async (req, res) => {
    const data = z.object({ name, email, password, role: z.enum(['admin', 'seller']).default('seller') }).parse(req.body);
    const hash = await hashPassword(data.password);
    const result = await pool.query('INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id,name,email,role,available', [data.name, data.email, hash, data.role]);
    res.status(201).json(result.rows[0]);
  });
  app.get('/users', requireAdmin, async (_req, res) => {
    res.json((await pool.query('SELECT id,name,email,role,available,enabled FROM users ORDER BY name LIMIT 200')).rows);
  });
  app.patch('/me/availability', async (req, res) => {
    const { available } = z.object({ available: z.boolean() }).parse(req.body);
    res.json(await engine.setAvailability(res.locals.actor, available));
  });
  app.post('/customers', requireAdmin, async (req, res) => {
    const data = z.object({ name, phone: z.string().regex(/^\+[1-9]\d{7,14}$/) }).parse(req.body);
    res.status(201).json((await pool.query('INSERT INTO customers(name,phone) VALUES($1,$2) RETURNING *', [data.name, data.phone])).rows[0]);
  });
  app.post('/queue', requireAdmin, async (req, res) => {
    const data = z.object({ customerId: uuid, priority: z.number().int().min(0).max(10).default(0) }).parse(req.body);
    res.json(await engine.enqueue(res.locals.actor, data.customerId, data.priority));
  });
  app.get('/queue', async (_req, res) => {
    res.json((await pool.query("SELECT a.*,c.name AS customer_name FROM attendances a JOIN customers c ON c.id=a.customer_id WHERE a.status='waiting' ORDER BY a.priority DESC,a.created_at,a.id LIMIT 200")).rows);
  });
  app.get('/queue/suggestion', async (_req, res) => { res.json(await engine.suggest()); });
  app.get('/attendances', async (_req, res) => {
    const actor: Actor = res.locals.actor;
    res.json((await pool.query(`SELECT a.*,c.name AS customer_name,c.phone FROM attendances a
      JOIN customers c ON c.id=a.customer_id WHERE a.status='active' AND ($1::boolean OR a.seller_id=$2)
      ORDER BY a.started_at LIMIT 200`, [actor.role === 'admin', actor.id])).rows);
  });
  app.post('/attendances/:id/claim', async (req, res) => {
    const data = z.object({ sellerId: uuid.optional() }).parse(req.body ?? {});
    res.json(await engine.claim(res.locals.actor, uuid.parse(req.params.id), data.sellerId ?? res.locals.actor.id));
  });
  app.post('/attendances/:id/close', async (req, res) => {
    res.json(await engine.close(res.locals.actor, uuid.parse(req.params.id)));
  });
  app.post('/attendances/:id/transfer', requireAdmin, async (req, res) => {
    const data = z.object({ sellerId: uuid }).parse(req.body);
    res.json(await engine.transfer(res.locals.actor, uuid.parse(req.params.id), data.sellerId));
  });
  app.get('/attendances/:id/events', requireAdmin, async (req, res) => {
    res.json((await pool.query('SELECT * FROM attendance_events WHERE attendance_id=$1 ORDER BY id', [uuid.parse(req.params.id)])).rows);
  });
  app.use((_req, res) => { res.status(404).json({ error: 'Rota não encontrada.' }); });
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof ZodError) { res.status(400).json({ error: 'Dados inválidos.', fields: error.issues.map(i => ({ field: i.path.join('.'), message: i.message })) }); return; }
    if (error instanceof AppError) { res.status(error.status).json({ error: error.message }); return; }
    const code = (error as { code?: string }).code;
    if (code === '23505') { res.status(409).json({ error: 'Registro já existe ou vaga já ocupada.' }); return; }
    if (code === '55P03' || code === '57014') { res.status(503).json({ error: 'Sistema ocupado. Tente novamente.' }); return; }
    const type = (error as { type?: string }).type;
    if (type === 'entity.parse.failed' || type === 'entity.too.large') {
      res.status(type === 'entity.too.large' ? 413 : 400).json({ error: 'Corpo da requisição inválido.' }); return;
    }
    // Não registra payloads, tokens, senhas ou parâmetros SQL.
    console.error('Falha interna da API', { code: code ?? 'unknown' });
    res.status(500).json({ error: 'Erro interno.' });
  });
  return app;
}
