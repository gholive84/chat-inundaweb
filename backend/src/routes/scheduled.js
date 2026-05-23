const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authCompany } = require('../middleware/auth');

// Lista por contato
router.get('/contact/:contactId', authCompany, async (req, res) => {
  try {
    const { rows: ct } = await pool.query(
      'SELECT 1 FROM contacts WHERE id=$1 AND company_id=$2',
      [req.params.contactId, req.user.companyId]
    );
    if (!ct.length) return res.status(404).json({ error: 'Contato não encontrado' });
    const { rows } = await pool.query(`
      SELECT s.id, s.body, s.scheduled_for, s.status, s.sent_at, s.error, s.created_at,
             i.id AS instance_id, i.display_name AS instance_label, i.instance_name,
             u.name AS author_name
      FROM scheduled_messages s
      JOIN whatsapp_instances i ON i.id = s.instance_id
      LEFT JOIN users u ON u.id = s.created_by
      WHERE s.contact_id=$1 AND s.company_id=$2
      ORDER BY s.scheduled_for DESC
    `, [req.params.contactId, req.user.companyId]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Erro interno' }); }
});

router.post('/contact/:contactId', authCompany, async (req, res) => {
  try {
    const { body, scheduled_for, instance_id } = req.body;
    if (!body?.trim()) return res.status(400).json({ error: 'Mensagem obrigatória' });
    if (!scheduled_for) return res.status(400).json({ error: 'Data/hora obrigatórias' });
    if (!instance_id) return res.status(400).json({ error: 'Selecione a caixa' });
    // 30s de margem pra cobrir clock skew + latencia de rede
    if (new Date(scheduled_for).getTime() < Date.now() - 30000) {
      return res.status(400).json({ error: 'Data deve ser no futuro' });
    }

    // Valida ownership de contato + instancia
    const { rows: ck } = await pool.query(
      `SELECT
         (SELECT 1 FROM contacts WHERE id=$1 AND company_id=$3) AS c_ok,
         (SELECT 1 FROM whatsapp_instances WHERE id=$2 AND company_id=$3) AS i_ok`,
      [req.params.contactId, instance_id, req.user.companyId]
    );
    if (!ck[0]?.c_ok) return res.status(404).json({ error: 'Contato não encontrado' });
    if (!ck[0]?.i_ok) return res.status(404).json({ error: 'Caixa não encontrada' });

    const { rows } = await pool.query(`
      INSERT INTO scheduled_messages (company_id, contact_id, instance_id, created_by, body, scheduled_for)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, body, scheduled_for, status
    `, [req.user.companyId, req.params.contactId, instance_id, req.user.id, body, scheduled_for]);
    res.status(201).json(rows[0]);
  } catch (err) { console.error('POST /scheduled', err); res.status(500).json({ error: 'Erro interno' }); }
});

router.delete('/:id', authCompany, async (req, res) => {
  try {
    await pool.query(
      `UPDATE scheduled_messages SET status='cancelled' WHERE id=$1 AND company_id=$2 AND status='pending'`,
      [req.params.id, req.user.companyId]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Erro interno' }); }
});

module.exports = router;
