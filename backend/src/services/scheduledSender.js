// Worker: a cada 30s pega scheduled_messages com scheduled_for <= now e dispara
const { pool } = require('../config/database');
const evolution = require('../providers/evolution');

let running = false;
let intervalHandle = null;

async function tick(app) {
  if (running) return;
  running = true;
  try {
    const { rows } = await pool.query(`
      SELECT s.id, s.body, s.contact_id, s.instance_id, s.company_id,
             s.media_url, s.media_mime, s.media_filename, s.media_type,
             ct.phone, i.instance_name, co.sign_messages, co.signature_format,
             u.name AS author_name
      FROM scheduled_messages s
      JOIN contacts ct ON ct.id = s.contact_id
      JOIN whatsapp_instances i ON i.id = s.instance_id
      JOIN companies co ON co.id = s.company_id
      LEFT JOIN users u ON u.id = s.created_by
      WHERE s.status = 'pending' AND s.scheduled_for <= NOW()
      ORDER BY s.scheduled_for ASC
      LIMIT 20
    `);
    for (const m of rows) {
      let body = m.body || '';
      if (m.sign_messages && m.author_name && body) {
        const fmt = m.signature_format || 'bold';
        const sig = fmt === 'brackets' ? `[${m.author_name}]` : fmt === 'plain' ? `${m.author_name}:` : `*${m.author_name}*`;
        body = `${sig}\n${body}`;
      }
      try {
        let sent;
        if (m.media_url) {
          // Tem mídia: envia como image/document/etc com caption
          sent = await evolution.sendMedia(m.instance_name, m.phone, {
            kind: m.media_type || 'document',
            base64: m.media_url, // URL passa direto, Evolution suporta ambos
            mimetype: m.media_mime || 'application/octet-stream',
            fileName: m.media_filename || 'arquivo',
            caption: body,
          });
        } else {
          sent = await evolution.sendText(m.instance_name, m.phone, body);
        }
        const { rows: conv } = await pool.query(
          'SELECT id FROM conversations WHERE instance_id=$1 AND contact_id=$2 LIMIT 1',
          [m.instance_id, m.contact_id]
        );
        let convId;
        if (conv.length) convId = conv[0].id;
        else {
          const { rows: ins } = await pool.query(`
            INSERT INTO conversations (company_id, instance_id, contact_id, status, ai_enabled)
            VALUES ($1,$2,$3,'open',FALSE) RETURNING id`,
            [m.company_id, m.instance_id, m.contact_id]
          );
          convId = ins[0].id;
        }
        const msgType = m.media_type || 'text';
        await pool.query(`
          INSERT INTO messages (conversation_id, from_me, author_type, type, body, media_url, media_mime, media_filename, status, provider_msg_id)
          VALUES ($1, TRUE, 'agent', $2, $3, $4, $5, $6, 'sent', $7)
        `, [convId, msgType, body, m.media_url, m.media_mime, m.media_filename, sent?.id || null]);
        const preview = (body || `[${msgType}]`).slice(0, 200);
        await pool.query(`
          UPDATE conversations SET last_message_at=NOW(), last_message_preview=$1, ai_paused_until=NOW() + INTERVAL '10 minutes'
          WHERE id=$2
        `, [preview, convId]);
        await pool.query(
          'UPDATE scheduled_messages SET status=$1, sent_at=NOW() WHERE id=$2',
          ['sent', m.id]
        );
        console.log('[scheduled] enviado msg', m.id);

        const io = app?.get?.('io');
        io?.to(`conv:${convId}`).emit('message:new', { conversationId: convId });
        io?.to(`company:${m.company_id}`).emit('conversation:update', { conversationId: convId });
      } catch (e) {
        console.error('[scheduled] falha msg', m.id, e.message);
        await pool.query(
          'UPDATE scheduled_messages SET status=$1, error=$2 WHERE id=$3',
          ['failed', String(e.message).slice(0, 500), m.id]
        );
      }
    }
  } catch (err) {
    console.error('[scheduled] tick erro', err.message);
  } finally { running = false; }
}

function start(app) {
  if (intervalHandle) return;
  // primeira execucao em 10s, depois a cada 30s
  setTimeout(() => tick(app), 10000);
  intervalHandle = setInterval(() => tick(app), 30000);
  console.log('🕐 Scheduled messages worker iniciado');
}

module.exports = { start };
