import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createServer } from 'node:http';
import { config } from './config.js';
import { createToken, roleForPassword } from './auth.js';
import { SharedTerminal } from './terminal.js';
import { attachWebSocket } from './websocket.js';

const app = express();
const server = createServer(app);
const terminal = new SharedTerminal(config);

app.use(express.json({ limit: '16kb' }));

app.post('/api/login', (req, res) => {
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const role = roleForPassword(password, config);
  if (!role) {
    res.status(401).json({ error: 'Invalid password' });
    return;
  }

  res.json({ token: createToken(role, config), role });
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDir = path.resolve(__dirname, '../client');

app.use(express.static(clientDir));
app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(clientDir, 'index.html'));
});

attachWebSocket(server, terminal, config);

server.listen(config.port, config.host, () => {
  console.log(`opencode-share listening on http://${config.host}:${config.port}`);
  console.log(`Started '${config.startCommand}' in ${config.cwd}`);
});

function shutdown(): void {
  terminal.dispose();
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
