const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const aiResponder = require('../services/aiResponder');
const evolution = require('../providers/evolution');
const storage = require('../services/storage');
const { isOptOut } = require('../services/safety');

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
    } else if (event === 'messages.update') {
      await handleMessageUpdate(req.app, inst, req.body);
    } else if (event === 'messages.delete') {
      await handleMessageDelete(req.app, inst, req.body);
    } else if (event === 'connection.update' || event === 'qrcode.updated') {
      await handleConnectionUpdate(inst, req.body);
    } else {
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
    // Lê default_conversation_ai da caixa (por instance)
    const { rows: cfg } = await pool.query(
      'SELECT COALESCE(default_conversation_ai, TRUE) AS def FROM ai_configs WHERE instance_id=$1',
      [inst.id]
    );
    const defaultAi = cfg.length ? !!cfg[0].def : true;
    const { rows: ins } = await pool.query(
      `INSERT INTO conversations (company_id, instance_id, contact_id, status, ai_enabled)
       VALUES ($1,$2,$3,'open',$4) RETURNING id`,
      [inst.company_id, inst.id, contactId, defaultAi]
    );
    convId = ins[0].id;
  }

  // Extrai conteudo da mensagem
  const m = data.message || data;
  let type = 'text';
  let body = m?.conversation || m?.extendedTextMessage?.text || '';
  let mediaUrl = null, mediaMime = null, mediaFilename = null;

  // ── Reaction recebida ─────────────────────────────────────────────
  // m.reactionMessage = { key: {id, fromMe, remoteJid}, text: '👍' }
  if (m?.reactionMessage) {
    const targetProviderId = m.reactionMessage?.key?.id;
    const emoji = m.reactionMessage?.text || '';
    if (targetProviderId) {
      const { rows: tgt } = await pool.query(
        'SELECT id FROM messages WHERE provider_msg_id=$1', [targetProviderId]
      );
      if (tgt.length) {
        if (!emoji) {
          await pool.query(
            `DELETE FROM message_reactions WHERE message_id=$1 AND by_type='contact'`,
            [tgt[0].id]
          );
        } else {
          await pool.query(
            `INSERT INTO message_reactions (message_id, emoji, by_type) VALUES ($1,$2,'contact')
             ON CONFLICT (message_id, by_type, by_user_id) DO UPDATE SET emoji=EXCLUDED.emoji, created_at=NOW()`,
            [tgt[0].id, emoji]
          );
        }
        const io = app.get('io');
        io?.to(`conv:${convId}`).emit('message:reaction', { messageId: tgt[0].id });
      }
    }
    return; // reaction nao gera nova msg
  }

  // ── Mensagem editada pelo contato ──────────────────────────────────
  // editedMessage / protocolMessage.editedMessage
  const editedInner = m?.editedMessage?.message || m?.protocolMessage?.editedMessage;
  const editedKey = m?.editedMessage?.key || m?.protocolMessage?.key;
  if (editedInner && editedKey?.id) {
    const newText = editedInner?.conversation || editedInner?.extendedTextMessage?.text || '';
    const { rows: tgt } = await pool.query(
      'SELECT id, conversation_id FROM messages WHERE provider_msg_id=$1', [editedKey.id]
    );
    if (tgt.length && newText) {
      await pool.query('UPDATE messages SET body=$1, edited_at=NOW() WHERE id=$2', [newText, tgt[0].id]);
      const io = app.get('io');
      io?.to(`conv:${tgt[0].conversation_id}`).emit('message:edited', { messageId: tgt[0].id });
    }
    return;
  }

  // ── Mensagem revogada (protocolMessage type=REVOKE) ────────────────
  if (m?.protocolMessage?.type === 0 || m?.protocolMessage?.type === 'REVOKE') {
    const revokeKey = m.protocolMessage?.key;
    if (revokeKey?.id) {
      const { rows: tgt } = await pool.query(
        'SELECT id, conversation_id FROM messages WHERE provider_msg_id=$1', [revokeKey.id]
      );
      if (tgt.length) {
        await pool.query(`UPDATE messages SET deleted_at=NOW(), body='[mensagem apagada]' WHERE id=$1`, [tgt[0].id]);
        const io = app.get('io');
        io?.to(`conv:${tgt[0].conversation_id}`).emit('message:deleted', { messageId: tgt[0].id });
      }
    }
    return;
  }

  if (m?.imageMessage)    { type = 'image';    body = m.imageMessage.caption || ''; mediaMime = m.imageMessage.mimetype; }
  else if (m?.audioMessage){ type = 'audio'; mediaMime = m.audioMessage.mimetype; }
  else if (m?.videoMessage){ type = 'video'; body = m.videoMessage.caption || ''; mediaMime = m.videoMessage.mimetype; }
  else if (m?.documentMessage){ type = 'document'; mediaFilename = m.documentMessage.fileName; mediaMime = m.documentMessage.mimetype; }
  else if (m?.stickerMessage){ type = 'sticker'; mediaMime = m.stickerMessage?.mimetype || 'image/webp'; }
  const isMedia = ['image', 'audio', 'video', 'document', 'sticker'].includes(type);

  // ── Quoted message (reply) ─────────────────────────────────────────
  // Vem em contextInfo.quotedMessage + contextInfo.stanzaId (id da msg citada)
  const ctx = m?.extendedTextMessage?.contextInfo
           || m?.imageMessage?.contextInfo
           || m?.videoMessage?.contextInfo
           || m?.documentMessage?.contextInfo
           || m?.audioMessage?.contextInfo;
  let quotedSnap = {};
  if (ctx?.quotedMessage && ctx?.stanzaId) {
    const qm = ctx.quotedMessage;
    let qText = qm.conversation || qm.extendedTextMessage?.text
             || qm.imageMessage?.caption || qm.videoMessage?.caption || '';
    let qType = 'text';
    if (qm.imageMessage) qType = 'image';
    else if (qm.audioMessage) qType = 'audio';
    else if (qm.videoMessage) qType = 'video';
    else if (qm.documentMessage) qType = 'document';
    if (!qText && qType !== 'text') qText = `[${qType}]`;
    const { rows: qRow } = await pool.query(
      'SELECT id, from_me FROM messages WHERE provider_msg_id=$1', [ctx.stanzaId]
    );
    quotedSnap = {
      quoted_msg_id: qRow[0]?.id || null,
      quoted_body: qText.slice(0, 500),
      quoted_from_me: qRow[0]?.from_me ?? !!ctx.participant,
      quoted_type: qType,
      quoted_provider_msg_id: ctx.stanzaId,
    };
  }

  // Insere mensagem (dedup pelo provider_msg_id)
  const providerMsgId = key.id || data.id || null;
  let insertedRow = null;
  try {
    const { rows } = await pool.query(`
      INSERT INTO messages
        (conversation_id, provider_msg_id, from_me, author_type, type, body,
         media_url, media_mime, media_filename, raw,
         quoted_msg_id, quoted_body, quoted_from_me, quoted_type, quoted_provider_msg_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      ON CONFLICT (provider_msg_id) DO NOTHING
      RETURNING *
    `, [convId, providerMsgId, fromMe, fromMe ? 'agent' : 'contact',
        type, body, mediaUrl, mediaMime, mediaFilename, payload,
        quotedSnap.quoted_msg_id || null, quotedSnap.quoted_body || null,
        quotedSnap.quoted_from_me ?? null, quotedSnap.quoted_type || null,
        quotedSnap.quoted_provider_msg_id || null]);
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

    // Mídia: Evolution v2 ja manda base64 inline (config base64:true no webhook).
    // Pega direto do payload — fallback pra getBase64FromMediaMessage se nao vier.
    if (isMedia && await storage.hasS3().catch(() => false)) {
      setImmediate(async () => {
        try {
          // Evolution coloca em data.message.base64 (m.base64)
          let b64 = m?.base64 || data?.message?.base64 || null;
          if (!b64) {
            console.log('[media] base64 nao veio inline, tentando getBase64FromMediaMessage');
            b64 = await evolution.getMessageMediaBase64(inst.instance_name, data);
          }
          if (!b64) { console.warn('[media→s3] sem base64'); return; }
          const buf = Buffer.from(b64, 'base64');
          const ext = (mediaMime?.split('/')[1] || 'bin').split(';')[0];
          const fname = mediaFilename || `${type}-${insertedRow.id}.${ext}`;
          const up = await storage.uploadBuffer({
            companyId: inst.company_id,
            buffer: buf, mimetype: mediaMime || 'application/octet-stream',
            filename: fname, folder: 'inbound',
          });
          await pool.query('UPDATE messages SET media_url=$1 WHERE id=$2', [up.url, insertedRow.id]);
          console.log('[media→s3] ok msg', insertedRow.id, '→', up.url);
          io?.to(`conv:${convId}`).emit('message:new', { conversationId: convId });
        } catch (e) { console.warn('[media→s3] falhou:', e.message); }
      });
    }

    // Mensagem de contato (não nossa)
    if (!fromMe) {
      // 1) Marca como lida no WhatsApp (comportamento humano + reduz banner "lido")
      setImmediate(() => {
        evolution.markAsRead(inst.instance_name, [{
          remoteJid, fromMe: false, id: providerMsgId,
        }]).catch(() => {});
      });

      // 2) Detecta opt-out — pausa IA na conversation pra sempre
      try {
        const { rows: cfg } = await pool.query(
          'SELECT opt_out_keywords FROM ai_configs WHERE instance_id=$1',
          [inst.id]
        );
        const kw = cfg[0]?.opt_out_keywords || '';
        if (body && isOptOut(body, kw)) {
          await pool.query('UPDATE conversations SET opted_out=TRUE, ai_enabled=FALSE WHERE id=$1', [convId]);
          console.log(`[opt-out] detected on conv ${convId}`);
          io?.to(`company:${inst.company_id}`).emit('conversation:update', { conversationId: convId });
        }
      } catch (e) { console.warn('[opt-out check] erro:', e.message); }

      // 3) Tenta resposta da IA
      setImmediate(() => {
        aiResponder.maybeRespond({ conversationId: convId, app })
          .then((r) => { if (r?.skipped) console.log('[AI] skipped:', r.skipped); else if (r?.ok) console.log('[AI] responded', r.chunks, 'chunk(s)'); })
          .catch((e) => console.error('[AI] error:', e.message));
      });
    }
  }
}

// ── Update de status (delivered / read) ──────────────────────────────
// Evolution emite messages.update com { key, status: 'DELIVERY_ACK' | 'READ' | ... }
async function handleMessageUpdate(app, inst, payload) {
  const updates = Array.isArray(payload?.data) ? payload.data : [payload?.data].filter(Boolean);
  for (const u of updates) {
    try {
      const msgId = u?.key?.id || u?.keyId || u?.messageId;
      const status = (u?.status || u?.update?.status || '').toString().toUpperCase();
      if (!msgId || !status) continue;
      // Mapeia status WhatsApp → nosso
      let dbStatus = null;
      let setField = null;
      if (status === 'DELIVERY_ACK' || status === 'SERVER_ACK' || status === 'DELIVERED') {
        dbStatus = 'delivered'; setField = 'delivered_at';
      } else if (status === 'READ' || status === 'PLAYED') {
        dbStatus = 'read'; setField = 'read_at';
      }
      if (!dbStatus) continue;
      // Atualiza só se for upgrade de status (não regredir de 'read' pra 'delivered')
      const order = { pending: 0, sent: 1, delivered: 2, read: 3 };
      const { rows } = await pool.query(
        `UPDATE messages SET status=$1, ${setField}=COALESCE(${setField}, NOW())
         WHERE provider_msg_id=$2 AND from_me=TRUE
           AND COALESCE($3, 0) > COALESCE((CASE status
             WHEN 'pending' THEN 0 WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3
             ELSE 1 END), 1)
         RETURNING id, conversation_id`,
        [dbStatus, msgId, order[dbStatus]]
      );
      if (rows.length) {
        const io = app.get('io');
        io?.to(`conv:${rows[0].conversation_id}`).emit('message:status', {
          messageId: rows[0].id, status: dbStatus,
        });
      }
    } catch (e) { console.warn('[webhook update]', e.message); }
  }
}

async function handleMessageDelete(app, inst, payload) {
  const list = Array.isArray(payload?.data) ? payload.data : [payload?.data].filter(Boolean);
  for (const d of list) {
    try {
      const msgId = d?.key?.id || d?.keyId;
      if (!msgId) continue;
      const { rows } = await pool.query(
        `UPDATE messages SET deleted_at=NOW(), body='[mensagem apagada]'
         WHERE provider_msg_id=$1 RETURNING id, conversation_id`,
        [msgId]
      );
      if (rows.length) {
        const io = app.get('io');
        io?.to(`conv:${rows[0].conversation_id}`).emit('message:deleted', { messageId: rows[0].id });
      }
    } catch (e) { console.warn('[webhook delete]', e.message); }
  }
}

module.exports = router;
