const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');

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

    await client.query('COMMIT');

    const token = jwt.sign(
      { id: usr[0].id, companyId: company.id, role: usr[0].role, name: usr[0].name, email: usr[0].email, type: 'agent' },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '30d' }
    );
    res.status(201).json({ token, user: usr[0], company });
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
      `SELECT u.id, u.company_id, u.name, u.email, u.password_hash, u.role, u.active,
              c.id AS c_id, c.name AS c_name, c.slug AS c_slug
       FROM users u JOIN companies c ON c.id = u.company_id
       WHERE u.email=$1 AND u.active=TRUE AND c.active=TRUE LIMIT 1`,
      [email]
    );
    if (!rows.length) return res.status(401).json({ error: 'Credenciais inválidas' });
    const u = rows[0];
    const ok = await bcrypt.compare(password, u.password_hash);
    if (!ok) return res.status(401).json({ error: 'Credenciais inválidas' });

    await pool.query('UPDATE users SET last_seen_at = NOW() WHERE id=$1', [u.id]);

    const token = jwt.sign(
      { id: u.id, companyId: u.company_id, role: u.role, name: u.name, email: u.email, type: 'agent' },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '30d' }
    );
    res.json({
      token,
      user: { id: u.id, name: u.name, email: u.email, role: u.role },
      company: { id: u.c_id, name: u.c_name, slug: u.c_slug },
    });
  } catch (err) {
    console.error('POST /auth/login', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

module.exports = router;
