// Primeiro deploy: clona repo, prepara DBs, sobe Evolution + Chat no VPS.
// Roda apenas uma vez. Depois use deploy-update.js pra atualizacoes.
require('dotenv').config({ path: 'C:/Users/gholi/VSCODE/SUPORTE-APP/.env' });
const { Client } = require('ssh2');

const VPS = {
  host: process.env.VPS_HOST,
  port: parseInt(process.env.VPS_PORT || '22'),
  username: process.env.VPS_USER,
  password: process.env.VPS_PASS,
  readyTimeout: 30000,
};
const JWT_SECRET = process.env.JWT_SECRET;
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY;
const CHAT_DB_USER = process.env.CHAT_DB_USER;
const CHAT_DB_PASS = process.env.CHAT_DB_PASS;

const PG = 'docker exec $(docker ps -q -f name=postgres_postgres) psql -U postgres';

const STEPS = [
  // Clone (ou pull se ja existe)
  { desc: 'Clone repo (ou pull se existe)',
    cmd: `if [ -d /opt/chat-inunda/.git ]; then cd /opt/chat-inunda && git pull origin main; else git clone https://github.com/gholive84/chat-inundaweb.git /opt/chat-inunda; fi` },

  // Cria usuario dedicado (idempotente)
  { desc: 'Cria role chat_inunda_user',
    cmd: `${PG} -tc "SELECT 1 FROM pg_roles WHERE rolname='${CHAT_DB_USER}'" | grep -q 1 || ${PG} -c "CREATE ROLE ${CHAT_DB_USER} LOGIN PASSWORD '${CHAT_DB_PASS}';"` },
  { desc: 'Garante senha atualizada',
    cmd: `${PG} -c "ALTER ROLE ${CHAT_DB_USER} WITH PASSWORD '${CHAT_DB_PASS}';"` },

  // Cria DBs com owner = chat_inunda_user
  { desc: 'Cria DB chat_inunda',
    cmd: `${PG} -tc "SELECT 1 FROM pg_database WHERE datname='chat_inunda'" | grep -q 1 || ${PG} -c "CREATE DATABASE chat_inunda OWNER ${CHAT_DB_USER};"` },
  { desc: 'Cria DB evolution',
    cmd: `${PG} -tc "SELECT 1 FROM pg_database WHERE datname='evolution'" | grep -q 1 || ${PG} -c "CREATE DATABASE evolution OWNER ${CHAT_DB_USER};"` },
  { desc: 'Grants nos DBs',
    cmd: `${PG} -c "GRANT ALL PRIVILEGES ON DATABASE chat_inunda TO ${CHAT_DB_USER}; GRANT ALL PRIVILEGES ON DATABASE evolution TO ${CHAT_DB_USER};"` },

  // Sobe Evolution
  { desc: 'Deploy stack evolution',
    cmd: `cd /opt/chat-inunda && CHAT_DB_USER='${CHAT_DB_USER}' CHAT_DB_PASS='${CHAT_DB_PASS}' EVOLUTION_API_KEY='${EVOLUTION_API_KEY}' docker stack deploy -c evolution-stack.yml evolution` },

  // Build images chat
  { desc: 'Build chat-inunda-backend',
    cmd: 'cd /opt/chat-inunda && docker build -t chat-inunda-backend:latest .' },
  { desc: 'Build chat-inunda-frontend',
    cmd: 'cd /opt/chat-inunda && docker build -f Dockerfile.frontend -t chat-inunda-frontend:latest .' },

  // Sobe Chat
  { desc: 'Deploy stack chat',
    cmd: `cd /opt/chat-inunda && CHAT_DB_USER='${CHAT_DB_USER}' CHAT_DB_PASS='${CHAT_DB_PASS}' JWT_SECRET='${JWT_SECRET}' EVOLUTION_API_KEY='${EVOLUTION_API_KEY}' docker stack deploy -c docker-stack.yml chat` },

  { desc: 'Wait 25s', cmd: 'sleep 25' },

  // Diagnostico
  { desc: '=== Stacks ===',        cmd: 'docker stack ls' },
  { desc: '=== Services ===',      cmd: 'docker service ls' },
  { desc: '=== chat_app logs ===', cmd: 'docker service logs chat_chat_app --tail 30 2>&1 || true' },
  { desc: '=== evolution logs ===', cmd: 'docker service logs evolution_evolution_api --tail 20 2>&1 || true' },
];

function runSSH(steps) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let i = 0;
    const next = () => {
      if (i >= steps.length) { conn.end(); resolve(); return; }
      const { cmd, desc } = steps[i++];
      console.log(`\n>>> ${desc}`);
      conn.exec(cmd, (err, stream) => {
        if (err) { conn.end(); return reject(err); }
        stream.on('data', d => process.stdout.write(d));
        stream.stderr.on('data', d => process.stderr.write(d));
        stream.on('close', (code) => {
          if (code !== 0) console.log(`[exit: ${code}]`);
          next();
        });
      });
    };
    conn.on('ready', () => { console.log('Connected\n'); next(); })
        .on('error', reject).connect(VPS);
  });
}

runSSH(STEPS).then(() => console.log('\n✅ Bootstrap complete'))
  .catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
