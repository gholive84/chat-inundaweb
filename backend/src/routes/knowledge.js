// AI Knowledge base: arquivos + URLs como contexto
// MVP simples — armazena texto extraido e injeta no system_prompt no maybeRespond
const express = require('express');
const router = express.Router();
const multer = require('multer');
const axios = require('axios');
const { pool } = require('../config/database');
const { authCompany, authRole } = require('../middleware/auth');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const MAX_CONTENT_CHARS = 50000;  // limite por entrada

async function extractTextFromFile(buf, mime, filename) {
  // MVP: trata só texto. PDF/DOCX requer libs adicionais.
  if (mime?.startsWith('text/') || /\.(txt|md|csv|json)$/i.test(filename || '')) {
    return buf.toString('utf-8').slice(0, MAX_CONTENT_CHARS);
  }
  // Pra PDF/DOCX futuro: pdf-parse + mammoth
  return null;
}

async function extractTextFromUrl(url) {
  try {
    const { data } = await axios.get(url, { timeout: 15000, maxContentLength: 5 * 1024 * 1024 });
    if (typeof data === 'string') {
      // strip HTML tags rudimentarmente
      return data
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MAX_CONTENT_CHARS);
    }
    return JSON.stringify(data).slice(0, MAX_CONTENT_CHARS);
  } catch (e) {
    return null;
  }
}

router.get('/', authCompany, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, kind, title, source, mime, size_bytes, LEFT(content, 200) AS preview, created_at
     FROM ai_knowledge WHERE company_id=$1 ORDER BY created_at DESC`,
    [req.user.companyId]
  );
  res.json(rows);
});

router.post('/file', authCompany, authRole('owner'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Arquivo obrigatório' });
    const title = req.body?.title || req.file.originalname;
    const content = await extractTextFromFile(req.file.buffer, req.file.mimetype, req.file.originalname);
    if (!content) return res.status(400).json({ error: 'Tipo de arquivo não suportado ainda (use .txt, .md, .csv, .json)' });
    const { rows } = await pool.query(
      `INSERT INTO ai_knowledge (company_id, kind, title, source, mime, size_bytes, content, created_by)
       VALUES ($1,'file',$2,$3,$4,$5,$6,$7) RETURNING id, title, kind`,
      [req.user.companyId, title, req.file.originalname, req.file.mimetype, req.file.size, content, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('POST /knowledge/file', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.post('/url', authCompany, authRole('owner'), async (req, res) => {
  try {
    const { url, title } = req.body;
    if (!url) return res.status(400).json({ error: 'URL obrigatório' });
    const content = await extractTextFromUrl(url);
    if (!content) return res.status(400).json({ error: 'Não consegui ler conteúdo da URL' });
    const { rows } = await pool.query(
      `INSERT INTO ai_knowledge (company_id, kind, title, source, mime, size_bytes, content, created_by)
       VALUES ($1,'url',$2,$3,'text/html',$4,$5,$6) RETURNING id, title, kind`,
      [req.user.companyId, title || url, url, Buffer.byteLength(content), content, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('POST /knowledge/url', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.post('/text', authCompany, authRole('owner'), async (req, res) => {
  try {
    const { title, content } = req.body;
    if (!title || !content) return res.status(400).json({ error: 'title e content obrigatórios' });
    const trimmed = String(content).slice(0, MAX_CONTENT_CHARS);
    const { rows } = await pool.query(
      `INSERT INTO ai_knowledge (company_id, kind, title, source, mime, size_bytes, content, created_by)
       VALUES ($1,'text',$2,NULL,'text/plain',$3,$4,$5) RETURNING id, title, kind`,
      [req.user.companyId, title, Buffer.byteLength(trimmed), trimmed, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.delete('/:id', authCompany, authRole('owner'), async (req, res) => {
  await pool.query('DELETE FROM ai_knowledge WHERE id=$1 AND company_id=$2',
    [req.params.id, req.user.companyId]);
  res.json({ success: true });
});

module.exports = router;
