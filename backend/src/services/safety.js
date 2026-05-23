// Utilidades de seguranca pra evitar comportamentos suspeitos
function jitter(ms, pct = 0.25) {
  const variance = ms * pct;
  return ms + (Math.random() * 2 - 1) * variance;
}

function isWithinBusinessHours({ enabled, start, end, timezone }) {
  if (!enabled) return true;
  try {
    const now = new Date();
    // Pega "hh:mm" no timezone configurado
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || 'America/Sao_Paulo',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
    const parts = fmt.formatToParts(now);
    const h = parseInt(parts.find((p) => p.type === 'hour')?.value || '0');
    const m = parseInt(parts.find((p) => p.type === 'minute')?.value || '0');
    const cur = h * 60 + m;
    const [hs, ms] = (start || '00:00').split(':').map(Number);
    const [he, me] = (end || '23:59').split(':').map(Number);
    const startMin = hs * 60 + ms;
    const endMin = he * 60 + me;
    if (startMin <= endMin) return cur >= startMin && cur <= endMin;
    // Horario que cruza meia-noite (ex: 22:00 → 06:00)
    return cur >= startMin || cur <= endMin;
  } catch { return true; }
}

function normalizeStr(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Detecta se a msg do contato contem palavra de opt-out.
 * Match contra lista CSV vinda da config.
 */
function isOptOut(messageBody, keywordsCsv) {
  if (!messageBody) return false;
  const text = normalizeStr(messageBody);
  const keywords = (keywordsCsv || '').split(',').map((k) => normalizeStr(k.trim())).filter(Boolean);
  return keywords.some((k) => text.includes(k));
}

module.exports = { jitter, isWithinBusinessHours, isOptOut };
