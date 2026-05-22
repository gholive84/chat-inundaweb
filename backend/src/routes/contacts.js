const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authCompany } = require('../middleware/auth');

router.get('/', authCompany, async (req, res) => {
  const { search, stage, limit = 200 } = req.query;
  const where = ['company_id=$1']; const params = [req.user.companyId];
  if (search) { params.push(`%${search}%`); where.push(`(name ILIKE $${params.length} OR push_name ILIKE $${params.length} OR phone ILIKE $${params.length})`); }
  if (stage) { params.push(stage); where.push(`crm_stage = $${params.length}`); }
  params.push(parseInt(limit));
  const { rows } = await pool.query(`
    SELECT id, phone, name, push_name, profile_pic_url, crm_stage, crm_order, email, notes, created_at
    FROM contacts WHERE ${where.join(' AND ')} ORDER BY COALESCE(name, push_name, phone) LIMIT $${params.length}
  `, params);
  res.json(rows);
});

router.get('/:id', authCompany, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM contacts WHERE id=$1 AND company_id=$2',
    [req.params.id, req.user.companyId]
  );
  if (!rows.length) return res.status(404).json({ error: 'Contato não encontrado' });
  res.json(rows[0]);
});

router.put('/:id', authCompany, async (req, res) => {
  const { name, email, notes, crm_stage } = req.body;
  await pool.query(
    `UPDATE contacts SET name=$1, email=$2, notes=$3, crm_stage=$4
     WHERE id=$5 AND company_id=$6`,
    [name || null, email || null, notes || null, crm_stage || null, req.params.id, req.user.companyId]
  );
  res.json({ success: true });
});

module.exports = router;
