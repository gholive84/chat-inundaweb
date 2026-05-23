require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const { pool, testConnection } = require('./src/config/database');

const authRoutes = require('./src/routes/auth');
const companyRoutes = require('./src/routes/companies');
const instanceRoutes = require('./src/routes/instances');
const conversationRoutes = require('./src/routes/conversations');
const messageRoutes = require('./src/routes/messages');
const webhookRoutes = require('./src/routes/webhooks');
const aiRoutes = require('./src/routes/ai');
const crmRoutes = require('./src/routes/crm');
const tagRoutes = require('./src/routes/tags');
const noteRoutes = require('./src/routes/notes');
const contactRoutes = require('./src/routes/contacts');
const storageRoutes = require('./src/routes/storage');
const knowledgeRoutes = require('./src/routes/knowledge');

const initSocket = require('./src/socket');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.FRONTEND_URL || '*', credentials: true },
  path: '/socket.io',
});

app.use(cors({ origin: process.env.FRONTEND_URL || '*', credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health
app.get('/api/health', (_, res) => res.json({ ok: true, ts: Date.now() }));

// Rotas
app.use('/api/auth', authRoutes);
app.use('/api/companies', companyRoutes);
app.use('/api/instances', instanceRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/crm', crmRoutes);
app.use('/api/tags', tagRoutes);
app.use('/api/notes', noteRoutes);
app.use('/api/contacts', contactRoutes);
app.use('/api/storage', storageRoutes);
app.use('/api/knowledge', knowledgeRoutes);

app.set('io', io);
initSocket(io);

const PORT = parseInt(process.env.PORT || '3001');

async function runMigrations() {
  const safe = async (sql) => {
    try { await pool.query(sql); }
    catch (e) { console.warn('Migration skipped:', e.message.split('\n')[0]); }
  };

  // ── Companies (SaaS tenants) ─────────────────────────────────────────
  await safe(`
    CREATE TABLE IF NOT EXISTS companies (
      id          SERIAL PRIMARY KEY,
      slug        VARCHAR(80) UNIQUE NOT NULL,
      name        VARCHAR(255) NOT NULL,
      email       VARCHAR(255),
      active      BOOLEAN DEFAULT TRUE,
      max_agents  INTEGER DEFAULT 10,
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ── Users (agentes) ──────────────────────────────────────────────────
  await safe(`
    CREATE TABLE IF NOT EXISTS users (
      id            SERIAL PRIMARY KEY,
      company_id    INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      name          VARCHAR(255) NOT NULL,
      email         VARCHAR(255) NOT NULL,
      password_hash TEXT NOT NULL,
      role          VARCHAR(20) DEFAULT 'agent',  -- owner | agent | viewer
      avatar_url    TEXT,
      active        BOOLEAN DEFAULT TRUE,
      last_seen_at  TIMESTAMP,
      created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (email)
    )
  `);

  // ── WhatsApp instances ───────────────────────────────────────────────
  // status: pending | connecting | connected | disconnected | error
  // provider: evolution | zapi | official
  await safe(`
    CREATE TABLE IF NOT EXISTS whatsapp_instances (
      id              SERIAL PRIMARY KEY,
      company_id      INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      provider        VARCHAR(20) DEFAULT 'evolution',
      instance_name   VARCHAR(120) UNIQUE NOT NULL,
      display_name    VARCHAR(120),
      phone_number    VARCHAR(30),
      status          VARCHAR(20) DEFAULT 'pending',
      qr_code         TEXT,
      webhook_token   TEXT,
      config          JSONB DEFAULT '{}'::jsonb,
      last_event_at   TIMESTAMP,
      created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ── Contacts (WhatsApp contacts) ─────────────────────────────────────
  await safe(`
    CREATE TABLE IF NOT EXISTS contacts (
      id              SERIAL PRIMARY KEY,
      company_id      INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      phone           VARCHAR(30) NOT NULL,
      name            VARCHAR(255),
      push_name       VARCHAR(255),
      profile_pic_url TEXT,
      is_business     BOOLEAN DEFAULT FALSE,
      email           VARCHAR(255),
      notes           TEXT,
      crm_stage       VARCHAR(50),
      crm_order       INTEGER DEFAULT 0,
      created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (company_id, phone)
    )
  `);
  await safe(`CREATE INDEX IF NOT EXISTS idx_contacts_company ON contacts(company_id)`);

  // ── Conversations ────────────────────────────────────────────────────
  await safe(`
    CREATE TABLE IF NOT EXISTS conversations (
      id                    SERIAL PRIMARY KEY,
      company_id            INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      instance_id           INTEGER NOT NULL REFERENCES whatsapp_instances(id) ON DELETE CASCADE,
      contact_id            INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      assigned_to_user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
      ai_enabled            BOOLEAN DEFAULT TRUE,
      ai_paused_until       TIMESTAMP,
      status                VARCHAR(20) DEFAULT 'open',  -- open | resolved | archived
      unread_count          INTEGER DEFAULT 0,
      last_message_at       TIMESTAMP,
      last_message_preview  TEXT,
      created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (instance_id, contact_id)
    )
  `);
  await safe(`CREATE INDEX IF NOT EXISTS idx_conv_company_status ON conversations(company_id, status)`);
  await safe(`CREATE INDEX IF NOT EXISTS idx_conv_last_msg ON conversations(last_message_at DESC)`);

  // ── Messages ─────────────────────────────────────────────────────────
  // author_type: contact | agent | ai | system
  // type: text | image | audio | video | document | sticker | location
  await safe(`
    CREATE TABLE IF NOT EXISTS messages (
      id               SERIAL PRIMARY KEY,
      conversation_id  INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      provider_msg_id  VARCHAR(255),
      from_me          BOOLEAN NOT NULL,
      author_type      VARCHAR(20) NOT NULL,
      author_user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
      type             VARCHAR(20) DEFAULT 'text',
      body             TEXT,
      media_url        TEXT,
      media_mime       VARCHAR(100),
      media_filename   VARCHAR(255),
      quoted_msg_id    INTEGER REFERENCES messages(id) ON DELETE SET NULL,
      status           VARCHAR(20) DEFAULT 'sent',  -- pending | sent | delivered | read | failed
      error            TEXT,
      raw              JSONB,
      created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await safe(`CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, created_at)`);
  // Postgres trata NULLs como distintos em UNIQUE; ON CONFLICT precisa de constraint nao-partial
  await safe(`ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_provider_msg_id_key`);
  await safe(`DROP INDEX IF EXISTS idx_msg_provider`);
  await safe(`ALTER TABLE messages ADD CONSTRAINT messages_provider_msg_id_key UNIQUE (provider_msg_id)`);

  // ── Notes (notas internas por conversa) ──────────────────────────────
  await safe(`
    CREATE TABLE IF NOT EXISTS notes (
      id              SERIAL PRIMARY KEY,
      conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE SET NULL,
      body            TEXT NOT NULL,
      created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ── Tags ─────────────────────────────────────────────────────────────
  await safe(`
    CREATE TABLE IF NOT EXISTS tags (
      id          SERIAL PRIMARY KEY,
      company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      label       VARCHAR(60) NOT NULL,
      color       VARCHAR(20) DEFAULT '#3b82f6',
      UNIQUE (company_id, label)
    )
  `);
  await safe(`
    CREATE TABLE IF NOT EXISTS conversation_tags (
      conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      tag_id          INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (conversation_id, tag_id)
    )
  `);

  // ── CRM stages (kanban, por company) ─────────────────────────────────
  await safe(`
    CREATE TABLE IF NOT EXISTS crm_stages (
      id          VARCHAR(50) NOT NULL,
      company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      label       VARCHAR(100) NOT NULL,
      color       VARCHAR(20) DEFAULT 'blue',
      position    INTEGER DEFAULT 0,
      PRIMARY KEY (id, company_id)
    )
  `);

  // ── AI configs (por company) ────────────────────────────────────────
  // provider: openai | anthropic | none
  await safe(`
    CREATE TABLE IF NOT EXISTS ai_configs (
      company_id      INTEGER PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
      provider        VARCHAR(20) DEFAULT 'none',
      api_key         TEXT,
      model           VARCHAR(80),
      system_prompt   TEXT,
      pause_seconds   INTEGER DEFAULT 600,   -- minutos de pausa ao agente digitar
      enabled         BOOLEAN DEFAULT FALSE,
      max_tokens      INTEGER DEFAULT 1024,
      temperature     REAL DEFAULT 0.7,
      updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  // Default da IA em conversas novas (independente do enabled global)
  await safe(`ALTER TABLE ai_configs ADD COLUMN IF NOT EXISTS default_conversation_ai BOOLEAN DEFAULT TRUE`);

  // ── Provider configs (Evolution / Z-API / Oficial) ──────────────────
  await safe(`
    CREATE TABLE IF NOT EXISTS provider_configs (
      id          SERIAL PRIMARY KEY,
      company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      provider    VARCHAR(20) NOT NULL,
      base_url    TEXT,
      api_key     TEXT,
      extra       JSONB DEFAULT '{}'::jsonb,
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (company_id, provider)
    )
  `);

  // ── Storage config (S3, local, etc) ──────────────────────────────────
  await safe(`
    CREATE TABLE IF NOT EXISTS storage_configs (
      company_id   INTEGER PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
      provider     VARCHAR(20) DEFAULT 'local',  -- local | s3
      endpoint     TEXT,
      region       VARCHAR(50),
      bucket       VARCHAR(255),
      access_key   TEXT,
      secret_key   TEXT,
      public_url   TEXT,
      updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ── AI Knowledge base (arquivos e URLs) ──────────────────────────────
  await safe(`
    CREATE TABLE IF NOT EXISTS ai_knowledge (
      id          SERIAL PRIMARY KEY,
      company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      kind        VARCHAR(20) NOT NULL,   -- file | url | text
      title       VARCHAR(255) NOT NULL,
      source      TEXT,                    -- url ou filename
      mime        VARCHAR(100),
      size_bytes  INTEGER,
      content     TEXT,                    -- texto extraido pra context
      created_by  INTEGER REFERENCES users(id),
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await safe(`CREATE INDEX IF NOT EXISTS idx_ai_knowledge_company ON ai_knowledge(company_id)`);

  console.log('✅ Migrations done');
}

async function start() {
  await testConnection();
  await runMigrations();
  server.listen(PORT, () => {
    console.log(`🚀 Chat-Inunda backend on :${PORT}`);
  });
}

start().catch((e) => { console.error(e); process.exit(1); });
