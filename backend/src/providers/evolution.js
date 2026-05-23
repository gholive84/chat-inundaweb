/**
 * Adapter Evolution API v2
 * Doc: https://doc.evolution-api.com/
 *
 * Endpoints usados:
 *   POST /instance/create           — cria instancia + retorna QR
 *   GET  /instance/connect/{name}   — pega QR atualizado
 *   GET  /instance/connectionState/{name}
 *   DELETE /instance/logout/{name}  — desconecta
 *   DELETE /instance/delete/{name}  — apaga
 *   POST /message/sendText/{name}   — envia texto
 */
const axios = require('axios');

const BASE = process.env.EVOLUTION_BASE_URL || 'http://localhost:8080';
const KEY  = process.env.EVOLUTION_API_KEY || '';
const PUBLIC_WEBHOOK = process.env.PUBLIC_WEBHOOK_URL || '';

const http = axios.create({
  baseURL: BASE,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json', apikey: KEY },
});

async function createInstance({ instanceName, webhookToken }) {
  const webhookUrl = PUBLIC_WEBHOOK
    ? PUBLIC_WEBHOOK.replace(/\/$/, '') + `/${instanceName}/${webhookToken}`
    : null;

  const { data } = await http.post('/instance/create', {
    instanceName,
    integration: 'WHATSAPP-BAILEYS',
    qrcode: true,
    ...(webhookUrl ? {
      webhook: {
        url: webhookUrl,
        events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE', 'QRCODE_UPDATED'],
        byEvents: false,
        base64: true,
      }
    } : {}),
  });
  // data.qrcode.base64 = "data:image/png;base64,..."
  return {
    qrcode: data?.qrcode?.base64 || null,
    instance: data?.instance || null,
  };
}

async function getStatus(instanceName) {
  try {
    const [{ data: connRes }, qrRes] = await Promise.all([
      http.get(`/instance/connectionState/${instanceName}`),
      http.get(`/instance/connect/${instanceName}`).catch(() => ({ data: null })),
    ]);
    const stateRaw = connRes?.instance?.state || connRes?.state;
    const state = ({ open: 'connected', connecting: 'connecting', close: 'disconnected' })[stateRaw] || stateRaw;
    return { status: state, qrcode: qrRes.data?.base64 || qrRes.data?.qrcode?.base64 || null };
  } catch (e) {
    return { status: 'error', qrcode: null };
  }
}

async function disconnectInstance(instanceName) {
  await http.delete(`/instance/logout/${instanceName}`);
}

async function deleteInstance(instanceName) {
  await http.delete(`/instance/delete/${instanceName}`);
}

async function sendText(instanceName, phone, text) {
  const number = String(phone).replace(/\D/g, '');
  const { data } = await http.post(`/message/sendText/${instanceName}`, {
    number,
    text,
  });
  return { id: data?.key?.id || data?.messageId || null, raw: data };
}

// kind: 'image' | 'video' | 'document' | 'audio'
async function sendMedia(instanceName, phone, { kind, base64, mimetype, fileName, caption }) {
  const number = String(phone).replace(/\D/g, '');
  if (kind === 'audio') {
    // Evolution tem endpoint dedicado pra audio (ptt-like)
    const { data } = await http.post(`/message/sendWhatsAppAudio/${instanceName}`, {
      number,
      audio: base64,
    });
    return { id: data?.key?.id || null, raw: data };
  }
  const { data } = await http.post(`/message/sendMedia/${instanceName}`, {
    number,
    mediatype: kind, // image | video | document
    mimetype,
    media: base64,
    fileName: fileName || (kind === 'image' ? 'image.jpg' : kind === 'video' ? 'video.mp4' : 'arquivo'),
    caption: caption || '',
  });
  return { id: data?.key?.id || null, raw: data };
}

// Baixa media descriptografada de uma mensagem
async function getMessageMediaBase64(instanceName, msg) {
  try {
    const { data } = await http.post(`/chat/getBase64FromMediaMessage/${instanceName}`, {
      message: msg,
      convertToMp4: false,
    });
    return data?.base64 || data?.media || null;
  } catch (e) {
    console.warn('[evo] getBase64FromMediaMessage falhou:', e.message);
    return null;
  }
}

// Marca msgs como lidas
async function markAsRead(instanceName, messages) {
  try {
    if (!messages?.length) return;
    await http.post(`/chat/markMessageAsRead/${instanceName}`, {
      readMessages: messages.map((m) => ({
        remoteJid: m.remoteJid, fromMe: !!m.fromMe, id: m.id,
      })),
    });
  } catch (e) { /* silent — nao critico */ }
}

// Envia indicador de presença (digitando.../gravando.../pausado)
// presence: 'composing' | 'recording' | 'paused' | 'available'
async function sendPresence(instanceName, phone, presence = 'composing', delay = 1000) {
  try {
    const number = String(phone).replace(/\D/g, '');
    await http.post(`/chat/sendPresence/${instanceName}`, {
      number, presence, delay,
    });
  } catch (e) { /* silent — nao critico */ }
}

async function fetchProfilePicture(instanceName, phone) {
  try {
    const number = String(phone).replace(/\D/g, '');
    const { data } = await http.post(`/chat/fetchProfilePictureUrl/${instanceName}`, { number });
    return data?.profilePictureUrl || data?.url || null;
  } catch { return null; }
}

module.exports = {
  createInstance,
  getStatus,
  disconnectInstance,
  deleteInstance,
  sendText,
  sendMedia,
  sendPresence,
  markAsRead,
  getMessageMediaBase64,
  fetchProfilePicture,
};
