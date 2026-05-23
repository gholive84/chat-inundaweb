const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');
const { authCompany } = require('../middleware/auth');

async function loadUserCompanies(userId) {
  const { rows } = await pool.query(`
    SELECT c.id, c.slug, c.name, m.role
    FROM user_memberships m
    JOIN companies c ON c.id = m.company_id
    WHERE m.user_id = $1 AND c.active = TRUE
    ORDER BY c.name
  `, [userId]);
  return rows;
}

function makeToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '30d' });
}

function slugify(name) {
  return String(name).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'company';
}

// Cria company + primeiro user (owner) numa transacao
router.post('/signup', async (req, res) => {
  const client = await pool.connect();
  try {
    const { companyName, name, email, password } = req.body;
    if (!companyName || !name || !email || !password)
      return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
    if (password.length < 6)
      return res.status(400).json({ error: 'Senha precisa ter ao menos 6 caracteres' });

    await client.query('BEGIN');

    // slug unico
    let base = slugify(companyName);
    let slug = base; let attempt = 1;
    while (true) {
      const { rows } = await client.query('SELECT 1 FROM companies WHERE slug=$1', [slug]);
      if (!rows.length) break;
      slug = `${base}-${++attempt}`;
    }

    const { rows: comp } = await client.query(
      'INSERT INTO companies (slug, name, email) VALUES ($1,$2,$3) RETURNING id, slug, name',
      [slug, companyName, email]
    );
    const company = comp[0];

    const hash = await bcrypt.hash(password, 10);
    const { rows: usr } = await client.query(
      `INSERT INTO users (company_id, name, email, password_hash, role)
       VALUES ($1,$2,$3,$4,'owner') RETURNING id, name, email, role`,
      [company.id, name, email, hash]
    );

    // CRM stages padrao
    const defaults = [
      ['novo',         'Novo Lead',       'blue',   0],
      ['contato',      'Em Contato',      'yellow', 1],
      ['negociacao',   'Negociação',      'purple', 2],
      ['fechado',      'Fechado',         'green',  3],
      ['perdido',      'Perdido',         'gray',   4],
    ];
    for (const [id, label, color, position] of defaults) {
      await client.query(
        'INSERT INTO crm_stages (id, company_id, label, color, position) VALUES ($1,$2,$3,$4,$5)',
        [id, company.id, label, color, position]
      );
    }

    // Cria membership inicial
    await client.query(
      'INSERT INTO user_memberships (user_id, company_id, role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
      [usr[0].id, company.id, 'owner']
    );

    await client.query('COMMIT');

    const token = makeToken({ id: usr[0].id, companyId: company.id, role: usr[0].role, name: usr[0].name, email: usr[0].email, type: 'agent', isSuperAdmin: false });
    const companies = await loadUserCompanies(usr[0].id);
    res.status(201).json({ token, user: { ...usr[0], is_super_admin: false }, company, companies });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') return res.status(409).json({ error: 'Email já cadastrado' });
    console.error('POST /auth/signup', err);
    res.status(500).json({ error: 'Erro interno' });
  } finally { client.release(); }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email e senha obrigatórios' });
    const { rows } = await pool.query(
      `SELECT u.id, u.company_id, u.name, u.email, u.password_hash, u.role, u.active, u.is_super_admin,
              c.id AS c_id, c.name AS c_name, c.slug AS c_slug, c.active AS c_active
       FROM users u JOIN companies c ON c.id = u.company_id
       WHERE u.email=$1 AND u.active=TRUE LIMIT 1`,
      [email]
    );
    if (!rows.length) return res.status(401).json({ error: 'Credenciais inválidas' });
    const u = rows[0];
    const ok = await bcrypt.compare(password, u.password_hash);
    if (!ok) return res.status(401).json({ error: 'Credenciais inválidas' });

    await pool.query('UPDATE users SET last_seen_at = NOW() WHERE id=$1', [u.id]);

    const companies = await loadUserCompanies(u.id);
    let active = companies.find((c) => c.id === u.company_id) || companies[0];
    if (!active) return res.status(403).json({ error: 'Nenhuma empresa ativa pra este usuário' });

    const token = makeToken({
      id: u.id, companyId: active.id, role: active.role, name: u.name, email: u.email,
      type: 'agent', isSuperAdmin: !!u.is_super_admin,
    });
    res.json({
      token,
      user: { id: u.id, name: u.name, email: u.email, role: active.role, is_super_admin: !!u.is_super_admin },
      company: { id: active.id, name: active.name, slug: active.slug },
      companies,
    });
  } catch (err) {
    console.error('POST /auth/login', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// Lista empresas que o user pertence (usado pelo seletor)
router.get('/companies', authCompany, async (req, res) => {
  const companies = await loadUserCompanies(req.user.id);
  res.json({ companies, currentCompanyId: req.user.companyId });
});

// Trocar de empresa: gera novo token com novo companyId
router.post('/switch-company', authCompany, async (req, res) => {
  try {
    const { company_id } = req.body;
    if (!company_id) return res.status(400).json({ error: 'company_id obrigatório' });
    const companies = await loadUserCompanies(req.user.id);
    let target = companies.find((c) => c.id === parseInt(company_id));
    // Super admin pode trocar pra qualquer empresa (mesmo sem membership)
    if (!target && req.user.isSuperAdmin) {
      const { rows } = await pool.query('SELECT id, slug, name FROM companies WHERE id=$1', [company_id]);
      if (rows.length) target = { ...rows[0], role: 'owner' };
    }
    if (!target) return res.status(403).json({ error: 'Você não tem acesso a essa empresa' });
    const token = makeToken({
      id: req.user.id, companyId: target.id, role: target.role,
      name: req.user.name, email: req.user.email, type: 'agent',
      isSuperAdmin: !!req.user.isSuperAdmin,
    });
    res.json({
      token,
      company: { id: target.id, name: target.name, slug: target.slug },
      user: { id: req.user.id, name: req.user.name, email: req.user.email, role: target.role, is_super_admin: !!req.user.isSuperAdmin },
      companies,
    });
  } catch (err) {
    console.error('POST /auth/switch-company', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// Cria nova empresa pra um usuario logado (vira owner)
router.post('/companies', authCompany, async (req, res) => {
  const client = await pool.connect();
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Nome obrigatório' });

    await client.query('BEGIN');
    // slug unico
    const slugify = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'company';
    let base = slugify(name);
    let slug = base; let attempt = 1;
    while (true) {
      const { rows } = await client.query('SELECT 1 FROM companies WHERE slug=$1', [slug]);
      if (!rows.length) break;
      slug = `${base}-${++attempt}`;
    }
    const { rows: comp } = await client.query(
      'INSERT INTO companies (slug, name) VALUES ($1,$2) RETURNING id, slug, name',
      [slug, name]
    );
    await client.query(
      'INSERT INTO user_memberships (user_id, company_id, role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
      [req.user.id, comp[0].id, 'owner']
    );
    // CRM stages padrao
    const defaults = [
      ['novo','Novo Lead','blue',0],['contato','Em Contato','yellow',1],
      ['negociacao','Negociação','purple',2],['fechado','Fechado','green',3],
      ['perdido','Perdido','gray',4],
    ];
    for (const [id, label, color, position] of defaults) {
      await client.query(
        'INSERT INTO crm_stages (id, company_id, label, color, position) VALUES ($1,$2,$3,$4,$5)',
        [id, comp[0].id, label, color, position]
      );
    }
    await client.query('COMMIT');
    res.status(201).json({ company: comp[0], companies: await loadUserCompanies(req.user.id) });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('POST /auth/companies', err);
    res.status(500).json({ error: 'Erro interno' });
  } finally { client.release(); }
});

module.exports = router;
