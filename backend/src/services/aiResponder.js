// Orquestra: dado um conversation_id apos mensagem nova do contato,
// decide se IA responde, chama provider e envia via Evolution.
const { pool } = require('../config/database');
const openai = require('../ai/openai');
const evolution = require('../providers/evolution');

const PROVIDERS = { openai };

// Quantas mensagens do historico mandar pro modelo
const HISTORY_LIMIT = 20;

async function maybeRespond({ conversationId, app }) {
  try {
    // 1) Pega contexto da conversa + config AI da company
    const { rows: cv } = await pool.query(`
      SELECT c.id, c.company_id, c.instance_id, c.contact_id, c.ai_enabled, c.ai_paused_until, c.status,
             ct.phone, ct.name AS contact_name, ct.push_name,
             i.instance_name,
             ai.provider, ai.api_key, ai.model, ai.system_prompt, ai.max_tokens, ai.temperature, ai.enabled AS ai_globally_enabled
      FROM conversations c
      JOIN contacts ct ON ct.id = c.contact_id
      JOIN whatsapp_instances i ON i.id = c.instance_id
      LEFT JOIN ai_configs ai ON ai.company_id = c.company_id
      WHERE c.id = $1
    `, [conversationId]);
    if (!cv.length) return { skipped: 'conversation not found' };
    const C = cv[0];

    if (!C.ai_globally_enabled) return { skipped: 'AI globally disabled' };
    if (!C.ai_enabled)          return { skipped: 'AI disabled for this conversation' };
    if (C.status !== 'open')    return { skipped: `conversation status ${C.status}` };
    if (C.ai_paused_until && new Date(C.ai_paused_until) > new Date()) {
      return { skipped: 'AI paused (agent active)' };
    }
    if (!C.provider || C.provider === 'none') return { skipped: 'no AI provider configured' };
    const adapter = PROVIDERS[C.provider];
    if (!adapter) return { skipped: `unknown provider ${C.provider}` };
    if (!C.api_key) return { skipped: 'no api_key' };

    // 1.5) Carrega knowledge base da company pra injetar no system prompt
    const { rows: kb } = await pool.query(
      `SELECT title, content FROM ai_knowledge WHERE company_id=$1 ORDER BY created_at ASC LIMIT 20`,
      [C.company_id]
    );
    let systemPrompt = C.system_prompt || 'Voce e um atendente automatico. Seja cordial e breve.';
    if (kb.length > 0) {
      const kbText = kb.map((k) => `### ${k.title}\n${k.content}`).join('\n\n---\n\n');
      systemPrompt += `\n\n# Base de conhecimento (use como referencia ao responder):\n\n${kbText}`;
    }

    // 2) Carrega historico das ultimas N msgs (ordenado crescente)
    const { rows: msgs } = await pool.query(`
      SELECT from_me, author_type, body, type
      FROM messages
      WHERE conversation_id = $1 AND body IS NOT NULL AND body <> ''
      ORDER BY created_at DESC LIMIT $2
    `, [conversationId, HISTORY_LIMIT]);

    const history = msgs.reverse().map((m) => ({
      role: m.from_me ? 'assistant' : 'user',
      content: m.body,
    }));
    if (!history.length) return { skipped: 'no history' };

    // 3) Chama AI
    const reply = await adapter.chat({
      apiKey:        C.api_key,
      model:         C.model || 'gpt-4o-mini',
      systemPrompt:  systemPrompt,
      messages:      history,
      maxTokens:     C.max_tokens || 1024,
      temperature:   C.temperature ?? 0.7,
    });

    if (!reply || !reply.trim()) return { skipped: 'empty response' };

    // 4) Salva como 'ai' e envia via Evolution
    const { rows: ins } = await pool.query(`
      INSERT INTO messages (conversation_id, from_me, author_type, type, body, status)
      VALUES ($1, TRUE, 'ai', 'text', $2, 'pending') RETURNING id
    `, [conversationId, reply]);
    const msgId = ins[0].id;

    try {
      const sent = await evolution.sendText(C.instance_name, C.phone, reply);
      await pool.query(
        'UPDATE messages SET status=$1, provider_msg_id=$2 WHERE id=$3',
        ['sent', sent?.id || null, msgId]
      );
    } catch (sendErr) {
      console.error('AI: send failed', sendErr.message);
      await pool.query(
        'UPDATE messages SET status=$1, error=$2 WHERE id=$3',
        ['failed', sendErr.message?.slice(0, 500) || 'send failed', msgId]
      );
      return { error: 'send failed' };
    }

    await pool.query(`
      UPDATE conversations SET last_message_at = NOW(), last_message_preview = $1
      WHERE id = $2
    `, [reply.slice(0, 200), conversationId]);

    // 5) Notifica clientes
    const io = app?.get('io');
    io?.to(`conv:${conversationId}`).emit('message:new', { conversationId, message: { id: msgId, body: reply, from_me: true, author_type: 'ai' } });
    io?.to(`company:${C.company_id}`).emit('conversation:update', { conversationId });

    return { ok: true, msgId };
  } catch (err) {
    console.error('AI responder error:', err.response?.data || err.message);
    return { error: err.message };
  }
}

module.exports = { maybeRespond };
