import type pg from 'pg';

// Read-only, bounded diagnostic. Never import provider history.
export async function reconcileMessages(pool: pg.Pool, since: number) {
  const instance = process.env.EVOLUTION_INSTANCE || 'central-teste';
  const url = process.env.EVOLUTION_API_URL;
  const key = process.env.EVOLUTION_API_KEY;
  if (!url || !key) throw new Error('not_configured');
  const now = Math.floor(Date.now() / 1000);
  const lower = Math.max(since, now - 86400);
  const candidates = new Set<string>();
  let scanned = 0, ignored = 0, covered = false;
  for (let page = 1; page <= 3; page++) {
    const response = await fetch(url.replace(/\/$/, '') + '/chat/findMessages/' + encodeURIComponent(instance), {
      method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ where: { key: { fromMe: false } }, offset: 100, page }),
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) throw new Error('provider_http_error');
    const data = await response.json();
    const records = data?.messages?.records;
    if (!Array.isArray(records) || records.length > 100) throw new Error('invalid_page');
    let older = false;
    for (const record of records) {
      scanned++;
      const t = Number(record?.messageTimestamp);
      if (Number.isFinite(t) && t < lower) older = true;
      const k = record?.key;
      const body = record?.message?.conversation ?? record?.message?.extendedTextMessage?.text;
      const jid = [k?.remoteJid, k?.remoteJidAlt].find(j => typeof j === 'string' && /^[1-9][0-9]{7,14}@s\.whatsapp\.net$/.test(j));
      if (!Number.isInteger(t) || t < lower || t > now - 120 ||
          k?.fromMe !== false || typeof k?.id !== 'string' || !k.id || k.id.length > 256 ||
          typeof k.remoteJid !== 'string' || !jid ||
          !/@(?:s\.whatsapp\.net|lid)$/.test(k.remoteJid) ||
          !['conversation', 'extendedTextMessage'].includes(record?.messageType) ||
          typeof body !== 'string' || !body || body.length > 16000) { ignored++; continue; }
      candidates.add(k.id);
    }
    if (records.length < 100 || older) { covered = true; break; }
  }
  const ids = [...candidates];
  const existing = ids.length ? await pool.query(
    'SELECT provider_message_id FROM whatsapp_messages WHERE instance=$1 AND provider_message_id=ANY($2::text[])',
    [instance, ids]) : { rows: [] };
  const found = new Set(existing.rows.map(r => r.provider_message_id));
  return { scanned, ignored, eligible: ids.length, matched: ids.filter(id => found.has(id)).length,
    missing: ids.filter(id => !found.has(id)).length, coverage: covered ? 'observed_window' : 'page_limit',
    since: new Date(lower * 1000).toISOString() };
}
