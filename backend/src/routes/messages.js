const express = require('express');
const router = express.Router();
const multer = require('multer');
const { pool } = require('../config/database');
const { authCompany } = require('../middleware/auth');
const evolution = require('../providers/evolution');
const storage = require('../services/storage');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

function detectKind(mime) {
  if (!mime) return 'document';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'document';
}

// Lista mensagens de uma conversa (com reactions agregadas)
router.get('/:conversationId', authCompany, async (req, res) => {
  try {
    const { rows: conv } = await pool.query(
      'SELECT id FROM conversations WHERE id=$1 AND company_id=$2',
      [req.params.conversationId, req.user.companyId]
    );
    if (!conv.length) return res.status(404).json({ error: 'Conversa não encontrada' });

    const { rows } = await pool.query(`
      SELECT m.*, u.name AS author_name, u.avatar_url AS author_avatar_url,
        COALESCE((
          SELECT json_agg(json_build_object(
            'emoji', r.emoji, 'by_type', r.by_type, 'by_user_id', r.by_user_id, 'by_user_name', ru.name
          ))
          FROM message_reactions r LEFT JOIN users ru ON ru.id = r.by_user_id
          WHERE r.message_id = m.id
        ), '[]'::json) AS reactions
      FROM messages m
      LEFT JOIN users u ON u.id = m.author_user_id
      WHERE m.conversation_id=$1
      ORDER BY m.created_at ASC
      LIMIT 500
    `, [req.params.conversationId]);
    res.json(rows);
  } catch (err) {
    console.error('GET /messages/:id', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// Busca dentro da conversa — retorna IDs e snippets pra navegar
router.get('/:conversationId/search', authCompany, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || !q.trim()) return res.json([]);
    const { rows: conv } = await pool.query(
      'SELECT id FROM conversations WHERE id=$1 AND company_id=$2',
      [req.params.conversationId, req.user.companyId]
    );
    if (!conv.length) return res.status(404).json({ error: 'Conversa não encontrada' });
    const { rows } = await pool.query(
      `SELECT id, body, from_me, type, created_at
       FROM messages
       WHERE conversation_id=$1 AND deleted_at IS NULL AND body ILIKE $2
       ORDER BY created_at ASC LIMIT 200`,
      [req.params.conversationId, `%${q}%`]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Erro interno' }); }
});

// Helper: monta snapshot de quote a partir do quoted_msg_id
async function buildQuoteSnapshot(quotedMsgId, conversationId) {
  if (!quotedMsgId) return {};
  const { rows } = await pool.query(
    `SELECT id, body, from_me, type, provider_msg_id, media_filename
     FROM messages WHERE id=$1 AND conversation_id=$2`,
    [quotedMsgId, conversationId]
  );
  if (!rows.length) return {};
  const m = rows[0];
  let preview = m.body || '';
  if (!preview && m.type !== 'text') preview = `[${m.type}${m.media_filename ? ' ' + m.media_filename : ''}]`;
  return {
    quoted_msg_id: m.id,
    quoted_body: preview.slice(0, 500),
    quoted_from_me: m.from_me,
    quoted_type: m.type,
    quoted_provider_msg_id: m.provider_msg_id,
  };
}

// Enviar mensagem (agent → contact via provider) — com optional reply_to
router.post('/:conversationId', authCompany, async (req, res) => {
  try {
    const { body, type = 'text', reply_to } = req.body;
    if (!body?.trim()) return res.status(400).json({ error: 'Conteúdo vazio' });

    const { rows: conv } = await pool.query(`
      SELECT c.id, c.contact_id, ct.phone, i.instance_name,
             co.sign_messages, co.signature_format
      FROM conversations c
      JOIN contacts ct ON ct.id = c.contact_id
      JOIN whatsapp_instances i ON i.id = c.instance_id
      JOIN companies co ON co.id = c.company_id
      WHERE c.id=$1 AND c.company_id=$2
    `, [req.params.conversationId, req.user.companyId]);
    if (!conv.length) return res.status(404).json({ error: 'Conversa não encontrada' });
    const c = conv[0];

    let bodyToSend = body;
    if (c.sign_messages) {
      const agentName = req.user.name || 'Atendente';
      let signature;
      if (c.signature_format === 'brackets') signature = `[${agentName}]`;
      else if (c.signature_format === 'plain') signature = `${agentName}:`;
      else signature = `*${agentName}*`;
      bodyToSend = `${signature}\n${body}`;
    }

    // Quote snapshot
    const q = await buildQuoteSnapshot(reply_to, c.id);

    const { rows: ins } = await pool.query(`
      INSERT INTO messages
        (conversation_id, from_me, author_type, author_user_id, type, body, status,
         quoted_msg_id, quoted_body, quoted_from_me, quoted_type, quoted_provider_msg_id)
      VALUES ($1, TRUE, 'agent', $2, $3, $4, 'pending', $5, $6, $7, $8, $9) RETURNING id
    `, [c.id, req.user.id, type, bodyToSend,
        q.quoted_msg_id || null, q.quoted_body || null, q.quoted_from_me ?? null,
        q.quoted_type || null, q.quoted_provider_msg_id || null]);
    const msgId = ins[0].id;

    await pool.query(
      `UPDATE conversations SET ai_paused_until = NOW() + INTERVAL '10 minutes',
                                last_message_at = NOW(),
                                last_message_preview = $1,
                                assigned_to_user_id = COALESCE(assigned_to_user_id, $2)
       WHERE id=$3`,
      [bodyToSend.slice(0, 200), req.user.id, c.id]
    );

    try {
      const sent = await evolution.sendText(c.instance_name, c.phone, bodyToSend, {
        quoted: q.quoted_provider_msg_id ? {
          id: q.quoted_provider_msg_id, fromMe: !!q.quoted_from_me, body: q.quoted_body,
        } : null,
      });
      await pool.query(
        'UPDATE messages SET status=$1, provider_msg_id=$2 WHERE id=$3',
        ['sent', sent?.id || null, msgId]
      );
    } catch (e) {
      await pool.query(
        'UPDATE messages SET status=$1, error=$2 WHERE id=$3',
        ['failed', e.message?.slice(0, 500) || 'send failed', msgId]
      );
      return res.status(502).json({ error: 'Falha ao enviar pro WhatsApp', detail: e.message });
    }

    const io = req.app.get('io');
    io?.to(`conv:${c.id}`).emit('message:new', { conversationId: c.id });
    io?.to(`company:${req.user.companyId}`).emit('conversation:update', { conversationId: c.id });

    const { rows: msg } = await pool.query('SELECT * FROM messages WHERE id=$1', [msgId]);
    res.status(201).json(msg[0]);
  } catch (err) {
    console.error('POST /messages/:id', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// Enviar arquivo (imagem/video/audio/documento)
router.post('/:conversationId/media', authCompany, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Arquivo obrigatório' });
    const caption = req.body?.caption || '';

    const { rows: conv } = await pool.query(`
      SELECT c.id, c.contact_id, ct.phone, i.instance_name
      FROM conversations c
      JOIN contacts ct ON ct.id = c.contact_id
      JOIN whatsapp_instances i ON i.id = c.instance_id
      WHERE c.id=$1 AND c.company_id=$2
    `, [req.params.conversationId, req.user.companyId]);
    if (!conv.length) return res.status(404).json({ error: 'Conversa não encontrada' });
    const c = conv[0];

    const kind = detectKind(req.file.mimetype);

    let mediaUrl = null;
    let mediaPayload;
    if (await storage.hasS3()) {
      try {
        const up = await storage.uploadBuffer({
          companyId: req.user.companyId,
          buffer: req.file.buffer,
          mimetype: req.file.mimetype,
          filename: req.file.originalname,
          folder: 'outbound',
        });
        mediaUrl = up.url;
        mediaPayload = up.url;
      } catch (e) {
        console.warn('[s3] upload falhou, fallback pra base64:', e.message);
        mediaPayload = req.file.buffer.toString('base64');
      }
    } else {
      mediaPayload = req.file.buffer.toString('base64');
    }

    const { rows: ins } = await pool.query(`
      INSERT INTO messages (conversation_id, from_me, author_type, author_user_id, type, body, media_url, media_mime, media_filename, status)
      VALUES ($1, TRUE, 'agent', $2, $3, $4, $5, $6, $7, 'pending') RETURNING id
    `, [c.id, req.user.id, kind, caption, mediaUrl, req.file.mimetype, req.file.originalname]);
    const msgId = ins[0].id;

    await pool.query(
      `UPDATE conversations SET ai_paused_until = NOW() + INTERVAL '10 minutes',
                                last_message_at = NOW(),
                                last_message_preview = $1,
                                assigned_to_user_id = COALESCE(assigned_to_user_id, $2)
       WHERE id=$3`,
      [`[${kind}] ${caption || req.file.originalname}`.slice(0, 200), req.user.id, c.id]
    );

    try {
      const sent = await evolution.sendMedia(c.instance_name, c.phone, {
        kind, base64: mediaPayload, mimetype: req.file.mimetype,
        fileName: req.file.originalname, caption,
      });
      await pool.query(
        'UPDATE messages SET status=$1, provider_msg_id=$2 WHERE id=$3',
        ['sent', sent?.id || null, msgId]
      );
    } catch (e) {
      await pool.query('UPDATE messages SET status=$1, error=$2 WHERE id=$3',
        ['failed', e.message?.slice(0, 500), msgId]);
      return res.status(502).json({ error: 'Falha ao enviar mídia', detail: e.message });
    }

    const io = req.app.get('io');
    io?.to(`conv:${c.id}`).emit('message:new', { conversationId: c.id });
    io?.to(`company:${req.user.companyId}`).emit('conversation:update', { conversationId: c.id });

    const { rows: msg } = await pool.query('SELECT * FROM messages WHERE id=$1', [msgId]);
    res.status(201).json(msg[0]);
  } catch (err) {
    console.error('POST /messages/:id/media', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ── Reações ─────────────────────────────────────────────────────────
// Toggle/upsert emoji por user no msg
router.post('/reactions/:msgId', authCompany, async (req, res) => {
  try {
    const { emoji } = req.body;
    if (!emoji) return res.status(400).json({ error: 'emoji obrigatório' });
    // Valida msg pertence a conversa da company
    const { rows } = await pool.query(`
      SELECT m.id, m.conversation_id, m.provider_msg_id, m.from_me,
             c.company_id, ct.phone, i.instance_name
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      JOIN contacts ct ON ct.id = c.contact_id
      JOIN whatsapp_instances i ON i.id = c.instance_id
      WHERE m.id=$1 AND c.company_id=$2
    `, [req.params.msgId, req.user.companyId]);
    if (!rows.length) return res.status(404).json({ error: 'Mensagem não encontrada' });
    const m = rows[0];

    // Persiste localmente (toggle: se ja tem mesmo emoji do mesmo user, remove)
    const { rows: existing } = await pool.query(
      'SELECT id, emoji FROM message_reactions WHERE message_id=$1 AND by_type=$2 AND by_user_id=$3',
      [m.id, 'user', req.user.id]
    );
    let action = 'add';
    if (existing.length && existing[0].emoji === emoji) {
      await pool.query('DELETE FROM message_reactions WHERE id=$1', [existing[0].id]);
      action = 'remove';
    } else if (existing.length) {
      await pool.query('UPDATE message_reactions SET emoji=$1, created_at=NOW() WHERE id=$2', [emoji, existing[0].id]);
    } else {
      await pool.query(
        'INSERT INTO message_reactions (message_id, emoji, by_type, by_user_id) VALUES ($1,$2,$3,$4)',
        [m.id, emoji, 'user', req.user.id]
      );
    }

    // Envia pro WhatsApp
    if (m.provider_msg_id) {
      try {
        await evolution.sendReaction(m.instance_name, {
          remoteJid: `${m.phone}@s.whatsapp.net`,
          fromMe: m.from_me,
          msgId: m.provider_msg_id,
          emoji: action === 'remove' ? '' : emoji,
        });
      } catch (e) { /* nao bloqueia */ }
    }

    const io = req.app.get('io');
    io?.to(`conv:${m.conversation_id}`).emit('message:reaction', { messageId: m.id });
    res.json({ ok: true, action });
  } catch (err) {
    console.error('POST /messages/reactions', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ── Editar msg propria ─────────────────────────────────────────────
router.patch('/:msgId', authCompany, async (req, res) => {
  try {
    const { body } = req.body;
    if (!body?.trim()) return res.status(400).json({ error: 'Body vazio' });
    const { rows } = await pool.query(`
      SELECT m.id, m.conversation_id, m.provider_msg_id, m.from_me, m.created_at, m.type,
             ct.phone, i.instance_name
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      JOIN contacts ct ON ct.id = c.contact_id
      JOIN whatsapp_instances i ON i.id = c.instance_id
      WHERE m.id=$1 AND c.company_id=$2
    `, [req.params.msgId, req.user.companyId]);
    if (!rows.length) return res.status(404).json({ error: 'Mensagem não encontrada' });
    const m = rows[0];
    if (!m.from_me) return res.status(403).json({ error: 'Só pode editar mensagens próprias' });
    if (m.type !== 'text') return res.status(400).json({ error: 'Só msgs de texto podem ser editadas' });
    // WhatsApp permite editar até 15 min depois do envio
    const ageMs = Date.now() - new Date(m.created_at).getTime();
    if (ageMs > 15 * 60 * 1000) return res.status(400).json({ error: 'Janela de edição expirou (15 min)' });

    await pool.query('UPDATE messages SET body=$1, edited_at=NOW() WHERE id=$2', [body, m.id]);

    if (m.provider_msg_id) {
      try {
        await evolution.editMessage(m.instance_name, {
          remoteJid: `${m.phone}@s.whatsapp.net`,
          msgId: m.provider_msg_id, text: body,
        });
      } catch (e) { /* msg local atualizada mesmo se WA falhar */ }
    }

    const io = req.app.get('io');
    io?.to(`conv:${m.conversation_id}`).emit('message:edited', { messageId: m.id });
    res.json({ ok: true });
  } catch (err) {
    console.error('PATCH /messages/:msgId', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ── Deletar msg propria (revoke for everyone) ──────────────────────
router.delete('/:msgId', authCompany, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT m.id, m.conversation_id, m.provider_msg_id, m.from_me,
             ct.phone, i.instance_name
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      JOIN contacts ct ON ct.id = c.contact_id
      JOIN whatsapp_instances i ON i.id = c.instance_id
      WHERE m.id=$1 AND c.company_id=$2
    `, [req.params.msgId, req.user.companyId]);
    if (!rows.length) return res.status(404).json({ error: 'Mensagem não encontrada' });
    const m = rows[0];
    if (!m.from_me) return res.status(403).json({ error: 'Só pode deletar mensagens próprias' });

    await pool.query(`UPDATE messages SET deleted_at=NOW(), body='[mensagem apagada]' WHERE id=$1`, [m.id]);

    if (m.provider_msg_id) {
      try {
        await evolution.deleteMessageForEveryone(m.instance_name, {
          remoteJid: `${m.phone}@s.whatsapp.net`,
          msgId: m.provider_msg_id,
        });
      } catch (e) { /* msg local marcada mesmo se WA falhar */ }
    }

    const io = req.app.get('io');
    io?.to(`conv:${m.conversation_id}`).emit('message:deleted', { messageId: m.id });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /messages/:msgId', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ── Encaminhar mensagem pra uma ou mais conversas ──────────────────
router.post('/:msgId/forward', authCompany, async (req, res) => {
  try {
    const { conversation_ids } = req.body;
    if (!Array.isArray(conversation_ids) || conversation_ids.length === 0) {
      return res.status(400).json({ error: 'conversation_ids obrigatório (array)' });
    }
    // Carrega msg origem
    const { rows: origRows } = await pool.query(`
      SELECT m.* FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE m.id=$1 AND c.company_id=$2
    `, [req.params.msgId, req.user.companyId]);
    if (!origRows.length) return res.status(404).json({ error: 'Mensagem não encontrada' });
    const orig = origRows[0];

    const results = [];
    for (const cid of conversation_ids) {
      try {
        const { rows: dst } = await pool.query(`
          SELECT c.id, ct.phone, i.instance_name FROM conversations c
          JOIN contacts ct ON ct.id = c.contact_id
          JOIN whatsapp_instances i ON i.id = c.instance_id
          WHERE c.id=$1 AND c.company_id=$2
        `, [cid, req.user.companyId]);
        if (!dst.length) { results.push({ cid, ok: false, error: 'destino invalido' }); continue; }
        const d = dst[0];

        // Insere msg local
        const { rows: ins } = await pool.query(`
          INSERT INTO messages
            (conversation_id, from_me, author_type, author_user_id, type, body, media_url, media_mime, media_filename, status)
          VALUES ($1, TRUE, 'agent', $2, $3, $4, $5, $6, $7, 'pending') RETURNING id
        `, [d.id, req.user.id, orig.type, orig.body, orig.media_url, orig.media_mime, orig.media_filename]);
        const newId = ins[0].id;

        // Envia via Evolution
        if (orig.type === 'text' || !orig.media_url) {
          const sent = await evolution.sendText(d.instance_name, d.phone, orig.body || '');
          await pool.query('UPDATE messages SET status=$1, provider_msg_id=$2 WHERE id=$3',
            ['sent', sent?.id || null, newId]);
        } else {
          // Mídia: passa URL pra Evolution
          const sent = await evolution.sendMedia(d.instance_name, d.phone, {
            kind: orig.type, base64: orig.media_url, mimetype: orig.media_mime,
            fileName: orig.media_filename, caption: orig.body || '',
          });
          await pool.query('UPDATE messages SET status=$1, provider_msg_id=$2 WHERE id=$3',
            ['sent', sent?.id || null, newId]);
        }

        await pool.query(
          `UPDATE conversations SET last_message_at = NOW(), last_message_preview = $1 WHERE id=$2`,
          [(orig.body || `[${orig.type}]`).slice(0, 200), d.id]
        );
        const io = req.app.get('io');
        io?.to(`conv:${d.id}`).emit('message:new', { conversationId: d.id });
        io?.to(`company:${req.user.companyId}`).emit('conversation:update', { conversationId: d.id });

        results.push({ cid, ok: true });
      } catch (e) {
        console.error('forward to', cid, e.message);
        results.push({ cid, ok: false, error: e.message });
      }
    }
    res.json({ results });
  } catch (err) {
    console.error('POST /messages/:id/forward', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

module.exports = router;
