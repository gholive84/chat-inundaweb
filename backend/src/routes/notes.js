const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authCompany } = require('../middleware/auth');

router.get('/conversation/:convId', authCompany, async (req, res) => {
  const { rows: c } = await pool.query(
    'SELECT 1 FROM conversations WHERE id=$1 AND company_id=$2',
    [req.params.convId, req.user.companyId]
  );
  if (!c.length) return res.status(404).json({ error: 'Conversa não encontrada' });

  const { rows } = await pool.query(`
    SELECT n.id, n.body, n.created_at, u.name AS author_name, u.avatar_url AS author_avatar_url
    FROM notes n LEFT JOIN users u ON u.id = n.user_id
    WHERE n.conversation_id=$1
    ORDER BY n.created_at DESC
  `, [req.params.convId]);
  res.json(rows);
});

router.post('/conversation/:convId', authCompany, async (req, res) => {
  const { body } = req.body;
  if (!body?.trim()) return res.status(400).json({ error: 'Nota vazia' });
  const { rows: c } = await pool.query(
    'SELECT 1 FROM conversations WHERE id=$1 AND company_id=$2',
    [req.params.convId, req.user.companyId]
  );
  if (!c.length) return res.status(404).json({ error: 'Conversa não encontrada' });

  const { rows } = await pool.query(
    `INSERT INTO notes (conversation_id, user_id, body) VALUES ($1,$2,$3)
     RETURNING id, body, created_at`,
    [req.params.convId, req.user.id, body]
  );
  res.status(201).json({ ...rows[0], author_name: req.user.name });
});

router.delete('/:id', authCompany, async (req, res) => {
  await pool.query(`
    DELETE FROM notes n USING conversations c
    WHERE n.id=$1 AND n.conversation_id = c.id AND c.company_id=$2
  `, [req.params.id, req.user.companyId]);
  res.json({ success: true });
});

module.exports = router;
