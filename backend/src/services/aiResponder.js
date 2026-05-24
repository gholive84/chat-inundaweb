// Orquestra: dado um conversation_id apos mensagem nova do contato,
// decide se IA responde, chama provider e envia via Evolution.
const { pool } = require('../config/database');
const openai = require('../ai/openai');
const evolution = require('../providers/evolution');
const rateLimiter = require('./rateLimiter');
const { jitter, isWithinBusinessHours } = require('./safety');

const PROVIDERS = { openai };

// Quantas mensagens do historico mandar pro modelo
const HISTORY_LIMIT = 20;

// Boas praticas WhatsApp
const MAX_CHARS_PER_MSG = 3800;    // WhatsApp aceita ~4096, deixamos margem
const MIN_HUMAN_DELAY_MS = 600;     // delay minimo antes de responder
const CHARS_PER_MS = 1 / 30;         // ~30ms por char digitado (≈400 wpm)
const MAX_TYPING_MS = 5000;          // cap do delay 'digitando'
const PAUSE_BETWEEN_CHUNKS_MS = 800; // pausa entre mensagens consecutivas

// System prompt extra que damos pra IA sempre — diretrizes de boas praticas
const BASE_GUIDELINES = `\n\n# Diretrizes de comunicacao no WhatsApp:\n` +
  `- Seja conciso. Respostas curtas funcionam melhor.\n` +
  `- Use linguagem natural e amigavel, como em conversa real.\n` +
  `- Quebre em paragrafos curtos (1-3 frases cada).\n` +
  `- Evite blocos de texto longos — divida em mensagens menores quando preciso.\n` +
  `- Use *negrito* (entre asteriscos) pra destacar pontos importantes (WhatsApp renderiza).\n` +
  `- Nao use markdown complexo (tabelas, headers H1-H6, blockquotes).\n` +
  `- Emojis com moderacao quando agregar.\n` +
  `- Se a pergunta exigir resposta tecnica longa, pergunte se o cliente quer detalhes ou prefere resumo.\n`;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/**
 * Quebra um texto em chunks <= MAX_CHARS preservando paragrafos.
 * Tenta cortar em quebras de linha duplas, depois simples, depois espacos.
 */
function splitMessage(text, maxChars = MAX_CHARS_PER_MSG) {
  if (!text) return [];
  if (text.length <= maxChars) return [text];

  const chunks = [];
  let remaining = text.trim();

  while (remaining.length > maxChars) {
    let cut = maxChars;
    // procura quebra de paragrafo dentro do limite
    const para = remaining.lastIndexOf('\n\n', maxChars);
    if (para > maxChars * 0.4) cut = para;
    else {
      const ln = remaining.lastIndexOf('\n', maxChars);
      if (ln > maxChars * 0.5) cut = ln;
      else {
        const sp = remaining.lastIndexOf(' ', maxChars);
        if (sp > maxChars * 0.6) cut = sp;
      }
    }
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function typingDelayFor(textLen) {
  return Math.min(MAX_TYPING_MS, MIN_HUMAN_DELAY_MS + textLen / CHARS_PER_MS);
}

async function maybeRespond({ conversationId, app }) {
  try {
    // 1) Pega contexto da conversa + config AI DA CAIXA (per-instance)
    const { rows: cv } = await pool.query(`
      SELECT c.id, c.company_id, c.instance_id, c.contact_id, c.ai_enabled, c.ai_paused_until, c.status, c.opted_out,
             ct.phone, ct.name AS contact_name, ct.push_name,
             i.instance_name,
             ai.name AS ai_name,
             ai.provider, ai.api_key, ai.model, ai.system_prompt, ai.max_tokens, ai.temperature, ai.enabled AS ai_globally_enabled,
             ai.max_msgs_per_minute, ai.business_hours_enabled, ai.business_hours_start, ai.business_hours_end, ai.business_hours_timezone
      FROM conversations c
      JOIN contacts ct ON ct.id = c.contact_id
      JOIN whatsapp_instances i ON i.id = c.instance_id
      LEFT JOIN ai_configs ai ON ai.instance_id = c.instance_id
      WHERE c.id = $1
    `, [conversationId]);
    if (!cv.length) return { skipped: 'conversation not found' };
    const C = cv[0];

    if (!C.ai_globally_enabled) return { skipped: 'AI globally disabled' };
    if (!C.ai_enabled)          return { skipped: 'AI disabled for this conversation' };
    if (C.opted_out)            return { skipped: 'contact opted out' };
    if (C.status !== 'open')    return { skipped: `conversation status ${C.status}` };
    if (C.ai_paused_until && new Date(C.ai_paused_until) > new Date()) {
      return { skipped: 'AI paused (agent active)' };
    }
    if (!C.provider || C.provider === 'none') return { skipped: 'no AI provider configured' };
    const adapter = PROVIDERS[C.provider];
    if (!adapter) return { skipped: `unknown provider ${C.provider}` };
    if (!C.api_key) return { skipped: 'no api_key' };

    // Safety check 1: business hours
    if (!isWithinBusinessHours({
      enabled: C.business_hours_enabled, start: C.business_hours_start,
      end: C.business_hours_end, timezone: C.business_hours_timezone,
    })) {
      return { skipped: 'outside business hours' };
    }

    // Safety check 2: rate limit por instance
    const maxPerMin = C.max_msgs_per_minute || 15;
    const rl = rateLimiter.check(C.instance_name, maxPerMin);
    if (!rl.allowed) {
      console.log(`[AI] rate limit hit ${C.instance_name} (waiting ${rl.waitMs}ms)`);
      return { skipped: `rate limit (${rl.waitMs}ms wait)` };
    }

    // 1.5) Carrega knowledge base DA CAIXA + templates permitidos + diretrizes
    const { rows: kb } = await pool.query(
      `SELECT title, content FROM ai_knowledge WHERE instance_id=$1 ORDER BY created_at ASC LIMIT 20`,
      [C.instance_id]
    );
    const { rows: aiTemplates } = await pool.query(
      `SELECT qr.id, qr.shortcut, qr.title, qr.body, qr.media_url, qr.media_mime, qr.media_filename, qr.media_type
       FROM ai_instance_templates ait
       JOIN quick_replies qr ON qr.id = ait.template_id
       WHERE ait.instance_id = $1`,
      [C.instance_id]
    );
    let systemPrompt = C.system_prompt || 'Voce e um atendente automatico. Seja cordial e breve.';
    systemPrompt += BASE_GUIDELINES;
    if (kb.length > 0) {
      const kbText = kb.map((k) => `### ${k.title}\n${k.content}`).join('\n\n---\n\n');
      systemPrompt += `\n\n# Base de conhecimento (use como referencia ao responder):\n\n${kbText}`;
    }
    if (aiTemplates.length > 0) {
      const list = aiTemplates.map((t) => {
        const summary = t.title || (t.body ? t.body.slice(0, 80) : '') + (t.media_filename ? ` [arquivo: ${t.media_filename}]` : '');
        return `- ${t.shortcut} → ${summary}`;
      }).join('\n');
      systemPrompt += `\n\n# Templates pré-prontos disponíveis\n` +
        `Quando a resposta ideal for um dos templates abaixo, responda EXATAMENTE com o atalho ` +
        `(ex: \`/preco\`) — nada antes ou depois. O sistema substitui pelo conteúdo completo (incluindo arquivos).\n` +
        `Use o template SÓ quando casar perfeitamente com a pergunta do cliente. Se nao casar, responda normal.\n\n${list}`;
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

    // 3.5) Parser de template: se reply for SO um /atalho, usa o template
    const trimmedReply = reply.trim();
    const matchedTpl = aiTemplates.find((t) =>
      trimmedReply.toLowerCase() === t.shortcut.toLowerCase()
    );
    if (matchedTpl) {
      console.log('[AI] usando template', matchedTpl.shortcut);
      // Re-checa rate limit
      const rlChunk = rateLimiter.check(C.instance_name, maxPerMin);
      if (!rlChunk.allowed) await sleep(rlChunk.waitMs + 500);
      // typing indicator
      const typingMs = Math.floor(jitter(typingDelayFor((matchedTpl.body || '').length || 100)));
      try { await evolution.sendPresence(C.instance_name, C.phone, 'composing', typingMs); } catch {}
      await sleep(typingMs);

      // Salva pending
      const msgType = matchedTpl.media_type || 'text';
      const { rows: ins } = await pool.query(`
        INSERT INTO messages (conversation_id, from_me, author_type, type, body, media_url, media_mime, media_filename, status)
        VALUES ($1, TRUE, 'ai', $2, $3, $4, $5, $6, 'pending') RETURNING id
      `, [conversationId, msgType, matchedTpl.body || '', matchedTpl.media_url, matchedTpl.media_mime, matchedTpl.media_filename]);
      const msgId = ins[0].id;

      try {
        let sent;
        if (matchedTpl.media_url) {
          sent = await evolution.sendMedia(C.instance_name, C.phone, {
            kind: matchedTpl.media_type || 'document',
            base64: matchedTpl.media_url,
            mimetype: matchedTpl.media_mime || 'application/octet-stream',
            fileName: matchedTpl.media_filename || 'arquivo',
            caption: matchedTpl.body || '',
          });
        } else {
          sent = await evolution.sendText(C.instance_name, C.phone, matchedTpl.body || '');
        }
        rateLimiter.record(C.instance_name);
        await pool.query('UPDATE messages SET status=$1, provider_msg_id=$2 WHERE id=$3',
          ['sent', sent?.id || null, msgId]);
      } catch (e) {
        await pool.query('UPDATE messages SET status=$1, error=$2 WHERE id=$3',
          ['failed', e.message?.slice(0, 500), msgId]);
        return { error: 'send template failed' };
      }
      const preview = (matchedTpl.body || `[${msgType}]`).slice(0, 200);
      await pool.query(
        `UPDATE conversations SET last_message_at=NOW(), last_message_preview=$1 WHERE id=$2`,
        [preview, conversationId]
      );
      const ioRef = app?.get('io');
      ioRef?.to(`conv:${conversationId}`).emit('message:new', { conversationId });
      ioRef?.to(`company:${C.company_id}`).emit('conversation:update', { conversationId });
      try { await evolution.sendPresence(C.instance_name, C.phone, 'paused'); } catch {}
      return { ok: true, template: matchedTpl.shortcut };
    }

    // 4) Quebra em chunks (boas praticas WhatsApp — max ~4000 chars/msg)
    const chunks = splitMessage(reply);
    const io = app?.get('io');
    const lastIds = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];

      // Re-checa rate limit antes de cada chunk (multi-chunk pode estourar)
      const rlChunk = rateLimiter.check(C.instance_name, maxPerMin);
      if (!rlChunk.allowed) {
        console.log(`[AI] rate limit no chunk ${i+1}, esperando ${rlChunk.waitMs}ms`);
        await sleep(rlChunk.waitMs + 500);
      }

      // Indicador de "digitando..." + delay humano com jitter
      const typingMs = Math.floor(jitter(typingDelayFor(chunk.length)));
      try { await evolution.sendPresence(C.instance_name, C.phone, 'composing', typingMs); } catch {}
      await sleep(typingMs);

      // Salva como pending
      const { rows: ins } = await pool.query(`
        INSERT INTO messages (conversation_id, from_me, author_type, type, body, status)
        VALUES ($1, TRUE, 'ai', 'text', $2, 'pending') RETURNING id
      `, [conversationId, chunk]);
      const msgId = ins[0].id;
      lastIds.push(msgId);

      try {
        const sent = await evolution.sendText(C.instance_name, C.phone, chunk);
        rateLimiter.record(C.instance_name);
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
        return { error: 'send failed', sentBefore: i };
      }

      // Atualiza conversation com a ultima
      await pool.query(`
        UPDATE conversations SET last_message_at = NOW(), last_message_preview = $1
        WHERE id = $2
      `, [chunk.slice(0, 200), conversationId]);

      io?.to(`conv:${conversationId}`).emit('message:new', { conversationId, message: { id: msgId, body: chunk, from_me: true, author_type: 'ai' } });
      io?.to(`company:${C.company_id}`).emit('conversation:update', { conversationId });

      // Pausa entre chunks com jitter (nao no ultimo)
      if (i < chunks.length - 1) await sleep(Math.floor(jitter(PAUSE_BETWEEN_CHUNKS_MS, 0.4)));
    }

    // 5) Marca como "pausado" (encerra typing indicator)
    try { await evolution.sendPresence(C.instance_name, C.phone, 'paused'); } catch {}

    return { ok: true, msgIds: lastIds, chunks: chunks.length };
  } catch (err) {
    console.error('AI responder error:', err.response?.data || err.message);
    return { error: err.message };
  }
}

module.exports = { maybeRespond };
