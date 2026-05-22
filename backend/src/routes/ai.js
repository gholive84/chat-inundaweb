const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authCompany, authRole } = require('../middleware/auth');

router.get('/config', authCompany, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT company_id, provider, model, system_prompt, pause_seconds, enabled, max_tokens, temperature,
            (api_key IS NOT NULL AND length(api_key) > 0) AS has_key, updated_at
     FROM ai_configs WHERE company_id=$1`,
    [req.user.companyId]
  );
  res.json(rows[0] || {
    company_id: req.user.companyId, provider: 'none', enabled: false,
    pause_seconds: 600, max_tokens: 1024, temperature: 0.7, has_key: false,
  });
});

router.put('/config', authCompany, authRole('owner'), async (req, res) => {
  try {
    const { provider, api_key, model, system_prompt, pause_seconds, enabled, max_tokens, temperature } = req.body;
    // upsert (mantem api_key existente se vier vazio)
    await pool.query(`
      INSERT INTO ai_configs
        (company_id, provider, api_key, model, system_prompt, pause_seconds, enabled, max_tokens, temperature, updated_at)
      VALUES ($1,$2, COALESCE(NULLIF($3,''), (SELECT api_key FROM ai_configs WHERE company_id=$1)),
              $4,$5,$6,$7,$8,$9, NOW())
      ON CONFLICT (company_id) DO UPDATE SET
        provider     = EXCLUDED.provider,
        api_key      = CASE WHEN EXCLUDED.api_key IS NULL OR EXCLUDED.api_key = ''
                            THEN ai_configs.api_key ELSE EXCLUDED.api_key END,
        model        = EXCLUDED.model,
        system_prompt= EXCLUDED.system_prompt,
        pause_seconds= EXCLUDED.pause_seconds,
        enabled      = EXCLUDED.enabled,
        max_tokens   = EXCLUDED.max_tokens,
        temperature  = EXCLUDED.temperature,
        updated_at   = NOW()
    `, [req.user.companyId, provider || 'none', api_key || '', model || null, system_prompt || null,
        pause_seconds ?? 600, !!enabled, max_tokens ?? 1024, temperature ?? 0.7]);
    res.json({ success: true });
  } catch (err) {
    console.error('PUT /ai/config', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

module.exports = router;
