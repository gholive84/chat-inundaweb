// AI Knowledge base por caixa: arquivos + URLs como contexto
// MVP simples — armazena texto extraido e injeta no system_prompt no maybeRespond
const express = require('express');
const router = express.Router();
const multer = require('multer');
const axios = require('axios');
const { pool } = require('../config/database');
const { authCompany, authRole } = require('../middleware/auth');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const MAX_CONTENT_CHARS = 50000;

async function extractTextFromFile(buf, mime, filename) {
  if (mime?.startsWith('text/') || /\.(txt|md|csv|json)$/i.test(filename || '')) {
    return buf.toString('utf-8').slice(0, MAX_CONTENT_CHARS);
  }
  return null;
}

async function extractTextFromUrl(url) {
  try {
    const { data } = await axios.get(url, { timeout: 15000, maxContentLength: 5 * 1024 * 1024 });
    if (typeof data === 'string') {
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

// Helper: valida que instance_id pertence à company
async function assertInstanceId(instance_id, companyId, res) {
  const id = parseInt(instance_id);
  if (!id) { res.status(400).json({ error: 'instance_id obrigatório' }); return null; }
  const { rows } = await pool.query(
    'SELECT id FROM whatsapp_instances WHERE id=$1 AND company_id=$2',
    [id, companyId]
  );
  if (!rows.length) { res.status(404).json({ error: 'Caixa não encontrada' }); return null; }
  return id;
}

// Lista KB de uma caixa
router.get('/', authCompany, async (req, res) => {
  const instanceId = await assertInstanceId(req.query.instance_id, req.user.companyId, res);
  if (!instanceId) return;
  const { rows } = await pool.query(
    `SELECT id, kind, title, source, mime, size_bytes, LEFT(content, 200) AS preview, created_at
     FROM ai_knowledge WHERE instance_id=$1 ORDER BY created_at DESC`,
    [instanceId]
  );
  res.json(rows);
});

router.post('/file', authCompany, authRole('owner'), upload.single('file'), async (req, res) => {
  try {
    const instanceId = await assertInstanceId(req.body?.instance_id, req.user.companyId, res);
    if (!instanceId) return;
    if (!req.file) return res.status(400).json({ error: 'Arquivo obrigatório' });
    const title = req.body?.title || req.file.originalname;
    const content = await extractTextFromFile(req.file.buffer, req.file.mimetype, req.file.originalname);
    if (!content) return res.status(400).json({ error: 'Tipo de arquivo não suportado ainda (use .txt, .md, .csv, .json)' });
    const { rows } = await pool.query(
      `INSERT INTO ai_knowledge (company_id, instance_id, kind, title, source, mime, size_bytes, content, created_by)
       VALUES ($1,$2,'file',$3,$4,$5,$6,$7,$8) RETURNING id, title, kind`,
      [req.user.companyId, instanceId, title, req.file.originalname, req.file.mimetype, req.file.size, content, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('POST /knowledge/file', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.post('/url', authCompany, authRole('owner'), async (req, res) => {
  try {
    const instanceId = await assertInstanceId(req.body?.instance_id, req.user.companyId, res);
    if (!instanceId) return;
    const { url, title } = req.body;
    if (!url) return res.status(400).json({ error: 'URL obrigatório' });
    const content = await extractTextFromUrl(url);
    if (!content) return res.status(400).json({ error: 'Não consegui ler conteúdo da URL' });
    const { rows } = await pool.query(
      `INSERT INTO ai_knowledge (company_id, instance_id, kind, title, source, mime, size_bytes, content, created_by)
       VALUES ($1,$2,'url',$3,$4,'text/html',$5,$6,$7) RETURNING id, title, kind`,
      [req.user.companyId, instanceId, title || url, url, Buffer.byteLength(content), content, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('POST /knowledge/url', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.post('/text', authCompany, authRole('owner'), async (req, res) => {
  try {
    const instanceId = await assertInstanceId(req.body?.instance_id, req.user.companyId, res);
    if (!instanceId) return;
    const { title, content } = req.body;
    if (!title || !content) return res.status(400).json({ error: 'title e content obrigatórios' });
    const trimmed = String(content).slice(0, MAX_CONTENT_CHARS);
    const { rows } = await pool.query(
      `INSERT INTO ai_knowledge (company_id, instance_id, kind, title, source, mime, size_bytes, content, created_by)
       VALUES ($1,$2,'text',$3,NULL,'text/plain',$4,$5,$6) RETURNING id, title, kind`,
      [req.user.companyId, instanceId, title, Buffer.byteLength(trimmed), trimmed, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.delete('/:id', authCompany, authRole('owner'), async (req, res) => {
  await pool.query(
    `DELETE FROM ai_knowledge k
     WHERE k.id=$1 AND EXISTS (
       SELECT 1 FROM whatsapp_instances wi WHERE wi.id=k.instance_id AND wi.company_id=$2
     )`,
    [req.params.id, req.user.companyId]
  );
  res.json({ success: true });
});

module.exports = router;
