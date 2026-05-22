const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authCompany } = require('../middleware/auth');
const evolution = require('../providers/evolution');

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
      SELECT c.id, c.contact_id, ct.phone, i.instance_name
      FROM conversations c
      JOIN contacts ct ON ct.id = c.contact_id
      JOIN whatsapp_instances i ON i.id = c.instance_id
      WHERE c.id=$1 AND c.company_id=$2
    `, [req.params.conversationId, req.user.companyId]);
    if (!conv.length) return res.status(404).json({ error: 'Conversa não encontrada' });
    const c = conv[0];

    // Salva como pending
    const { rows: ins } = await pool.query(`
      INSERT INTO messages (conversation_id, from_me, author_type, author_user_id, type, body, status)
      VALUES ($1, TRUE, 'agent', $2, $3, $4, 'pending') RETURNING id
    `, [c.id, req.user.id, type, body]);
    const msgId = ins[0].id;

    // Pausa IA + auto-atribui agente se ainda nao tinha
    await pool.query(
      `UPDATE conversations SET ai_paused_until = NOW() + INTERVAL '10 minutes',
                                last_message_at = NOW(),
                                last_message_preview = $1,
                                assigned_to_user_id = COALESCE(assigned_to_user_id, $2)
       WHERE id=$3`,
      [body.slice(0, 200), req.user.id, c.id]
    );

    // Envia via provider
    try {
      const sent = await evolution.sendText(c.instance_name, c.phone, body);
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

module.exports = router;
