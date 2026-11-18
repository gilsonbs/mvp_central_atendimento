import type pg from 'pg';

export async function checkWhatsApp(pool: pg.Pool) {
  const instance = process.env.EVOLUTION_INSTANCE || 'central-teste';
  const url = process.env.EVOLUTION_API_URL;
  const key = process.env.EVOLUTION_API_KEY;
  const last = (await pool.query(
    "SELECT max(received_at) AS last_incoming_at FROM whatsapp_messages WHERE instance=$1 AND direction='incoming'", [instance]
  )).rows[0];
  let apiStatus = 'not_configured';
  let connectionState = 'unknown';
  if (url && key) {
    try {
      const response = await fetch(url.replace(/\/$/, '') + '/instance/connectionState/' + encodeURIComponent(instance), {
        headers: { apikey: key }, signal: AbortSignal.timeout(5000)
      });
      apiStatus = response.ok ? 'reachable' : 'http_error';
      if (response.ok) {
        const data = await response.json().catch(() => null);
        const state = data?.instance?.state;
        if (state === 'open' || state === 'close' || state === 'connecting') connectionState = state;
      }
    } catch { apiStatus = 'unreachable'; }
  }
  return { apiStatus, connectionState, lastIncomingAt: last?.last_incoming_at ?? null,
    checkedAt: new Date().toISOString(), inboundHealth: 'unverified' };
}

// Observe only. Never restart services or infer failure from idle traffic.
export function startGuardian(pool: pg.Pool) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let previous = '';
  let pending: Promise<void> = Promise.resolve();
  async function tick() {
    try {
      const status = await checkWhatsApp(pool);
      const current = status.apiStatus + '/' + status.connectionState;
      if (current !== previous) {
        console.info('[Guardian]', JSON.stringify({ event: 'state_changed', previous: previous || null,
          current, checkedAt: status.checkedAt, lastIncomingAt: status.lastIncomingAt }));
        previous = current;
      }
    } catch {
      if (previous !== 'check_failed') {
        console.error('[Guardian]', JSON.stringify({ event: 'check_failed', checkedAt: new Date().toISOString() }));
        previous = 'check_failed';
      }
    } finally {
      if (!stopped) timer = setTimeout(run, 30000);
    }
  }
  function run() { if (!stopped) pending = tick(); }
  run();
  return async () => { stopped = true; clearTimeout(timer); await pending; };
}
