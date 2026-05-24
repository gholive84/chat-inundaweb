const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { pool } = require('../config/database');
const { authCompany, authRole } = require('../middleware/auth');

router.get('/me', authCompany, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, slug, name, email, max_agents, sign_messages, signature_format, created_at FROM companies WHERE id=$1',
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
    const { name, email, sign_messages, signature_format } = req.body;
    await pool.query(
      `UPDATE companies SET name=$1, email=$2, sign_messages=$3, signature_format=$4 WHERE id=$5`,
      [name, email || null, !!sign_messages, signature_format || 'bold', req.user.companyId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// Lista agentes (todos users com vinculo à company — via company_id OU via user_memberships).
// Inclui owners pra serem atribuidos como atendentes de caixa.
router.get('/agents', authCompany, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT u.id, u.name, u.email, u.role, u.avatar_url, u.active,
              COALESCE(m.role, u.role) AS membership_role
       FROM users u
       LEFT JOIN user_memberships m ON m.user_id = u.id AND m.company_id = $1
       WHERE u.company_id = $1 OR m.company_id IS NOT NULL
       ORDER BY u.active DESC, u.name`,
      [req.user.companyId]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Erro interno' }); }
});

router.post('/agents', authCompany, authRole('owner'), async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'name, email e password obrigatórios' });
    if (password.length < 6) return res.status(400).json({ error: 'Senha precisa ter ao menos 6 caracteres' });
    if (!['owner', 'agent', 'viewer'].includes(role || 'agent')) return res.status(400).json({ error: 'Role inválido' });

    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO users (company_id, name, email, password_hash, role)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, name, email, role, active`,
      [req.user.companyId, name, email, hash, role || 'agent']
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email já existe' });
    console.error('POST /agents', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.put('/agents/:id', authCompany, authRole('owner'), async (req, res) => {
  try {
    const { name, email, password, role, active } = req.body;
    if (!name || !email) return res.status(400).json({ error: 'name e email obrigatórios' });
    if (role && !['owner', 'agent', 'viewer'].includes(role)) return res.status(400).json({ error: 'Role inválido' });

    // Não permitir o owner se autodesativar (evitar lock-out)
    if (parseInt(req.params.id) === parseInt(req.user.id) && active === false) {
      return res.status(400).json({ error: 'Você não pode se desativar' });
    }

    if (password) {
      if (password.length < 6) return res.status(400).json({ error: 'Senha precisa ter ao menos 6 caracteres' });
      const hash = await bcrypt.hash(password, 10);
      await pool.query(
        `UPDATE users SET name=$1, email=$2, password_hash=$3, role=$4, active=$5
         WHERE id=$6 AND company_id=$7`,
        [name, email, hash, role || 'agent', active ?? true, req.params.id, req.user.companyId]
      );
    } else {
      await pool.query(
        `UPDATE users SET name=$1, email=$2, role=$3, active=$4
         WHERE id=$5 AND company_id=$6`,
        [name, email, role || 'agent', active ?? true, req.params.id, req.user.companyId]
      );
    }
    res.json({ success: true });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email já existe' });
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.delete('/agents/:id', authCompany, authRole('owner'), async (req, res) => {
  try {
    if (parseInt(req.params.id) === parseInt(req.user.id)) {
      return res.status(400).json({ error: 'Você não pode deletar a si mesmo' });
    }
    // Garante que o agente pertence à mesma company do owner
    const { rows } = await pool.query(
      'SELECT 1 FROM users WHERE id=$1 AND company_id=$2',
      [req.params.id, req.user.companyId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Agente não encontrado' });
    // Remove memberships dessa company e desativa user (não hard delete pra preservar historico de mensagens)
    await pool.query(
      'DELETE FROM user_memberships WHERE user_id=$1 AND company_id=$2',
      [req.params.id, req.user.companyId]
    );
    // Se for o último membership, marca como inativo
    const { rows: rest } = await pool.query(
      'SELECT 1 FROM user_memberships WHERE user_id=$1',
      [req.params.id]
    );
    if (!rest.length) {
      await pool.query('UPDATE users SET active=FALSE WHERE id=$1', [req.params.id]);
    }
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /agents/:id', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

module.exports = router;
