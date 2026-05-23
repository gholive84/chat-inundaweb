const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authCompany, authRole } = require('../middleware/auth');

router.get('/', authCompany, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT company_id, provider, endpoint, region, bucket, public_url,
            (access_key IS NOT NULL AND length(access_key) > 0) AS has_key,
            (secret_key IS NOT NULL AND length(secret_key) > 0) AS has_secret,
            updated_at
     FROM storage_configs WHERE company_id=$1`,
    [req.user.companyId]
  );
  res.json(rows[0] || { company_id: req.user.companyId, provider: 'local', has_key: false, has_secret: false });
});

router.put('/', authCompany, authRole('owner'), async (req, res) => {
  try {
    const { provider, endpoint, region, bucket, access_key, secret_key, public_url } = req.body;
    if (!['local', 's3'].includes(provider || 'local')) return res.status(400).json({ error: 'Provider inválido' });
    await pool.query(`
      INSERT INTO storage_configs (company_id, provider, endpoint, region, bucket, access_key, secret_key, public_url, updated_at)
      VALUES ($1,$2,$3,$4,$5,
              COALESCE(NULLIF($6,''), (SELECT access_key FROM storage_configs WHERE company_id=$1)),
              COALESCE(NULLIF($7,''), (SELECT secret_key FROM storage_configs WHERE company_id=$1)),
              $8, NOW())
      ON CONFLICT (company_id) DO UPDATE SET
        provider     = EXCLUDED.provider,
        endpoint     = EXCLUDED.endpoint,
        region       = EXCLUDED.region,
        bucket       = EXCLUDED.bucket,
        access_key   = CASE WHEN EXCLUDED.access_key IS NULL OR EXCLUDED.access_key = ''
                            THEN storage_configs.access_key ELSE EXCLUDED.access_key END,
        secret_key   = CASE WHEN EXCLUDED.secret_key IS NULL OR EXCLUDED.secret_key = ''
                            THEN storage_configs.secret_key ELSE EXCLUDED.secret_key END,
        public_url   = EXCLUDED.public_url,
        updated_at   = NOW()
    `, [req.user.companyId, provider || 'local', endpoint || null, region || null, bucket || null,
        access_key || '', secret_key || '', public_url || null]);
    res.json({ success: true });
  } catch (err) {
    console.error('PUT /storage', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

module.exports = router;
