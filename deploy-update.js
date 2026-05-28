// Deploy script estilo hub: SSH no Swarm, pull, build, redeploy.
// Espera o repo estar em /opt/chat-inunda na VPS.
const path = require('path');
const fs = require('fs');

function findRepoEnv() {
  // 1) procura subindo do __dirname
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, '.env');
    if (fs.existsSync(candidate) && fs.readFileSync(candidate, 'utf8').includes('VPS_HOST')) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // 2) fallback: SUPORTE-APP/.env irmao do CHAT-INUNDA (mesmo VPS, mesmo .env)
  const sibling = path.resolve(__dirname, '..', 'SUPORTE-APP', '.env');
  if (fs.existsSync(sibling)) return sibling;
  return path.join(__dirname, '.env');
}
require('dotenv').config({ path: findRepoEnv() });

const { Client } = require('ssh2');

const VPS = {
  host: process.env.VPS_HOST,
  port: parseInt(process.env.VPS_PORT || '22'),
  username: process.env.VPS_USER,
  password: process.env.VPS_PASS,
  readyTimeout: 30000,
};

if (!VPS.host || !VPS.username || !VPS.password) {
  console.error('ERRO: VPS_HOST, VPS_USER, VPS_PASS no .env');
  process.exit(1);
}

function runSSH(commands) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let idx = 0;
    const next = () => {
      if (idx >= commands.length) { conn.end(); resolve(); return; }
      const { cmd, desc } = commands[idx++];
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

async function main() {
  const { CHAT_DB_USER, CHAT_DB_PASS, JWT_SECRET, EVOLUTION_API_KEY } = process.env;
  // Vars do dev (db, jwt, evolution) passadas via SSH prefix.
  // SMTP_* vivem em /opt/chat-inunda/.env.smtp na VPS (gitignored, criado uma vez).
  const envPrefix = [
    `CHAT_DB_USER='${CHAT_DB_USER}'`,
    `CHAT_DB_PASS='${CHAT_DB_PASS}'`,
    `JWT_SECRET='${JWT_SECRET}'`,
    `EVOLUTION_API_KEY='${EVOLUTION_API_KEY}'`,
  ].join(' ');
  await runSSH([
    { desc: 'Pull latest', cmd: 'cd /opt/chat-inunda && git pull origin main' },
    { desc: 'Build backend image',  cmd: 'cd /opt/chat-inunda && docker build -t chat-inunda-backend:latest .' },
    { desc: 'Build frontend image', cmd: 'cd /opt/chat-inunda && docker build -f Dockerfile.frontend -t chat-inunda-frontend:latest .' },
    { desc: 'Deploy stack',
      cmd: `cd /opt/chat-inunda && set -a; [ -f .env.smtp ] && . .env.smtp; set +a; ${envPrefix} docker stack deploy -c docker-stack.yml chat --with-registry-auth` },
    { desc: 'Force redeploy backend',  cmd: 'docker service update --force chat_chat_app' },
    { desc: 'Force redeploy frontend', cmd: 'docker service update --force chat_chat_frontend' },
    { desc: 'Wait 20s',             cmd: 'sleep 20' },
    { desc: 'Stack status',         cmd: 'docker stack services chat' },
    { desc: 'Backend logs',         cmd: 'docker service logs chat_chat_app --tail 15 2>&1 || true' },
  ]);
  console.log('\n✅ Update complete!');
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
