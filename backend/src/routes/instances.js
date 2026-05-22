const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { pool } = require('../config/database');
const { authCompany, authRole } = require('../middleware/auth');
const evolution = require('../providers/evolution');

// Lista instancias da company
router.get('/', authCompany, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, provider, instance_name, display_name, phone_number, status, last_event_at, created_at
       FROM whatsapp_instances WHERE company_id=$1 ORDER BY created_at DESC`,
      [req.user.companyId]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Erro interno' }); }
});

// Cria uma instancia + chama o provider pra inicializar + retorna QR
router.post('/', authCompany, authRole('owner', 'agent'), async (req, res) => {
  try {
    const { display_name, provider = 'evolution' } = req.body;
    const instanceName = `co${req.user.companyId}-${crypto.randomBytes(4).toString('hex')}`;
    const webhookToken = crypto.randomBytes(16).toString('hex');

    const { rows } = await pool.query(
      `INSERT INTO whatsapp_instances (company_id, provider, instance_name, display_name, status, webhook_token)
       VALUES ($1,$2,$3,$4,'connecting',$5) RETURNING id, instance_name, status`,
      [req.user.companyId, provider, instanceName, display_name || null, webhookToken]
    );
    const inst = rows[0];

    // Chama o provider — devolve QR (base64) ou erro
    let qr = null;
    try {
      const result = await evolution.createInstance({ instanceName, webhookToken });
      qr = result.qrcode || null;
      await pool.query(
        'UPDATE whatsapp_instances SET qr_code=$1, status=$2 WHERE id=$3',
        [qr, qr ? 'connecting' : 'pending', inst.id]
      );
    } catch (e) {
      console.error('Provider createInstance failed', e.message);
      await pool.query('UPDATE whatsapp_instances SET status=$1 WHERE id=$2', ['error', inst.id]);
    }

    res.status(201).json({ ...inst, qr_code: qr });
  } catch (err) {
    console.error('POST /instances', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// Pega QR/status atualizado
router.get('/:id/qr', authCompany, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, instance_name, status, qr_code FROM whatsapp_instances WHERE id=$1 AND company_id=$2',
      [req.params.id, req.user.companyId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Instância não encontrada' });
    const inst = rows[0];
    // Re-consulta o provider pra status mais recente
    try {
      const live = await evolution.getStatus(inst.instance_name);
      if (live?.status && live.status !== inst.status) {
        await pool.query('UPDATE whatsapp_instances SET status=$1 WHERE id=$2', [live.status, inst.id]);
        inst.status = live.status;
      }
      if (live?.qrcode) inst.qr_code = live.qrcode;
    } catch {}
    res.json(inst);
  } catch (err) { res.status(500).json({ error: 'Erro interno' }); }
});

router.post('/:id/disconnect', authCompany, authRole('owner'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT instance_name FROM whatsapp_instances WHERE id=$1 AND company_id=$2',
      [req.params.id, req.user.companyId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Não encontrada' });
    try { await evolution.disconnectInstance(rows[0].instance_name); } catch {}
    await pool.query('UPDATE whatsapp_instances SET status=$1 WHERE id=$2', ['disconnected', req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Erro interno' }); }
});

router.delete('/:id', authCompany, authRole('owner'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT instance_name FROM whatsapp_instances WHERE id=$1 AND company_id=$2',
      [req.params.id, req.user.companyId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Não encontrada' });
    try { await evolution.deleteInstance(rows[0].instance_name); } catch {}
    await pool.query('DELETE FROM whatsapp_instances WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Erro interno' }); }
});

module.exports = router;
