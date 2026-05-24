const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { pool } = require('../config/database');
const { authCompany, authRole } = require('../middleware/auth');
// authRole nao tava importado em todos os endpoints? checando — sim, ja importado.
const evolution = require('../providers/evolution');

// Lista instancias da company com lista de agentes atribuidos
router.get('/', authCompany, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT i.id, i.provider, i.instance_name, i.display_name, i.phone_number, i.status, i.last_event_at, i.created_at,
        COALESCE((
          SELECT json_agg(json_build_object('id', u.id, 'name', u.name, 'avatar_url', u.avatar_url))
          FROM instance_agents ia JOIN users u ON u.id = ia.user_id
          WHERE ia.instance_id = i.id
        ), '[]'::json) AS agents
      FROM whatsapp_instances i
      WHERE i.company_id=$1 ORDER BY i.created_at DESC
    `, [req.user.companyId]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Erro interno' }); }
});

// Limite + uso atual de caixas pra empresa do usuario logado
router.get('/limits', authCompany, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT COALESCE(max_instances, 1) AS max_instances,
              (SELECT COUNT(*) FROM whatsapp_instances WHERE company_id=c.id) AS used
       FROM companies c WHERE id=$1`,
      [req.user.companyId]
    );
    const r = rows[0] || { max_instances: 1, used: 0 };
    res.json({
      max: parseInt(r.max_instances),
      used: parseInt(r.used),
      remaining: Math.max(0, parseInt(r.max_instances) - parseInt(r.used)),
    });
  } catch (err) { res.status(500).json({ error: 'Erro interno' }); }
});

// Atribuir/remover agente a uma instancia
router.post('/:id/agents', authCompany, authRole('owner'), async (req, res) => {
  try {
    const { user_id } = req.body;
    // valida que instancia pertence à company
    const { rows: inst } = await pool.query(
      'SELECT id FROM whatsapp_instances WHERE id=$1 AND company_id=$2',
      [req.params.id, req.user.companyId]
    );
    if (!inst.length) return res.status(404).json({ error: 'Instância não encontrada' });
    // valida que user pertence à company (via primary company_id OU via membership)
    const { rows: usr } = await pool.query(
      `SELECT u.id FROM users u
       WHERE u.id=$1 AND (
         u.company_id=$2
         OR EXISTS (SELECT 1 FROM user_memberships m WHERE m.user_id=u.id AND m.company_id=$2)
       )`,
      [user_id, req.user.companyId]
    );
    if (!usr.length) return res.status(404).json({ error: 'Usuário não pertence à empresa' });
    await pool.query(
      'INSERT INTO instance_agents (instance_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [req.params.id, user_id]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Erro interno' }); }
});

router.delete('/:id/agents/:userId', authCompany, authRole('owner'), async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM instance_agents WHERE instance_id=$1 AND user_id=$2
         AND instance_id IN (SELECT id FROM whatsapp_instances WHERE company_id=$3)`,
      [req.params.id, req.params.userId, req.user.companyId]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Erro interno' }); }
});

// Atualizar display_name da instancia (caixa)
router.put('/:id', authCompany, authRole('owner'), async (req, res) => {
  try {
    const { display_name } = req.body;
    await pool.query(
      'UPDATE whatsapp_instances SET display_name=$1 WHERE id=$2 AND company_id=$3',
      [display_name || null, req.params.id, req.user.companyId]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Erro interno' }); }
});

// Cria uma instancia + chama o provider pra inicializar + retorna QR
// Apenas owners criam caixas. Limite por empresa via companies.max_instances (config no Super Admin).
router.post('/', authCompany, authRole('owner'), async (req, res) => {
  try {
    const { display_name, provider = 'evolution' } = req.body;

    // Checa limite ANTES de criar instancia/chamar provider
    const { rows: lim } = await pool.query(
      `SELECT COALESCE(max_instances, 1) AS max_instances,
              (SELECT COUNT(*) FROM whatsapp_instances WHERE company_id=c.id) AS used
       FROM companies c WHERE id=$1`,
      [req.user.companyId]
    );
    const maxAllowed = parseInt(lim[0]?.max_instances ?? 1);
    const usedNow = parseInt(lim[0]?.used ?? 0);
    if (usedNow >= maxAllowed) {
      return res.status(403).json({
        error: `Limite de caixas atingido (${usedNow}/${maxAllowed}). Contate o administrador da plataforma para aumentar.`,
      });
    }

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

// Reconfigura o webhook no Evolution (caixas antigas que nao tem MESSAGES_UPDATE/DELETE)
router.post('/:id/refresh-webhook', authCompany, authRole('owner'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT instance_name, webhook_token FROM whatsapp_instances WHERE id=$1 AND company_id=$2',
      [req.params.id, req.user.companyId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Caixa não encontrada' });
    await evolution.updateWebhook(rows[0].instance_name, rows[0].webhook_token);
    res.json({ success: true });
  } catch (err) {
    console.error('POST /instances/:id/refresh-webhook', err);
    res.status(500).json({ error: err.message || 'Erro interno' });
  }
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
