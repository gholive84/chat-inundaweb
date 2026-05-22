// Deploy script estilo hub: SSH no Swarm, pull, build, redeploy.
// Espera o repo estar em /opt/chat-inunda na VPS.
const path = require('path');
const fs = require('fs');

function findRepoEnv() {
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, '.env');
    if (fs.existsSync(candidate) && fs.readFileSync(candidate, 'utf8').includes('VPS_HOST')) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
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
  await runSSH([
    { desc: 'Pull latest', cmd: 'cd /opt/chat-inunda && git pull origin main' },
    { desc: 'Ensure DB chat_inunda exists',
      cmd: `docker exec $(docker ps -q -f name=postgres_postgres) psql -U postgres -tc "SELECT 1 FROM pg_database WHERE datname='chat_inunda'" | grep -q 1 || docker exec $(docker ps -q -f name=postgres_postgres) psql -U postgres -c "CREATE DATABASE chat_inunda;"` },
    { desc: 'Build backend image',  cmd: 'cd /opt/chat-inunda && docker build -t chat-inunda-backend:latest .' },
    { desc: 'Build frontend image', cmd: 'cd /opt/chat-inunda && docker build -f Dockerfile.frontend -t chat-inunda-frontend:latest .' },
    { desc: 'Deploy stack',         cmd: 'cd /opt/chat-inunda && docker stack deploy -c docker-stack.yml chat --with-registry-auth' },
    { desc: 'Force redeploy backend',  cmd: 'docker service update --force chat_chat_app' },
    { desc: 'Force redeploy frontend', cmd: 'docker service update --force chat_chat_frontend' },
    { desc: 'Wait 15s',             cmd: 'sleep 15' },
    { desc: 'Stack status',         cmd: 'docker stack services chat' },
    { desc: 'Backend logs',         cmd: 'docker service logs chat_chat_app --tail 20 2>&1 || true' },
  ]);
  console.log('\n✅ Update complete!');
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
