const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authCompany } = require('../middleware/auth');

// Lista conversas (com filtros: status, assigned, search)
router.get('/', authCompany, async (req, res) => {
  try {
    const { status = 'open', assigned, search, limit = 100 } = req.query;
    const where = ['c.company_id = $1'];
    const params = [req.user.companyId];

    if (status && status !== 'all') { params.push(status); where.push(`c.status = $${params.length}`); }
    if (assigned === 'me') { params.push(req.user.id); where.push(`c.assigned_to_user_id = $${params.length}`); }
    else if (assigned === 'unassigned') where.push('c.assigned_to_user_id IS NULL');
    else if (assigned && assigned !== 'all') { params.push(assigned); where.push(`c.assigned_to_user_id = $${params.length}`); }
    if (search) { params.push(`%${search}%`); where.push(`(ct.name ILIKE $${params.length} OR ct.phone ILIKE $${params.length} OR c.last_message_preview ILIKE $${params.length})`); }

    params.push(parseInt(limit));
    const sql = `
      SELECT c.id, c.status, c.ai_enabled, c.ai_paused_until, c.unread_count,
             c.last_message_at, c.last_message_preview, c.assigned_to_user_id,
             ct.id AS contact_id, ct.phone, ct.name AS contact_name, ct.push_name, ct.profile_pic_url,
             ct.crm_stage,
             u.name AS agent_name, u.avatar_url AS agent_avatar_url
      FROM conversations c
      JOIN contacts ct ON ct.id = c.contact_id
      LEFT JOIN users u ON u.id = c.assigned_to_user_id
      WHERE ${where.join(' AND ')}
      ORDER BY c.last_message_at DESC NULLS LAST
      LIMIT $${params.length}
    `;
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('GET /conversations', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.get('/:id', authCompany, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT c.*, ct.phone, ct.name AS contact_name, ct.push_name, ct.profile_pic_url, ct.email AS contact_email,
             ct.notes AS contact_notes, ct.crm_stage,
             u.name AS agent_name, u.avatar_url AS agent_avatar_url,
             i.instance_name, i.status AS instance_status
      FROM conversations c
      JOIN contacts ct ON ct.id = c.contact_id
      LEFT JOIN users u ON u.id = c.assigned_to_user_id
      JOIN whatsapp_instances i ON i.id = c.instance_id
      WHERE c.id=$1 AND c.company_id=$2
    `, [req.params.id, req.user.companyId]);
    if (!rows.length) return res.status(404).json({ error: 'Conversa não encontrada' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Erro interno' }); }
});

// Toggle IA
router.post('/:id/ai-toggle', authCompany, async (req, res) => {
  try {
    const { enabled } = req.body;
    await pool.query(
      'UPDATE conversations SET ai_enabled=$1, ai_paused_until=NULL WHERE id=$2 AND company_id=$3',
      [!!enabled, req.params.id, req.user.companyId]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Erro interno' }); }
});

// Pausa IA por N segundos (chamado quando agente digita)
router.post('/:id/ai-pause', authCompany, async (req, res) => {
  try {
    const { seconds = 600 } = req.body;
    await pool.query(
      `UPDATE conversations SET ai_paused_until = NOW() + ($1 || ' seconds')::interval
       WHERE id=$2 AND company_id=$3`,
      [String(seconds), req.params.id, req.user.companyId]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Erro interno' }); }
});

router.post('/:id/assign', authCompany, async (req, res) => {
  try {
    const { user_id } = req.body;
    await pool.query(
      'UPDATE conversations SET assigned_to_user_id=$1 WHERE id=$2 AND company_id=$3',
      [user_id || null, req.params.id, req.user.companyId]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Erro interno' }); }
});

router.post('/:id/status', authCompany, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['open', 'resolved', 'archived'].includes(status)) return res.status(400).json({ error: 'Status inválido' });
    await pool.query(
      'UPDATE conversations SET status=$1 WHERE id=$2 AND company_id=$3',
      [status, req.params.id, req.user.companyId]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Erro interno' }); }
});

router.post('/:id/read', authCompany, async (req, res) => {
  try {
    await pool.query(
      'UPDATE conversations SET unread_count=0 WHERE id=$1 AND company_id=$2',
      [req.params.id, req.user.companyId]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Erro interno' }); }
});

module.exports = router;
