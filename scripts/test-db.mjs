import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
const container = `central-test-${randomBytes(6).toString('hex')}`;
const secret = randomBytes(32).toString('hex');
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', env: { ...process.env, POSTGRES_PASSWORD: secret }, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
let started = false;
try {
  docker('run', '--detach', '--rm', '--name', container, '-e', 'POSTGRES_PASSWORD', '-e', 'POSTGRES_DB=central_test', '-p', '127.0.0.1::5432', 'postgres:17-alpine');
  started = true;
  const port = docker('port', container, '5432/tcp').split(':').at(-1);
  const url = `postgresql://postgres:${secret}@127.0.0.1:${port}/central_test`;
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 1000 });
    try { await client.connect(); await client.query('SELECT 1'); ready = true; }
    catch { await new Promise(resolve => setTimeout(resolve, 500)); }
    finally { await client.end(); }
    if (ready) break;
  }
  if (!ready) throw new Error('Banco de testes não ficou disponível.');
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', 'tests/integration.test.ts'], {
    stdio: 'inherit', env: { ...process.env, TEST_DATABASE_URL: url }
  });
  process.exitCode = result.status ?? 1;
} catch (error) {
  console.error('Falha ao preparar testes. Verifique se o Docker está em execução.', error instanceof Error ? error.message.replaceAll(secret, '[redacted]') : '');
  process.exitCode = 1;
} finally { if (started) docker('rm', '--force', container); }
