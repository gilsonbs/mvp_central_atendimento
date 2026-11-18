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

// Inspect configuration without logging URLs, credentials or message content.
export async function checkWebhook() {
  const instance = process.env.EVOLUTION_INSTANCE || 'central-teste';
  const url = process.env.EVOLUTION_API_URL;
  const key = process.env.EVOLUTION_API_KEY;
  const secret = process.env.EVOLUTION_WEBHOOK_SECRET;
  if (!url || !key || !secret) return 'not_configured';
  try {
    const response = await fetch(url.replace(/\/$/, '') + '/webhook/find/' + encodeURIComponent(instance), {
      headers: { apikey: key }, signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) return 'http_error';
    const data = await response.json();
    if (!data || typeof data.enabled !== 'boolean') return 'unknown';
    if (!data.enabled) return 'disabled';
    if (!Array.isArray(data.events)) return 'unknown';
    if (!data.events.includes('MESSAGES_UPSERT')) return 'missing_event';
    if (data.webhookByEvents === true || data.byEvents === true) return 'unexpected_event_routing';
    if (typeof data.url !== 'string') return 'unknown';
    let target: URL;
    try { target = new URL(data.url); } catch { return 'invalid_target'; }
    if (!['http:', 'https:'].includes(target.protocol) || target.pathname !== '/webhooks/evolution/' + secret) return 'unexpected_target';
    return 'configured';
  } catch { return 'unreachable_or_invalid_response'; }
}

// Observe only. Never restart services or infer failure from idle traffic.
export function startGuardian(pool: pg.Pool) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let previous: string | null = null;
  let loaded = false;
  const instance = process.env.EVOLUTION_INSTANCE || 'central-teste';
  let failed = false;
  let previousWebhook: string | null = null;
  let pending: Promise<void> = Promise.resolve();
  async function tick() {
    try {
      if (!loaded) {
        const row = (await pool.query('SELECT current_state FROM guardian_events WHERE instance=$1 ORDER BY id DESC LIMIT 1', [instance])).rows[0];
        previous = row?.current_state ?? null;
        loaded = true;
      }
      const status = await checkWhatsApp(pool);
      const current = status.apiStatus + '/' + status.connectionState;
      if (current !== previous) {
        await pool.query('INSERT INTO guardian_events(instance,previous_state,current_state,checked_at,last_incoming_at) VALUES($1,$2,$3,$4,$5)', [instance,previous,current,status.checkedAt,status.lastIncomingAt]);
        console.info('[Guardian]', JSON.stringify({ event: 'state_changed', previous: previous || null,
          current, checkedAt: status.checkedAt, lastIncomingAt: status.lastIncomingAt }));
        previous = current;
      }
      const webhook = status.apiStatus === 'reachable' ? await checkWebhook() : 'not_checked';
      if (webhook !== previousWebhook) {
        console.info('[Guardian]', JSON.stringify({ event: 'webhook_diagnostic', previous: previousWebhook, current: webhook, checkedAt: new Date().toISOString() }));
        previousWebhook = webhook;
      }
      if (failed) console.info('[Guardian] Monitoramento restabelecido.');
      failed = false;
    } catch {
      if (!failed) {
        console.error('[Guardian]', JSON.stringify({ event: 'check_failed', checkedAt: new Date().toISOString() }));
        failed = true;
      }
    } finally {
      if (!stopped) timer = setTimeout(run, 30000);
    }
  }
  function run() { if (!stopped) pending = tick(); }
  run();
  return async () => { stopped = true; clearTimeout(timer); await pending; };
}
