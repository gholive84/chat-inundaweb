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

// Lista mensagens de uma conversa
router.get('/:conversationId', authCompany, async (req, res) => {
  try {
    // Verifica que conversa pertence à company
    const { rows: conv } = await pool.query(
      'SELECT id FROM conversations WHERE id=$1 AND company_id=$2',
      [req.params.conversationId, req.user.companyId]
    );
    if (!conv.length) return res.status(404).json({ error: 'Conversa não encontrada' });

    const { rows } = await pool.query(`
      SELECT m.*, u.name AS author_name, u.avatar_url AS author_avatar_url
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

// Enviar mensagem (agent → contact via provider)
router.post('/:conversationId', authCompany, async (req, res) => {
  try {
    const { body, type = 'text' } = req.body;
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

    // Assinatura: prepend nome do agente se config ativa
    let bodyToSend = body;
    if (c.sign_messages) {
      const agentName = req.user.name || 'Atendente';
      let signature;
      if (c.signature_format === 'brackets') signature = `[${agentName}]`;
      else if (c.signature_format === 'plain') signature = `${agentName}:`;
      else signature = `*${agentName}*`; // bold (default — WhatsApp renderiza *texto* como negrito)
      bodyToSend = `${signature}\n${body}`;
    }

    // Salva como pending — guarda o body COM assinatura (refletindo o que foi enviado)
    const { rows: ins } = await pool.query(`
      INSERT INTO messages (conversation_id, from_me, author_type, author_user_id, type, body, status)
      VALUES ($1, TRUE, 'agent', $2, $3, $4, 'pending') RETURNING id
    `, [c.id, req.user.id, type, bodyToSend]);
    const msgId = ins[0].id;

    // Pausa IA + auto-atribui agente se ainda nao tinha
    await pool.query(
      `UPDATE conversations SET ai_paused_until = NOW() + INTERVAL '10 minutes',
                                last_message_at = NOW(),
                                last_message_preview = $1,
                                assigned_to_user_id = COALESCE(assigned_to_user_id, $2)
       WHERE id=$3`,
      [bodyToSend.slice(0, 200), req.user.id, c.id]
    );

    // Envia via provider (com assinatura ja aplicada se aplicavel)
    try {
      const sent = await evolution.sendText(c.instance_name, c.phone, bodyToSend);
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

    // Emit socket
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

    // Tenta subir pro S3 (se configurado). Mantemos URL pra exibir na bolha.
    let mediaUrl = null;
    let mediaPayload; // o que mandar pro Evolution: 'url' string ou base64 string
    let useUrl = false;
    if (await storage.hasS3(req.user.companyId)) {
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
        useUrl = true;
      } catch (e) {
        console.warn('[s3] upload falhou, fallback pra base64:', e.message);
        mediaPayload = req.file.buffer.toString('base64');
      }
    } else {
      mediaPayload = req.file.buffer.toString('base64');
    }

    // Salva mensagem pendente
    const { rows: ins } = await pool.query(`
      INSERT INTO messages (conversation_id, from_me, author_type, author_user_id, type, body, media_url, media_mime, media_filename, status)
      VALUES ($1, TRUE, 'agent', $2, $3, $4, $5, $6, $7, 'pending') RETURNING id
    `, [c.id, req.user.id, kind, caption, mediaUrl, req.file.mimetype, req.file.originalname]);
    const msgId = ins[0].id;

    // Pausa IA + auto-assign
    await pool.query(
      `UPDATE conversations SET ai_paused_until = NOW() + INTERVAL '10 minutes',
                                last_message_at = NOW(),
                                last_message_preview = $1,
                                assigned_to_user_id = COALESCE(assigned_to_user_id, $2)
       WHERE id=$3`,
      [`[${kind}] ${caption || req.file.originalname}`.slice(0, 200), req.user.id, c.id]
    );

    // Envia via Evolution
    try {
      const sent = await evolution.sendMedia(c.instance_name, c.phone, {
        kind,
        base64: mediaPayload, // Evolution aceita URL ou base64 no mesmo campo
        mimetype: req.file.mimetype,
        fileName: req.file.originalname,
        caption,
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

    // Emit
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

module.exports = router;
