// Storage adapter: lê config da company e sobe pro S3 (ou retorna null se local)
const crypto = require('crypto');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { pool } = require('../config/database');

// Cache de clients por companyId (evita re-criar a cada upload)
const clientCache = new Map();

async function getConfig(companyId) {
  const { rows } = await pool.query(
    `SELECT provider, endpoint, region, bucket, access_key, secret_key, public_url
     FROM storage_configs WHERE company_id=$1`,
    [companyId]
  );
  return rows[0] || { provider: 'local' };
}

function getClient(cfg) {
  const key = `${cfg.endpoint || ''}|${cfg.region}|${cfg.access_key}`;
  if (clientCache.has(key)) return clientCache.get(key);
  const opts = {
    region: cfg.region || 'us-east-1',
    credentials: {
      accessKeyId: cfg.access_key,
      secretAccessKey: cfg.secret_key,
    },
  };
  if (cfg.endpoint) {
    opts.endpoint = cfg.endpoint;
    opts.forcePathStyle = true; // pra MinIO/R2/B2
  }
  const client = new S3Client(opts);
  clientCache.set(key, client);
  return client;
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
 * Throws se S3 nao configurado/falha.
 */
async function uploadBuffer({ companyId, buffer, mimetype, filename, folder = 'chat' }) {
  const cfg = await getConfig(companyId);
  if (cfg.provider !== 's3') throw new Error('S3 nao configurado');
  if (!cfg.bucket || !cfg.access_key || !cfg.secret_key) throw new Error('S3 incompleto (bucket/keys)');

  const ext = (filename?.split('.').pop() || 'bin').toLowerCase();
  const rand = crypto.randomBytes(8).toString('hex');
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

async function hasS3(companyId) {
  const cfg = await getConfig(companyId);
  return cfg.provider === 's3' && cfg.bucket && cfg.access_key && cfg.secret_key;
}

function invalidateCache() { clientCache.clear(); }

module.exports = { uploadBuffer, hasS3, invalidateCache, getConfig };
