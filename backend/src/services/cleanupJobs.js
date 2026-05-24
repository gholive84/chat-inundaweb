// Higienização periódica do banco
// Roda no boot + a cada 6h
const { pool } = require('../config/database');

const RAW_TTL_DAYS = 30;        // Zera o campo `raw` (JSONB) das msgs mais velhas
const TICK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h

let intervalHandle = null;

async function purgeRawColumn() {
  try {
    const { rowCount } = await pool.query(
      `UPDATE messages SET raw=NULL
       WHERE raw IS NOT NULL AND created_at < NOW() - INTERVAL '${RAW_TTL_DAYS} days'`
    );
    if (rowCount > 0) console.log(`[cleanup] zerou raw em ${rowCount} msgs > ${RAW_TTL_DAYS}d`);
  } catch (e) { console.warn('[cleanup raw]', e.message); }
}

async function hardDeleteOldMessages() {
  // Por empresa: se message_retention_months > 0, apaga msgs mais velhas
  try {
    const { rows: comps } = await pool.query(
      `SELECT id, message_retention_months FROM companies WHERE COALESCE(message_retention_months, 0) > 0`
    );
    let total = 0;
    for (const c of comps) {
      // Deleta msgs cuja conversation pertence a essa company e ja passou do TTL
      const { rowCount } = await pool.query(
        `DELETE FROM messages
         WHERE id IN (
           SELECT m.id FROM messages m
           JOIN conversations cv ON cv.id = m.conversation_id
           WHERE cv.company_id = $1
             AND m.created_at < NOW() - ($2 || ' months')::interval
           LIMIT 50000
         )`,
        [c.id, c.message_retention_months]
      );
      if (rowCount > 0) {
        total += rowCount;
        console.log(`[cleanup] hard delete ${rowCount} msgs > ${c.message_retention_months}m da company ${c.id}`);
      }
    }
    if (total > 0) console.log(`[cleanup] total hard delete: ${total} msgs`);
  } catch (e) { console.warn('[cleanup delete]', e.message); }
}

async function tick() {
  await purgeRawColumn();
  await hardDeleteOldMessages();
}

function start() {
  if (intervalHandle) return;
  // Primeira execucao em 2 min (deixa boot completar tudo)
  setTimeout(tick, 2 * 60 * 1000);
  intervalHandle = setInterval(tick, TICK_INTERVAL_MS);
  console.log('🧹 Cleanup worker iniciado (raw TTL: 30d, hard delete por empresa via message_retention_months)');
}

module.exports = { start, tick };
