const express = require('express');
const router = express.Router();
const multer = require('multer');
const { pool } = require('../config/database');
const { authCompany } = require('../middleware/auth');
const storage = require('../services/storage');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

function detectKind(mime) {
  if (!mime) return 'document';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'document';
}

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
             s.media_url, s.media_mime, s.media_filename, s.media_type,
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

// Aceita multipart (com mídia) OU JSON (texto puro). Mídia é opcional.
router.post('/contact/:contactId', authCompany, upload.single('file'), async (req, res) => {
  try {
    // Body pode vir de JSON ou FormData
    const body = (req.body?.body || '').trim();
    const scheduled_for = req.body?.scheduled_for;
    const instance_id = parseInt(req.body?.instance_id || '0');

    if (!body && !req.file) return res.status(400).json({ error: 'Texto ou arquivo obrigatório' });
    if (!scheduled_for) return res.status(400).json({ error: 'Data/hora obrigatórias' });
    if (!instance_id) return res.status(400).json({ error: 'Selecione a caixa' });
    if (new Date(scheduled_for).getTime() < Date.now() - 30000) {
      return res.status(400).json({ error: 'Data deve ser no futuro' });
    }

    const { rows: ck } = await pool.query(
      `SELECT
         (SELECT 1 FROM contacts WHERE id=$1 AND company_id=$3) AS c_ok,
         (SELECT 1 FROM whatsapp_instances WHERE id=$2 AND company_id=$3) AS i_ok`,
      [req.params.contactId, instance_id, req.user.companyId]
    );
    if (!ck[0]?.c_ok) return res.status(404).json({ error: 'Contato não encontrado' });
    if (!ck[0]?.i_ok) return res.status(404).json({ error: 'Caixa não encontrada' });

    // Upload mídia se houver
    let mediaUrl = null, mediaMime = null, mediaFilename = null, mediaType = null;
    if (req.file) {
      mediaMime = req.file.mimetype;
      mediaFilename = req.file.originalname;
      mediaType = detectKind(mediaMime);
      if (!(await storage.hasS3())) {
        return res.status(400).json({ error: 'Storage S3 não configurado — mídia em agendadas exige S3' });
      }
      try {
        const up = await storage.uploadBuffer({
          companyId: req.user.companyId,
          buffer: req.file.buffer, mimetype: mediaMime,
          filename: mediaFilename, folder: 'scheduled',
        });
        mediaUrl = up.url;
      } catch (e) { return res.status(500).json({ error: 'Falha ao subir mídia: ' + e.message }); }
    }

    const { rows } = await pool.query(`
      INSERT INTO scheduled_messages
        (company_id, contact_id, instance_id, created_by, body, scheduled_for,
         media_url, media_mime, media_filename, media_type)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING id, body, scheduled_for, status, media_url, media_filename, media_type
    `, [req.user.companyId, req.params.contactId, instance_id, req.user.id,
        body || '', scheduled_for, mediaUrl, mediaMime, mediaFilename, mediaType]);
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
