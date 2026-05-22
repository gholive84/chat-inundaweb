const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authCompany } = require('../middleware/auth');

router.get('/', authCompany, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, label, color FROM tags WHERE company_id=$1 ORDER BY label',
    [req.user.companyId]
  );
  res.json(rows);
});

router.post('/', authCompany, async (req, res) => {
  try {
    const { label, color } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO tags (company_id, label, color) VALUES ($1,$2,$3) RETURNING *`,
      [req.user.companyId, label, color || '#3b82f6']
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Tag já existe' });
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.delete('/:id', authCompany, async (req, res) => {
  await pool.query('DELETE FROM tags WHERE id=$1 AND company_id=$2', [req.params.id, req.user.companyId]);
  res.json({ success: true });
});

router.post('/conversation/:convId/:tagId', authCompany, async (req, res) => {
  // valida ownership
  const { rows } = await pool.query(`
    SELECT 1 FROM conversations c JOIN tags t ON t.company_id = c.company_id
    WHERE c.id=$1 AND t.id=$2 AND c.company_id=$3
  `, [req.params.convId, req.params.tagId, req.user.companyId]);
  if (!rows.length) return res.status(404).json({ error: 'Não encontrado' });
  await pool.query(
    'INSERT INTO conversation_tags (conversation_id, tag_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
    [req.params.convId, req.params.tagId]
  );
  res.json({ success: true });
});

router.delete('/conversation/:convId/:tagId', authCompany, async (req, res) => {
  await pool.query(
    'DELETE FROM conversation_tags WHERE conversation_id=$1 AND tag_id=$2',
    [req.params.convId, req.params.tagId]
  );
  res.json({ success: true });
});

module.exports = router;
