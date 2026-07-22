const path = require('path');
const crypto = require('crypto');
const express = require('express');
const db = require('./db');

const PORT = Number(process.env.SISOFT_PORT || process.env.PORT || 3050) || 3050;
const HOST = process.env.SISOFT_HOST || process.env.HOST || '0.0.0.0';
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

/** @type {Map<string, { userId: number, expiresAt: number }>} */
const sessions = new Map();

function makeToken(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  sessions.set(token, { userId: Number(userId), expiresAt: Date.now() + TOKEN_TTL_MS });
  return token;
}

function parseToken(header) {
  const raw = String(header || '');
  const token = raw.startsWith('Bearer ') ? raw.slice(7) : raw;
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return null;
  }
  session.expiresAt = Date.now() + TOKEN_TTL_MS;
  return { token, userId: session.userId };
}

function authRequired(req, res, next) {
  const parsed = parseToken(req.headers.authorization || req.headers['x-auth-token']);
  if (!parsed) return res.status(401).json({ error: 'Não autorizado.' });
  req.authUserId = parsed.userId;
  req.authToken = parsed.token;
  next();
}

db.ensureSeedUsers();

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/painel.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'painel.html'));
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, app: 'sisoft', port: PORT });
});

app.get('/api/services', (req, res) => {
  res.json(db.listServices());
});

app.post('/api/leads', (req, res) => {
  const result = db.addLead(req.body || {});
  if (result.error) return res.status(result.status || 400).json({ error: result.error });
  res.status(201).json(result);
});

app.post('/api/login', (req, res) => {
  const login = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  const user = db.findUserByLogin(login);
  if (!user || !db.verifyPassword(password, user.password)) {
    return res.status(401).json({ error: 'Credenciais inválidas.' });
  }
  res.json({
    token: makeToken(user.id),
    user: db.publicUser(user)
  });
});

app.post('/api/logout', authRequired, (req, res) => {
  sessions.delete(req.authToken);
  res.json({ ok: true });
});

app.get('/api/me', authRequired, (req, res) => {
  const user = db.ensureSeedUsers().find((item) => item.id === req.authUserId);
  if (!user) return res.status(401).json({ error: 'Não autorizado.' });
  res.json(db.publicUser(user));
});

app.get('/api/summary', authRequired, (req, res) => {
  res.json(db.getSummary());
});

app.get('/api/leads', authRequired, (req, res) => {
  res.json(db.listLeads());
});

app.put('/api/leads/:id', authRequired, (req, res) => {
  const result = db.updateLead(req.params.id, req.body || {});
  if (result.error) return res.status(result.status || 400).json({ error: result.error });
  res.json(result);
});

app.delete('/api/leads/:id', authRequired, (req, res) => {
  const result = db.deleteLead(req.params.id);
  if (result.error) return res.status(result.status || 400).json({ error: result.error });
  res.json(result);
});

app.get('/api/clients', authRequired, (req, res) => {
  res.json(db.listClients());
});

app.post('/api/clients', authRequired, (req, res) => {
  const result = db.addClient(req.body || {});
  if (result.error) return res.status(result.status || 400).json({ error: result.error });
  res.status(201).json(result);
});

app.delete('/api/clients/:id', authRequired, (req, res) => {
  const result = db.deleteClient(req.params.id);
  if (result.error) return res.status(result.status || 400).json({ error: result.error });
  res.json(result);
});

function start() {
  return new Promise((resolve, reject) => {
    const server = app.listen(PORT, HOST, () => {
      console.log(`Sisoft (site + painel) a escutar em http://localhost:${PORT}/`);
      console.log('App próprio — sem ligação ao Isoft.');
      resolve(server);
    });
    server.on('error', reject);
  });
}

if (require.main === module) {
  start().catch((error) => {
    console.error('Falha ao iniciar Sisoft:', error.message || error);
    process.exit(1);
  });
}

module.exports = { app, start, PORT };
