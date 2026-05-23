// Rotas de Super Admin — controle global de empresas e usuarios
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { pool } = require('../config/database');
const { authSuperAdmin } = require('../middleware/auth');

// Aplica em tudo abaixo
router.use(authSuperAdmin);

// ── COMPANIES ────────────────────────────────────────────────────────
router.get('/companies', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT c.id, c.slug, c.name, c.email, c.active, c.max_agents, c.created_at,
        (SELECT COUNT(*) FROM users u WHERE u.company_id = c.id) AS users_count,
        (SELECT COUNT(*) FROM conversations cv WHERE cv.company_id = c.id) AS conversations_count,
        (SELECT COUNT(*) FROM whatsapp_instances i WHERE i.company_id = c.id) AS instances_count
      FROM companies c
      ORDER BY c.created_at DESC
    `);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Erro interno' }); }
});

router.put('/companies/:id', async (req, res) => {
  try {
    const { name, email, active, max_agents } = req.body;
    await pool.query(
      'UPDATE companies SET name=$1, email=$2, active=$3, max_agents=$4 WHERE id=$5',
      [name, email || null, active ?? true, max_agents ?? 10, req.params.id]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Erro interno' }); }
});

// Hard delete em cascade (cuidado!)
router.delete('/companies/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM companies WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /admin/companies', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ── USERS ────────────────────────────────────────────────────────────
router.get('/users', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT u.id, u.name, u.email, u.role, u.active, u.is_super_admin, u.created_at,
             u.last_seen_at,
             COALESCE(json_agg(
               json_build_object('id', c.id, 'name', c.name, 'role', m.role)
             ) FILTER (WHERE c.id IS NOT NULL), '[]'::json) AS memberships
      FROM users u
      LEFT JOIN user_memberships m ON m.user_id = u.id
      LEFT JOIN companies c ON c.id = m.company_id
      GROUP BY u.id
      ORDER BY u.is_super_admin DESC, u.created_at DESC
    `);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Erro interno' }); }
});

router.put('/users/:id', async (req, res) => {
  try {
    const { name, email, active, password, is_super_admin } = req.body;
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      await pool.query(
        'UPDATE users SET name=$1, email=$2, active=$3, password_hash=$4, is_super_admin=$5 WHERE id=$6',
        [name, email, active ?? true, hash, !!is_super_admin, req.params.id]
      );
    } else {
      await pool.query(
        'UPDATE users SET name=$1, email=$2, active=$3, is_super_admin=$4 WHERE id=$5',
        [name, email, active ?? true, !!is_super_admin, req.params.id]
      );
    }
    res.json({ success: true });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email já existe' });
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.delete('/users/:id', async (req, res) => {
  try {
    if (parseInt(req.params.id) === parseInt(req.user.id)) {
      return res.status(400).json({ error: 'Você não pode deletar a si mesmo' });
    }
    await pool.query('DELETE FROM users WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Erro interno' }); }
});

// ── INSTANCES (todas as caixas WhatsApp de todas as empresas) ────────
router.get('/instances', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT i.id, i.provider, i.instance_name, i.display_name, i.phone_number,
             i.status, i.last_event_at, i.created_at,
             c.id AS company_id, c.name AS company_name, c.slug AS company_slug,
             (SELECT COUNT(*) FROM conversations cv WHERE cv.instance_id = i.id) AS conversations_count,
             (SELECT COUNT(*) FROM messages m JOIN conversations cv ON cv.id = m.conversation_id WHERE cv.instance_id = i.id) AS messages_count,
             (SELECT json_agg(json_build_object('id', u.id, 'name', u.name))
               FROM instance_agents ia JOIN users u ON u.id = ia.user_id
               WHERE ia.instance_id = i.id) AS agents
      FROM whatsapp_instances i
      JOIN companies c ON c.id = i.company_id
      ORDER BY i.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error('GET /admin/instances', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ── MEMBERSHIPS ──────────────────────────────────────────────────────
router.post('/users/:userId/memberships', async (req, res) => {
  try {
    const { company_id, role } = req.body;
    if (!company_id) return res.status(400).json({ error: 'company_id obrigatório' });
    await pool.query(
      `INSERT INTO user_memberships (user_id, company_id, role) VALUES ($1,$2,$3)
       ON CONFLICT (user_id, company_id) DO UPDATE SET role = EXCLUDED.role`,
      [req.params.userId, company_id, role || 'agent']
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Erro interno' }); }
});

router.delete('/users/:userId/memberships/:companyId', async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM user_memberships WHERE user_id=$1 AND company_id=$2',
      [req.params.userId, req.params.companyId]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Erro interno' }); }
});

module.exports = router;
