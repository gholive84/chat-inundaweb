// One-off: marca gustavo@inundaweb.com.br como super admin
require('dotenv').config({ path: 'C:/Users/gholi/VSCODE/SUPORTE-APP/.env' });
const { Client } = require('ssh2');
const VPS = { host: process.env.VPS_HOST, port: parseInt(process.env.VPS_PORT||'22'),
  username: process.env.VPS_USER, password: process.env.VPS_PASS, readyTimeout: 30000 };
const { CHAT_DB_USER, CHAT_DB_PASS } = process.env;

const cmd = `docker exec $(docker ps -q -f name=postgres_postgres) sh -c "PGPASSWORD='${CHAT_DB_PASS}' psql -U ${CHAT_DB_USER} -d chat_inunda -c \\"UPDATE users SET is_super_admin = TRUE WHERE email='gustavo@inundaweb.com.br' RETURNING id, name, email, is_super_admin\\""`;

const conn = new Client();
conn.on('ready', () => {
  conn.exec(cmd, (err, stream) => {
    if (err) { console.error(err); process.exit(1); }
    stream.on('data', d => process.stdout.write(d));
    stream.stderr.on('data', d => process.stderr.write(d));
    stream.on('close', code => { conn.end(); process.exit(code||0); });
  });
}).on('error', e => { console.error('SSH:', e.message); process.exit(1); }).connect(VPS);
