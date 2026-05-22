const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authCompany, authRole } = require('../middleware/auth');

router.get('/me', authCompany, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, slug, name, email, max_agents, created_at FROM companies WHERE id=$1',
      [req.user.companyId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Empresa não encontrada' });

    const { rows: users } = await pool.query(
      'SELECT id, name, email, role, avatar_url, active, last_seen_at FROM users WHERE company_id=$1 ORDER BY name',
      [req.user.companyId]
    );
    res.json({ company: rows[0], users });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.put('/me', authCompany, authRole('owner'), async (req, res) => {
  try {
    const { name, email } = req.body;
    await pool.query('UPDATE companies SET name=$1, email=$2 WHERE id=$3',
      [name, email || null, req.user.companyId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

module.exports = router;
