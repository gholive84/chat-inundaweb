// Templates de resposta rapida (quick_replies) — com opcional anexo de mídia
const express = require('express');
const router = express.Router();
const multer = require('multer');
const { pool } = require('../config/database');
const { authCompany, authRole } = require('../middleware/auth');
const storage = require('../services/storage');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

function detectKind(mime) {
  if (!mime) return 'document';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'document';
}

function normalizeShortcut(s) {
  let v = String(s || '').trim().toLowerCase().replace(/^\/+/, '');
  return '/' + v.replace(/\s+/g, '-').replace(/[^a-z0-9_\-]/g, '').slice(0, 49);
}

router.get('/', authCompany, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, shortcut, title, body, media_url, media_mime, media_filename, media_type, created_at
       FROM quick_replies WHERE company_id=$1 ORDER BY shortcut`,
      [req.user.companyId]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Erro interno' }); }
});

router.post('/', authCompany, authRole('owner'), upload.single('file'), async (req, res) => {
  try {
    const shortcut = normalizeShortcut(req.body?.shortcut);
    if (shortcut.length < 2) return res.status(400).json({ error: 'Atalho inválido (ex: /oi)' });
    const title = (req.body?.title || '').slice(0, 120);
    const body = (req.body?.body || '').trim();
    if (!body && !req.file) return res.status(400).json({ error: 'Texto ou arquivo obrigatório' });

    let mediaUrl = null, mediaMime = null, mediaFilename = null, mediaType = null;
    if (req.file) {
      mediaMime = req.file.mimetype;
      mediaFilename = req.file.originalname;
      mediaType = detectKind(mediaMime);
      if (!(await storage.hasS3())) return res.status(400).json({ error: 'S3 não configurado' });
      const up = await storage.uploadBuffer({
        companyId: req.user.companyId,
        buffer: req.file.buffer, mimetype: mediaMime,
        filename: mediaFilename, folder: 'templates',
      });
      mediaUrl = up.url;
    }
    const { rows } = await pool.query(
      `INSERT INTO quick_replies (company_id, shortcut, title, body, media_url, media_mime, media_filename, media_type, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.user.companyId, shortcut, title || null, body || null, mediaUrl, mediaMime, mediaFilename, mediaType, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Atalho já existe' });
    console.error('POST /templates', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.put('/:id', authCompany, authRole('owner'), upload.single('file'), async (req, res) => {
  try {
    const { rows: cur } = await pool.query(
      'SELECT * FROM quick_replies WHERE id=$1 AND company_id=$2',
      [req.params.id, req.user.companyId]
    );
    if (!cur.length) return res.status(404).json({ error: 'Template não encontrado' });

    const shortcut = req.body?.shortcut ? normalizeShortcut(req.body.shortcut) : cur[0].shortcut;
    const title = req.body?.title !== undefined ? (req.body.title || '').slice(0, 120) : cur[0].title;
    const body = req.body?.body !== undefined ? (req.body.body || '').trim() : cur[0].body;
    let mediaUrl = cur[0].media_url, mediaMime = cur[0].media_mime,
        mediaFilename = cur[0].media_filename, mediaType = cur[0].media_type;
    // Body opcional indica remover mídia
    if (req.body?.remove_media === 'true' || req.body?.remove_media === true) {
      mediaUrl = null; mediaMime = null; mediaFilename = null; mediaType = null;
    }
    if (req.file) {
      mediaMime = req.file.mimetype;
      mediaFilename = req.file.originalname;
      mediaType = detectKind(mediaMime);
      if (!(await storage.hasS3())) return res.status(400).json({ error: 'S3 não configurado' });
      const up = await storage.uploadBuffer({
        companyId: req.user.companyId,
        buffer: req.file.buffer, mimetype: mediaMime,
        filename: mediaFilename, folder: 'templates',
      });
      mediaUrl = up.url;
    }
    await pool.query(
      `UPDATE quick_replies SET shortcut=$1, title=$2, body=$3,
         media_url=$4, media_mime=$5, media_filename=$6, media_type=$7
       WHERE id=$8`,
      [shortcut, title || null, body || null, mediaUrl, mediaMime, mediaFilename, mediaType, req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Atalho já existe' });
    console.error('PUT /templates', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.delete('/:id', authCompany, authRole('owner'), async (req, res) => {
  await pool.query('DELETE FROM quick_replies WHERE id=$1 AND company_id=$2',
    [req.params.id, req.user.companyId]);
  res.json({ success: true });
});

module.exports = router;
