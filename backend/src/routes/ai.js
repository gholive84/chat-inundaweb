const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authCompany, authRole } = require('../middleware/auth');

router.get('/config', authCompany, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT company_id, provider, model, system_prompt, pause_seconds, enabled, max_tokens, temperature,
            default_conversation_ai, max_msgs_per_minute, opt_out_keywords,
            business_hours_enabled, business_hours_start, business_hours_end, business_hours_timezone,
            (api_key IS NOT NULL AND length(api_key) > 0) AS has_key, updated_at
     FROM ai_configs WHERE company_id=$1`,
    [req.user.companyId]
  );
  res.json(rows[0] || {
    company_id: req.user.companyId, provider: 'none', enabled: false,
    pause_seconds: 600, max_tokens: 1024, temperature: 0.7,
    default_conversation_ai: true, has_key: false,
    max_msgs_per_minute: 15, opt_out_keywords: 'parar,stop,sair,descadastrar,unsubscribe,nao quero,nao tenho interesse,remova',
    business_hours_enabled: false, business_hours_start: '08:00', business_hours_end: '22:00',
    business_hours_timezone: 'America/Sao_Paulo',
  });
});

// Lista modelos disponiveis pro provider (precisa de api_key valida)
router.post('/models', authCompany, async (req, res) => {
  try {
    const axios = require('axios');
    const { provider, api_key } = req.body;
    let key = api_key;
    // Se nao mandou key, tenta usar a salva
    if (!key) {
      const { rows } = await pool.query(
        'SELECT api_key, provider FROM ai_configs WHERE company_id=$1',
        [req.user.companyId]
      );
      key = rows[0]?.api_key;
    }
    if (!key) return res.status(400).json({ error: 'API key necessária' });

    let models = [];
    if (provider === 'openai') {
      const { data } = await axios.get('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${key}` },
        timeout: 15000,
      });
      // Filtra so modelos de chat (gpt-*, o1-*, o3-*, chatgpt-*)
      models = (data?.data || [])
        .filter((m) => /^(gpt-|o1|o3|o4|chatgpt-)/.test(m.id))
        .filter((m) => !/-instruct|audio|realtime|tts|whisper|transcribe|embedding|moderation|vision-preview|search|computer/.test(m.id))
        .map((m) => ({ id: m.id, name: m.id }))
        .sort((a, b) => b.id.localeCompare(a.id));
    } else if (provider === 'anthropic') {
      try {
        const { data } = await axios.get('https://api.anthropic.com/v1/models', {
          headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
          timeout: 15000,
        });
        models = (data?.data || []).map((m) => ({ id: m.id, name: m.display_name || m.id }));
      } catch {
        // Fallback: lista hardcoded das principais
        models = [
          { id: 'claude-opus-4-1-20250805',    name: 'Claude Opus 4.1' },
          { id: 'claude-opus-4-20250514',      name: 'Claude Opus 4' },
          { id: 'claude-sonnet-4-20250514',    name: 'Claude Sonnet 4' },
          { id: 'claude-3-7-sonnet-20250219',  name: 'Claude 3.7 Sonnet' },
          { id: 'claude-3-5-sonnet-20241022',  name: 'Claude 3.5 Sonnet (oct)' },
          { id: 'claude-3-5-haiku-20241022',   name: 'Claude 3.5 Haiku' },
          { id: 'claude-3-opus-20240229',      name: 'Claude 3 Opus' },
          { id: 'claude-3-haiku-20240307',     name: 'Claude 3 Haiku' },
        ];
      }
    } else {
      return res.status(400).json({ error: 'Provider não suportado' });
    }
    res.json(models);
  } catch (err) {
    console.error('POST /ai/models', err.response?.data || err.message);
    const msg = err.response?.status === 401 ? 'API key inválida' : (err.message || 'Erro ao listar modelos');
    res.status(400).json({ error: msg });
  }
});

router.put('/config', authCompany, authRole('owner'), async (req, res) => {
  try {
    const b = req.body;
    await pool.query(`
      INSERT INTO ai_configs
        (company_id, provider, api_key, model, system_prompt, pause_seconds, enabled, max_tokens, temperature,
         default_conversation_ai, max_msgs_per_minute, opt_out_keywords,
         business_hours_enabled, business_hours_start, business_hours_end, business_hours_timezone, updated_at)
      VALUES ($1,$2, COALESCE(NULLIF($3,''), (SELECT api_key FROM ai_configs WHERE company_id=$1)),
              $4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, NOW())
      ON CONFLICT (company_id) DO UPDATE SET
        provider                = EXCLUDED.provider,
        api_key                 = CASE WHEN EXCLUDED.api_key IS NULL OR EXCLUDED.api_key = ''
                                       THEN ai_configs.api_key ELSE EXCLUDED.api_key END,
        model                   = EXCLUDED.model,
        system_prompt           = EXCLUDED.system_prompt,
        pause_seconds           = EXCLUDED.pause_seconds,
        enabled                 = EXCLUDED.enabled,
        max_tokens              = EXCLUDED.max_tokens,
        temperature             = EXCLUDED.temperature,
        default_conversation_ai = EXCLUDED.default_conversation_ai,
        max_msgs_per_minute     = EXCLUDED.max_msgs_per_minute,
        opt_out_keywords        = EXCLUDED.opt_out_keywords,
        business_hours_enabled  = EXCLUDED.business_hours_enabled,
        business_hours_start    = EXCLUDED.business_hours_start,
        business_hours_end      = EXCLUDED.business_hours_end,
        business_hours_timezone = EXCLUDED.business_hours_timezone,
        updated_at              = NOW()
    `, [req.user.companyId, b.provider || 'none', b.api_key || '', b.model || null, b.system_prompt || null,
        b.pause_seconds ?? 600, !!b.enabled, b.max_tokens ?? 1024, b.temperature ?? 0.7,
        b.default_conversation_ai !== false,
        b.max_msgs_per_minute ?? 15,
        b.opt_out_keywords ?? 'parar,stop,sair,descadastrar,unsubscribe,nao quero,nao tenho interesse,remova',
        !!b.business_hours_enabled,
        b.business_hours_start || '08:00',
        b.business_hours_end || '22:00',
        b.business_hours_timezone || 'America/Sao_Paulo']);
    res.json({ success: true });
  } catch (err) {
    console.error('PUT /ai/config', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

module.exports = router;
