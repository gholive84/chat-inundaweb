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
const adminRoutes = require('./src/routes/admin');
const scheduledRoutes = require('./src/routes/scheduled');
const templateRoutes = require('./src/routes/templates');

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
app.use('/api/admin', adminRoutes);
app.use('/api/scheduled', scheduledRoutes);
app.use('/api/templates', templateRoutes);

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

  // Super admin (controla todas as empresas — operador da plataforma)
  await safe(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN DEFAULT FALSE`);

  // Empresas: opcoes de configuracao
  await safe(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS sign_messages BOOLEAN DEFAULT FALSE`);
  await safe(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS signature_format VARCHAR(50) DEFAULT 'bold'`); // bold | brackets | plain
  await safe(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS max_instances INTEGER DEFAULT 1`); // teto de caixas WhatsApp por empresa

  // ── User memberships em multiplas companies ──────────────────────────
  // Um user pode ser owner de varias empresas. A coluna company_id em users
  // funciona como "empresa principal" (a do signup), mas o user pode ter
  // memberships extras via essa tabela.
  await safe(`
    CREATE TABLE IF NOT EXISTS user_memberships (
      id            SERIAL PRIMARY KEY,
      user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      company_id    INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      role          VARCHAR(20) DEFAULT 'agent',
      created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (user_id, company_id)
    )
  `);
  await safe(`CREATE INDEX IF NOT EXISTS idx_memberships_user ON user_memberships(user_id)`);
  // Backfill: garante membership pra cada user existente (a partir do company_id principal)
  await safe(`
    INSERT INTO user_memberships (user_id, company_id, role)
    SELECT id, company_id, role FROM users
    ON CONFLICT DO NOTHING
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

  // Agentes atribuidos a uma instancia (caixa). Vazio = todos da company veem
  await safe(`
    CREATE TABLE IF NOT EXISTS instance_agents (
      instance_id   INTEGER NOT NULL REFERENCES whatsapp_instances(id) ON DELETE CASCADE,
      user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (instance_id, user_id)
    )
  `);
  await safe(`CREATE INDEX IF NOT EXISTS idx_instance_agents_user ON instance_agents(user_id)`);

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
  await safe(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS is_urgent BOOLEAN DEFAULT FALSE`);
  await safe(`CREATE INDEX IF NOT EXISTS idx_conv_urgent ON conversations(company_id, is_urgent DESC, last_message_at DESC)`);

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

  // ── Status de entrega + edit/delete + quote rico ─────────────────────
  await safe(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMP`);
  await safe(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS read_at TIMESTAMP`);
  await safe(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMP`);
  await safe(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP`);
  // Quoted: alem do FK que ja existia, guardamos snapshot pro caso da original ser deletada
  await safe(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS quoted_body TEXT`);
  await safe(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS quoted_from_me BOOLEAN`);
  await safe(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS quoted_type VARCHAR(20)`);
  await safe(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS quoted_provider_msg_id VARCHAR(255)`);

  // ── Reações a mensagens ──────────────────────────────────────────────
  // by_type: contact (cliente) | user (atendente)
  await safe(`
    CREATE TABLE IF NOT EXISTS message_reactions (
      id            SERIAL PRIMARY KEY,
      message_id    INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      emoji         VARCHAR(16) NOT NULL,
      by_type       VARCHAR(20) NOT NULL,
      by_user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (message_id, by_type, by_user_id)
    )
  `);
  await safe(`CREATE INDEX IF NOT EXISTS idx_react_msg ON message_reactions(message_id)`);

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
  // Hardening anti-ban: rate limit, opt-out, business hours
  await safe(`ALTER TABLE ai_configs ADD COLUMN IF NOT EXISTS max_msgs_per_minute INTEGER DEFAULT 15`);
  await safe(`ALTER TABLE ai_configs ADD COLUMN IF NOT EXISTS opt_out_keywords TEXT DEFAULT 'parar,stop,sair,descadastrar,unsubscribe,nao quero,nao tenho interesse,remova'`);
  await safe(`ALTER TABLE ai_configs ADD COLUMN IF NOT EXISTS business_hours_enabled BOOLEAN DEFAULT FALSE`);
  await safe(`ALTER TABLE ai_configs ADD COLUMN IF NOT EXISTS business_hours_start VARCHAR(5) DEFAULT '08:00'`);
  await safe(`ALTER TABLE ai_configs ADD COLUMN IF NOT EXISTS business_hours_end VARCHAR(5) DEFAULT '22:00'`);
  await safe(`ALTER TABLE ai_configs ADD COLUMN IF NOT EXISTS business_hours_timezone VARCHAR(50) DEFAULT 'America/Sao_Paulo'`);
  // Indica se usuario fez opt-out — pausa IA naquela conversation pra sempre
  await safe(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS opted_out BOOLEAN DEFAULT FALSE`);

  // ── IA por caixa: cada whatsapp_instance pode ter sua propria config + nome ──
  // Migracao do esquema antigo (1 config por company) pra novo (1 config por caixa).
  await safe(`ALTER TABLE ai_configs ADD COLUMN IF NOT EXISTS id SERIAL`);
  await safe(`ALTER TABLE ai_configs ADD COLUMN IF NOT EXISTS instance_id INTEGER REFERENCES whatsapp_instances(id) ON DELETE CASCADE`);
  await safe(`ALTER TABLE ai_configs ADD COLUMN IF NOT EXISTS name VARCHAR(120)`);
  // Troca a PK de company_id pra id
  await safe(`ALTER TABLE ai_configs DROP CONSTRAINT IF EXISTS ai_configs_pkey`);
  await safe(`ALTER TABLE ai_configs ADD PRIMARY KEY (id)`);
  // Garante 1 config por caixa
  await safe(`ALTER TABLE ai_configs ADD CONSTRAINT ai_configs_instance_unique UNIQUE (instance_id)`);
  // Replica config legacy (instance_id IS NULL) pra cada caixa da company
  await safe(`
    INSERT INTO ai_configs (
      company_id, instance_id, name, provider, api_key, model, system_prompt, pause_seconds, enabled,
      max_tokens, temperature, default_conversation_ai, max_msgs_per_minute, opt_out_keywords,
      business_hours_enabled, business_hours_start, business_hours_end, business_hours_timezone, updated_at
    )
    SELECT
      ac.company_id, wi.id,
      COALESCE(wi.display_name, 'IA') AS name,
      ac.provider, ac.api_key, ac.model, ac.system_prompt, ac.pause_seconds, ac.enabled,
      ac.max_tokens, ac.temperature, ac.default_conversation_ai, ac.max_msgs_per_minute, ac.opt_out_keywords,
      ac.business_hours_enabled, ac.business_hours_start, ac.business_hours_end, ac.business_hours_timezone, NOW()
    FROM ai_configs ac
    JOIN whatsapp_instances wi ON wi.company_id = ac.company_id
    WHERE ac.instance_id IS NULL
    ON CONFLICT (instance_id) DO NOTHING
  `);
  // Remove rows legacy (company-only) — somente se ja tem instance migrada
  await safe(`
    DELETE FROM ai_configs ac
    WHERE ac.instance_id IS NULL
      AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.company_id = ac.company_id)
  `);

  // ── Knowledge base por caixa ────────────────────────────────────────
  await safe(`ALTER TABLE ai_knowledge ADD COLUMN IF NOT EXISTS instance_id INTEGER REFERENCES whatsapp_instances(id) ON DELETE CASCADE`);
  await safe(`CREATE INDEX IF NOT EXISTS idx_ai_knowledge_instance ON ai_knowledge(instance_id)`);
  // Replica KB legacy pra cada caixa
  await safe(`
    INSERT INTO ai_knowledge (company_id, instance_id, kind, title, source, mime, size_bytes, content, created_by)
    SELECT k.company_id, wi.id, k.kind, k.title, k.source, k.mime, k.size_bytes, k.content, k.created_by
    FROM ai_knowledge k
    JOIN whatsapp_instances wi ON wi.company_id = k.company_id
    WHERE k.instance_id IS NULL
  `);
  await safe(`
    DELETE FROM ai_knowledge k
    WHERE k.instance_id IS NULL
      AND EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.company_id = k.company_id)
  `);

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

  // ── Storage config (S3, local, etc) — DEPRECATED, agora em platform_settings ─
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

  // ── Platform settings (global, controlado pelo super admin) ──────────
  await safe(`
    CREATE TABLE IF NOT EXISTS platform_settings (
      key       VARCHAR(50) PRIMARY KEY,
      value     JSONB NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  // Migra storage_configs existente (qualquer empresa) pra platform_settings.storage
  // (one-time, se ainda nao existe a chave global)
  await safe(`
    INSERT INTO platform_settings (key, value)
    SELECT 'storage', row_to_json(s)::jsonb
    FROM storage_configs s
    WHERE NOT EXISTS (SELECT 1 FROM platform_settings WHERE key = 'storage')
    LIMIT 1
  `);

  // ── Scheduled messages ───────────────────────────────────────────────
  await safe(`
    CREATE TABLE IF NOT EXISTS scheduled_messages (
      id              SERIAL PRIMARY KEY,
      company_id      INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      contact_id      INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      instance_id     INTEGER NOT NULL REFERENCES whatsapp_instances(id) ON DELETE CASCADE,
      created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
      body            TEXT NOT NULL,
      scheduled_for   TIMESTAMP NOT NULL,
      status          VARCHAR(20) DEFAULT 'pending',  -- pending | sent | failed | cancelled
      sent_at         TIMESTAMP,
      error           TEXT,
      created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await safe(`CREATE INDEX IF NOT EXISTS idx_sched_due ON scheduled_messages(status, scheduled_for) WHERE status='pending'`);
  // Suporte a mídia em msgs agendadas
  await safe(`ALTER TABLE scheduled_messages ADD COLUMN IF NOT EXISTS media_url TEXT`);
  await safe(`ALTER TABLE scheduled_messages ADD COLUMN IF NOT EXISTS media_mime VARCHAR(100)`);
  await safe(`ALTER TABLE scheduled_messages ADD COLUMN IF NOT EXISTS media_filename VARCHAR(255)`);
  await safe(`ALTER TABLE scheduled_messages ADD COLUMN IF NOT EXISTS media_type VARCHAR(20)`); // image | document | audio | video

  // ── Quick Replies (templates de resposta com possivel anexo) ──────────
  await safe(`
    CREATE TABLE IF NOT EXISTS quick_replies (
      id              SERIAL PRIMARY KEY,
      company_id      INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      shortcut        VARCHAR(50) NOT NULL,   -- ex: /oi → autocomplete
      title           VARCHAR(120),
      body            TEXT,
      media_url       TEXT,
      media_mime      VARCHAR(100),
      media_filename  VARCHAR(255),
      media_type      VARCHAR(20),             -- image | document | audio | video
      created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (company_id, shortcut)
    )
  `);
  await safe(`CREATE INDEX IF NOT EXISTS idx_qr_company ON quick_replies(company_id)`);

  // ── Templates que a IA de cada caixa pode usar ───────────────────────
  await safe(`
    CREATE TABLE IF NOT EXISTS ai_instance_templates (
      instance_id  INTEGER NOT NULL REFERENCES whatsapp_instances(id) ON DELETE CASCADE,
      template_id  INTEGER NOT NULL REFERENCES quick_replies(id) ON DELETE CASCADE,
      PRIMARY KEY (instance_id, template_id)
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
  // Workers
  require('./src/services/scheduledSender').start(app);
}

start().catch((e) => { console.error(e); process.exit(1); });
