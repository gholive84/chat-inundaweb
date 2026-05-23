// Storage adapter: lê config da company e sobe pro S3 (ou retorna null se local)
const crypto = require('crypto');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { pool } = require('../config/database');

// Cache do client S3 (compartilhado entre companies — storage e global)
let _client = null;
let _cacheKey = null;

async function getConfig() {
  // Le do platform_settings (chave global gerenciada pelo super admin)
  const { rows } = await pool.query(
    `SELECT value FROM platform_settings WHERE key='storage'`
  );
  if (!rows.length) return { provider: 'local' };
  const v = rows[0].value || {};
  return {
    provider: v.provider || 'local',
    endpoint: v.endpoint || null,
    region: v.region || null,
    bucket: v.bucket || null,
    access_key: v.access_key || null,
    secret_key: v.secret_key || null,
    public_url: v.public_url || null,
  };
}

function getClient(cfg) {
  const key = `${cfg.endpoint || ''}|${cfg.region}|${cfg.access_key}`;
  if (_client && _cacheKey === key) return _client;
  const opts = {
    region: cfg.region || 'us-east-1',
    credentials: {
      accessKeyId: cfg.access_key,
      secretAccessKey: cfg.secret_key,
    },
  };
  if (cfg.endpoint) {
    opts.endpoint = cfg.endpoint;
    opts.forcePathStyle = true;
  }
  _client = new S3Client(opts);
  _cacheKey = key;
  return _client;
}

function publicUrl(cfg, key) {
  // Se tem public_url custom (CDN/domain), usa
  if (cfg.public_url) return `${cfg.public_url.replace(/\/$/, '')}/${key}`;
  // Endpoint custom (MinIO/R2/B2)
  if (cfg.endpoint) return `${cfg.endpoint.replace(/\/$/, '')}/${cfg.bucket}/${key}`;
  // AWS S3 default
  return `https://${cfg.bucket}.s3.${cfg.region || 'us-east-1'}.amazonaws.com/${key}`;
}

function safeFilename(name) {
  return String(name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
}

/**
 * Faz upload e retorna a URL publica.
 * Bucket e platform-wide (uma config global). Key sempre prefixada pelo
 * companyId pra isolar arquivos entre empresas.
 */
async function uploadBuffer({ companyId, buffer, mimetype, filename, folder = 'chat' }) {
  const cfg = await getConfig();
  if (cfg.provider !== 's3') throw new Error('S3 nao configurado (super admin)');
  if (!cfg.bucket || !cfg.access_key || !cfg.secret_key) throw new Error('S3 incompleto (bucket/keys)');

  const ext = (filename?.split('.').pop() || 'bin').toLowerCase();
  const rand = crypto.randomBytes(8).toString('hex');
  // Prefix por company pra isolar (super admin define o bucket, mas cada
  // empresa fica na sua pasta: chat/{companyId}/...)
  const key = `${folder}/${companyId}/${Date.now()}-${rand}-${safeFilename(filename || `file.${ext}`)}`;

  const client = getClient(cfg);
  await client.send(new PutObjectCommand({
    Bucket: cfg.bucket,
    Key: key,
    Body: buffer,
    ContentType: mimetype || 'application/octet-stream',
    ContentDisposition: filename ? `inline; filename="${safeFilename(filename)}"` : undefined,
    // Sem ACL — bucket policy controla acesso publico
  }));

  return { url: publicUrl(cfg, key), key, provider: 's3' };
}

async function hasS3() {
  const cfg = await getConfig();
  return cfg.provider === 's3' && cfg.bucket && cfg.access_key && cfg.secret_key;
}

function invalidateCache() { _client = null; _cacheKey = null; }

module.exports = { uploadBuffer, hasS3, invalidateCache, getConfig };
