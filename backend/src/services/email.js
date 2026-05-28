// SMTP wrapper. Sem env vars → no-op (não quebra a app).
// Variaveis: SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_FROM
const nodemailer = require('nodemailer');

let _transporter = null;

function getTransporter() {
  if (_transporter) return _transporter;
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) return null;
  const port = parseInt(process.env.SMTP_PORT) || 587;
  const secure = process.env.SMTP_SECURE
    ? /^(true|1|yes)$/i.test(process.env.SMTP_SECURE)
    : port === 465;
  _transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return _transporter;
}

async function sendMail({ to, subject, html, text }) {
  const t = getTransporter();
  if (!t || !to) {
    if (!t) console.log('[email] SMTP nao configurado — skipping');
    return { skipped: true };
  }
  try {
    const info = await t.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to, subject, html, text,
    });
    console.log('[email] enviado:', info.messageId, '→', to);
    return info;
  } catch (err) {
    console.error('[email] falha:', err.message);
    return { error: err.message };
  }
}

// Alerta de desconexão da caixa (manda pra todos owners da company)
async function sendDisconnectAlert({ companyId, instanceName, displayName }) {
  if (!process.env.SMTP_HOST) return { skipped: true };
  const { pool } = require('../config/database');
  try {
    // Pega owners ativos da company (via membership)
    const { rows: owners } = await pool.query(
      `SELECT DISTINCT u.email, u.name FROM users u
       LEFT JOIN user_memberships m ON m.user_id = u.id AND m.company_id = $1
       WHERE u.active = TRUE
         AND (m.role = 'owner' OR (u.company_id = $1 AND u.role = 'owner'))`,
      [companyId]
    );
    if (!owners.length) return { skipped: 'no owners' };
    const name = displayName || instanceName;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #1a2944;">
        <h2 style="color: #dc2626; margin-bottom: 8px;">⚠ Caixa WhatsApp desconectada</h2>
        <p>Sua caixa <strong>${name}</strong> perdeu a conexão com o WhatsApp e <strong>não consegue enviar nem receber mensagens</strong> até ser reconectada.</p>
        <p style="margin-top: 20px;">
          <a href="https://chat.inundaweb.com.br/app/connect"
             style="background: #00D4E8; color: #0A1628; padding: 10px 18px; border-radius: 8px;
                    text-decoration: none; font-weight: 600; display: inline-block;">
            Reconectar agora →
          </a>
        </p>
        <p style="color: #64748b; font-size: 12px; margin-top: 24px;">
          Chat Inunda — alerta automático
        </p>
      </div>
    `;
    const subject = `⚠ WhatsApp "${name}" desconectado`;
    const promises = owners.map((o) => sendMail({ to: o.email, subject, html }));
    return Promise.allSettled(promises);
  } catch (e) {
    console.error('[disconnect alert email]', e.message);
    return { error: e.message };
  }
}

module.exports = { sendMail, sendDisconnectAlert };
