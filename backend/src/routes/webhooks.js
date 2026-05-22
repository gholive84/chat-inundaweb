const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const aiResponder = require('../services/aiResponder');
const evolution = require('../providers/evolution');

// Webhook do Evolution — endpoint publico, mas valida instance_name + token
// Evolution chama POST /api/webhooks/evolution/{instance}/{token}
router.post('/evolution/:instance/:token', async (req, res) => {
  try {
    const { instance, token } = req.params;
    const { rows } = await pool.query(
      `SELECT id, company_id FROM whatsapp_instances
       WHERE instance_name=$1 AND webhook_token=$2`,
      [instance, token]
    );
    if (!rows.length) {
      console.warn('[webhook] instance/token nao encontrado', instance);
      return res.status(401).json({ error: 'unauthorized' });
    }
    const inst = rows[0];

    const event = req.body?.event || req.body?.type || 'unknown';
    await pool.query('UPDATE whatsapp_instances SET last_event_at=NOW() WHERE id=$1', [inst.id]);

    // Dispatch por tipo de evento
    if (event === 'messages.upsert' || event === 'message') {
      await handleIncomingMessage(req.app, inst, req.body);
    } else if (event === 'connection.update' || event === 'qrcode.updated') {
      await handleConnectionUpdate(inst, req.body);
    } else {
      // log e segue
      console.log('[webhook] evento ignorado', event);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('POST /webhooks/evolution', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

async function handleConnectionUpdate(inst, payload) {
  const status = payload?.data?.state || payload?.state || payload?.status;
  const qr = payload?.data?.qrcode?.base64 || payload?.qrcode || null;
  if (status) {
    const mapped = ({ open: 'connected', connecting: 'connecting', close: 'disconnected' })[status] || status;
    await pool.query('UPDATE whatsapp_instances SET status=$1, qr_code=$2 WHERE id=$3',
      [mapped, qr, inst.id]);
  } else if (qr) {
    await pool.query('UPDATE whatsapp_instances SET qr_code=$1 WHERE id=$2', [qr, inst.id]);
  }
}

async function handleIncomingMessage(app, inst, payload) {
  // Evolution v2 envia: { event, instance, data: { key, message, pushName, ... } }
  const data = payload?.data || payload?.message;
  if (!data) return;

  const key = data.key || data;
  const remoteJid = key.remoteJid || data.from;
  const fromMe = !!key.fromMe;
  if (!remoteJid) return;

  // Ignora grupos por enquanto (terminam com @g.us)
  if (remoteJid.endsWith('@g.us')) return;
  const phone = remoteJid.replace(/@s\.whatsapp\.net$/, '');
  const pushName = data.pushName || null;

  // Encontra ou cria contact
  let contactId;
  const { rows: ex } = await pool.query(
    'SELECT id, profile_pic_url FROM contacts WHERE company_id=$1 AND phone=$2',
    [inst.company_id, phone]
  );
  let needsPicFetch = false;
  if (ex.length) {
    contactId = ex[0].id;
    if (!ex[0].profile_pic_url) needsPicFetch = true;
  } else {
    const { rows: ins } = await pool.query(
      `INSERT INTO contacts (company_id, phone, push_name) VALUES ($1,$2,$3) RETURNING id`,
      [inst.company_id, phone, pushName]
    );
    contactId = ins[0].id;
    needsPicFetch = true;
  }
  // Fetch profile pic async (não bloqueia o webhook)
  if (needsPicFetch && !fromMe) {
    setImmediate(async () => {
      try {
        const picUrl = await evolution.fetchProfilePicture(inst.instance_name, phone);
        if (picUrl) {
          await pool.query('UPDATE contacts SET profile_pic_url=$1 WHERE id=$2', [picUrl, contactId]);
        }
      } catch (e) { console.warn('[pic] fetch falhou', e.message); }
    });
  }

  // Encontra ou cria conversation
  let convId;
  const { rows: cv } = await pool.query(
    'SELECT id FROM conversations WHERE instance_id=$1 AND contact_id=$2',
    [inst.id, contactId]
  );
  if (cv.length) convId = cv[0].id;
  else {
    const { rows: ins } = await pool.query(
      `INSERT INTO conversations (company_id, instance_id, contact_id, status, ai_enabled)
       VALUES ($1,$2,$3,'open',TRUE) RETURNING id`,
      [inst.company_id, inst.id, contactId]
    );
    convId = ins[0].id;
  }

  // Extrai conteudo da mensagem
  const m = data.message || data;
  let type = 'text';
  let body = m?.conversation || m?.extendedTextMessage?.text || '';
  let mediaUrl = null, mediaMime = null, mediaFilename = null;

  if (m?.imageMessage)    { type = 'image';    body = m.imageMessage.caption || ''; mediaMime = m.imageMessage.mimetype; }
  else if (m?.audioMessage){ type = 'audio'; mediaMime = m.audioMessage.mimetype; }
  else if (m?.videoMessage){ type = 'video'; body = m.videoMessage.caption || ''; mediaMime = m.videoMessage.mimetype; }
  else if (m?.documentMessage){ type = 'document'; mediaFilename = m.documentMessage.fileName; mediaMime = m.documentMessage.mimetype; }
  else if (m?.stickerMessage){ type = 'sticker'; }

  // Insere mensagem (dedup pelo provider_msg_id)
  const providerMsgId = key.id || data.id || null;
  let insertedRow = null;
  try {
    const { rows } = await pool.query(`
      INSERT INTO messages
        (conversation_id, provider_msg_id, from_me, author_type, type, body, media_url, media_mime, media_filename, raw)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (provider_msg_id) DO NOTHING
      RETURNING *
    `, [convId, providerMsgId, fromMe, fromMe ? 'agent' : 'contact',
        type, body, mediaUrl, mediaMime, mediaFilename, payload]);
    insertedRow = rows[0];
  } catch (e) { console.error('insert message', e.message); }

  // Atualiza conversation
  if (insertedRow) {
    await pool.query(`
      UPDATE conversations SET
        last_message_at = NOW(),
        last_message_preview = $1,
        unread_count = CASE WHEN $2 THEN unread_count ELSE unread_count + 1 END
      WHERE id=$3
    `, [(body || `[${type}]`).slice(0, 200), fromMe, convId]);

    const io = app.get('io');
    io?.to(`conv:${convId}`).emit('message:new', { conversationId: convId, message: insertedRow });
    io?.to(`company:${inst.company_id}`).emit('conversation:update', { conversationId: convId });

    // Mensagem de contato (não nossa) → tenta resposta da IA (assincrono, fire-and-forget)
    if (!fromMe) {
      setImmediate(() => {
        aiResponder.maybeRespond({ conversationId: convId, app })
          .then((r) => { if (r?.skipped) console.log('[AI] skipped:', r.skipped); else if (r?.ok) console.log('[AI] responded msg', r.msgId); })
          .catch((e) => console.error('[AI] error:', e.message));
      });
    }
  }
}

module.exports = router;
