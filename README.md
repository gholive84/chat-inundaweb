# Chat Inunda

SaaS de atendimento WhatsApp com IA — multi-tenant, multi-provider (Evolution / Z-API / API oficial), CRM integrado.

Produção: **https://chat.inundaweb.com.br**

## Stack

- **Backend**: Express + Postgres (`pg`) + Socket.IO + JWT + BullMQ (Redis)
- **Frontend**: React + Vite + Tailwind + Zustand
- **Provider padrão**: Evolution API
- **AI providers**: OpenAI / Anthropic (pluggable)
- **Deploy**: Docker Swarm na VPS Hostinger (rede `network_public`), stack `chat`

## Estrutura

```
backend/
  server.js             — HTTP + Socket.IO + runMigrations()
  worker.js             — BullMQ workers (AI + webhook processing)
  src/
    config/database.js  — Pool pg
    middleware/auth.js  — authCompany (JWT)
    routes/             — auth, companies, instances, conversations, messages, webhooks, ai, crm, tags, notes
    providers/          — interface + adapters (evolution, zapi, official)
    ai/                 — interface + adapters (openai, anthropic)
    socket/             — auth + rooms (company:{id}, conversation:{id})
    queue/              — definições BullMQ
frontend/
  vite.config.js        — proxy /api -> :3001
  src/
    pages/              — Login, Signup, Chat, Crm, Settings
    components/         — Sidebar, ChatList, ChatPanel, ContactInfo
    store/              — auth, conversations, sockets
```

## Setup local

```bash
npm install
# Backend
cd backend && cp .env.example .env  # ajustar DB, JWT, evolution
npm run dev
# Frontend (outra aba)
cd frontend && npm run dev
```

## Deploy

```bash
node deploy-update.js
```

Lê `.env` na raiz pra `VPS_HOST`, `VPS_USER`, `VPS_PASS`, faz SSH no Swarm, build de imagens, redeploy.

## Multi-tenant

- `companies`: cada empresa cliente do SaaS
- `users`: agentes (role: owner/agent/viewer) atrelados a uma company
- Toda query filtra por `company_id` via middleware
- Cada company tem uma `whatsapp_instances` (1 número WhatsApp por enquanto)

## Conexões

- `chat_app` <-> `evolution_api` (HTTP + webhook)
- `chat_app` <-> Postgres (`postgres_postgres`, DB: `chat_inunda`)
- `chat_app` <-> Redis (`redis_redis`)
- `traefik` -> `chat_frontend` em `chat.inundaweb.com.br`
- `traefik` -> `chat_app` em `chat.inundaweb.com.br/api` e `/socket.io`
