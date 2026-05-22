const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authCompany, authRole } = require('../middleware/auth');

router.get('/stages', authCompany, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, label, color, position FROM crm_stages WHERE company_id=$1 ORDER BY position ASC',
    [req.user.companyId]
  );
  res.json(rows);
});

router.post('/stages', authCompany, authRole('owner'), async (req, res) => {
  try {
    const { id, label, color, position } = req.body;
    if (!id || !label) return res.status(400).json({ error: 'id e label obrigatórios' });
    await pool.query(
      `INSERT INTO crm_stages (id, company_id, label, color, position) VALUES ($1,$2,$3,$4,$5)`,
      [id, req.user.companyId, label, color || 'blue', position ?? 99]
    );
    res.status(201).json({ success: true });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Estágio já existe' });
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.put('/stages/:id', authCompany, authRole('owner'), async (req, res) => {
  const { label, color, position } = req.body;
  await pool.query(
    `UPDATE crm_stages SET label=$1, color=$2, position=$3 WHERE id=$4 AND company_id=$5`,
    [label, color || 'blue', position ?? 0, req.params.id, req.user.companyId]
  );
  res.json({ success: true });
});

router.delete('/stages/:id', authCompany, authRole('owner'), async (req, res) => {
  await pool.query('DELETE FROM crm_stages WHERE id=$1 AND company_id=$2', [req.params.id, req.user.companyId]);
  res.json({ success: true });
});

// Move contato (kanban drag) — atualiza crm_stage e crm_order
router.put('/contacts/:contactId/stage', authCompany, async (req, res) => {
  const { stage, order } = req.body;
  await pool.query(
    `UPDATE contacts SET crm_stage=$1, crm_order=COALESCE($2, crm_order) WHERE id=$3 AND company_id=$4`,
    [stage || null, order ?? null, req.params.contactId, req.user.companyId]
  );
  res.json({ success: true });
});

module.exports = router;
