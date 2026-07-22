const express = require('express');
const path = require('path');
const db = require('./db');
const reports = require('./reports');
const sms = require('./sms');
const mail = require('./email');
const desktop = require('./desktop');
const webauthn = require('./webauthn');
const config = require('./config');
const security = require('./security');

const app = express();
const PORT = config.PORT;
const HOST = config.HOST;
const CEO_USER_ID = 1;
const SESSION_TIMEOUT_MS = 5 * 60 * 1000;
const RECOVER_CODE_TTL_MS = 10 * 60 * 1000;
const BLOCKED_DEMO_LOGIN = {
  username: 'admin',
  password: 'admin123'
};

const {
  makeToken,
  parseToken,
  verifyPassword,
  isHashedPassword,
  destroyAuthSession,
  destroyUserAuthSessions,
  rateLimit,
  securityHeaders,
  generateRecoveryCode,
  allowPreviewCodes
} = security;

/** @type {Map<string, { userId: number, fullName: string, email: string, username: string, role: string, loggedInAt: string, lastSeenAt: number, currentPage: string, deviceId: string, deviceLabel: string }>} */
const activeSessions = new Map();

const ALLOWED_SESSION_PAGES = new Set([
  'cadastro',
  'armazem',
  'inventario',
  'obras',
  'cotacao',
  'factura',
  'diario',
  'historico',
  'cameras',
  'chat'
]);

function sessionKey(userId, deviceId) {
  return `${Number(userId)}::${String(deviceId || 'unknown')}`;
}

function getRequestDevice(req) {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  let labelHeader = String(req.headers['x-device-label'] || '').trim();
  try {
    labelHeader = labelHeader ? decodeURIComponent(labelHeader) : '';
  } catch {
    /* keep raw */
  }
  const deviceId = String(req.headers['x-device-id'] || body.deviceId || '')
    .trim()
    .slice(0, 80);
  const deviceLabel = String(labelHeader || body.deviceLabel || 'Dispositivo')
    .trim()
    .slice(0, 120);
  return {
    deviceId: deviceId || 'unknown',
    deviceLabel: deviceLabel || 'Dispositivo'
  };
}

function findSessionsByUserId(userId) {
  const id = Number(userId);
  return [...activeSessions.values()].filter((session) => Number(session.userId) === id);
}

function getLatestSessionForUser(userId) {
  return (
    findSessionsByUserId(userId).sort((a, b) => Number(b.lastSeenAt) - Number(a.lastSeenAt))[0] ||
    null
  );
}

function normalizeSessionPage(page) {
  const value = String(page || '').trim().toLowerCase();
  return ALLOWED_SESSION_PAGES.has(value) ? value : '';
}

/** @type {Map<string, { userId: number, code: string, phone: string, expiresAt: number, attempts: number }>} */
const smsRecoverCodes = new Map();

/** @type {Map<string, { userId: number, code: string, email: string, expiresAt: number, attempts: number }>} */
const emailRecoverCodes = new Map();

app.use(express.json({ limit: '12mb' }));
app.use(securityHeaders);
app.use(express.static(path.join(__dirname, 'public')));
app.use(
  '/vendor/simplewebauthn',
  express.static(
    path.join(__dirname, 'node_modules', '@simplewebauthn', 'browser', 'dist', 'bundle')
  )
);

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

function isCeo(userId) {
  return Number(userId) === CEO_USER_ID;
}

function toPublicUser(user) {
  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    email: user.email,
    role: user.role || '',
    photo: user.photo || '',
    isCeo: isCeo(user.id),
    loginQr: db.buildLoginQrPayload(user),
    faceIdEnabled: db.isFaceIdEnabled(user)
  };
}

function registerSession(user, extras = {}) {
  const now = Date.now();
  const deviceId = String(extras.deviceId || 'unknown').slice(0, 80) || 'unknown';
  const deviceLabel = String(extras.deviceLabel || 'Dispositivo').slice(0, 120) || 'Dispositivo';
  const key = sessionKey(user.id, deviceId);
  const existing = activeSessions.get(key);
  const page = normalizeSessionPage(extras.currentPage) || existing?.currentPage || '';
  activeSessions.set(key, {
    userId: Number(user.id),
    fullName: user.fullName || '',
    email: user.email || '',
    username: user.username || '',
    role: user.role || '',
    loggedInAt: existing?.loggedInAt || new Date(now).toISOString(),
    lastSeenAt: now,
    currentPage: page,
    deviceId,
    deviceLabel
  });
}

function touchSession(userId, extras = {}) {
  const id = Number(userId);
  const deviceId = String(extras.deviceId || '').trim() || 'unknown';
  const key = sessionKey(id, deviceId);
  const session = activeSessions.get(key);
  const page = normalizeSessionPage(extras.currentPage);
  if (session) {
    session.lastSeenAt = Date.now();
    if (page) session.currentPage = page;
    if (extras.deviceLabel) {
      session.deviceLabel = String(extras.deviceLabel).slice(0, 120);
    }
    return;
  }

  const user = db.getUserById(id);
  if (user) {
    registerSession(user, extras);
  }
}

function removeSession(userId, deviceId) {
  const id = Number(userId);
  if (deviceId) {
    activeSessions.delete(sessionKey(id, deviceId));
    return;
  }
  for (const [key, session] of activeSessions.entries()) {
    if (Number(session.userId) === id) activeSessions.delete(key);
  }
}

function pruneSessions() {
  const now = Date.now();
  for (const [key, session] of activeSessions.entries()) {
    if (now - session.lastSeenAt > SESSION_TIMEOUT_MS) {
      activeSessions.delete(key);
    }
  }
}

function getSessionPhoto(userId) {
  const user = db.getUserById(userId);
  return user?.photo || '';
}

function getOnlineSessions(requestDeviceId = '') {
  pruneSessions();
  const currentDevice = String(requestDeviceId || '');
  return [...activeSessions.values()]
    .map((session) => ({
      id: session.userId,
      sessionKey: sessionKey(session.userId, session.deviceId),
      fullName: session.fullName,
      email: session.email,
      username: session.username,
      role: session.role,
      loggedInAt: session.loggedInAt,
      lastSeenAt: new Date(session.lastSeenAt).toISOString(),
      currentPage: session.currentPage || '',
      photo: getSessionPhoto(session.userId),
      deviceId: session.deviceId || '',
      deviceLabel: session.deviceLabel || 'Dispositivo',
      isCurrentDevice: Boolean(currentDevice) && session.deviceId === currentDevice
    }))
    .sort(
      (a, b) =>
        a.fullName.localeCompare(b.fullName, 'pt') ||
        String(a.deviceLabel).localeCompare(String(b.deviceLabel), 'pt')
    );
}

function isUserOnline(userId) {
  pruneSessions();
  return findSessionsByUserId(userId).length > 0;
}

function authMiddleware(req, res, next) {
  const apiPath = String(req.path || '');
  const isPublicAuth =
    apiPath === '/login' ||
    apiPath === '/login/qr' ||
    apiPath.endsWith('/login') ||
    apiPath.endsWith('/login/qr') ||
    apiPath === '/recover' ||
    apiPath.startsWith('/recover/') ||
    /\/recover(\/|$)/.test(apiPath);
  if (isPublicAuth) {
    return next();
  }
  const authHeader = req.headers.authorization || req.headers['x-auth-token'];
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
  const parsed = parseToken(token);
  if (!parsed || !parsed.userId) {
    return res.status(401).json({ error: 'Não autorizado.' });
  }
  const userId = Number(parsed.userId);
  const dbUser = db.getUserById(userId);
  if (!dbUser) {
    destroyAuthSession(parsed.sid);
    return res.status(401).json({ error: 'Não autorizado.' });
  }
  req.authUserId = userId;
  req.authSid = parsed.sid;
  req.isCeo = isCeo(userId);
  const device = getRequestDevice(req);
  req.deviceId = device.deviceId;
  req.deviceLabel = device.deviceLabel;
  touchSession(userId, device);
  next();
}

function ceoOnly(req, res, next) {
  if (!req.isCeo) {
    return res.status(403).json({ error: 'Apenas o CEO pode realizar esta ação.' });
  }
  next();
}

app.use('/api', authMiddleware);

const loginRateLimit = rateLimit({
  name: 'login',
  windowMs: 15 * 60 * 1000,
  max: 12,
  blockMs: 15 * 60 * 1000
});

const recoverRateLimit = rateLimit({
  name: 'recover',
  windowMs: 15 * 60 * 1000,
  max: 8,
  blockMs: 20 * 60 * 1000
});

const recoverVerifyRateLimit = rateLimit({
  name: 'recover-verify',
  windowMs: 15 * 60 * 1000,
  max: 15,
  blockMs: 20 * 60 * 1000
});

app.post('/api/login', loginRateLimit, (req, res) => {
  const { username, password } = req.body || {};
  const login = String(username || '').trim();
  const pass = String(password || '');
  const device = getRequestDevice(req);

  // Bloquear credenciais demo antigas
  if (
    login.toLowerCase() === BLOCKED_DEMO_LOGIN.username &&
    pass === BLOCKED_DEMO_LOGIN.password
  ) {
    return res.status(401).json({ error: 'Credenciais inválidas.' });
  }

  const registered = db.findUserByLogin(login);
  if (registered && verifyPassword(pass, registered.password)) {
    if (!isHashedPassword(registered.password)) {
      db.updateUserPassword(registered.id, pass);
    }
    registerSession(registered, device);
    return res.json({
      token: makeToken(registered.id),
      user: toPublicUser(registered),
      device: {
        id: device.deviceId,
        label: device.deviceLabel
      }
    });
  }

  res.status(401).json({ error: 'Credenciais inválidas.' });
});

app.post('/api/login/qr', (req, res) => {
  return res.status(410).json({
    error: 'Login por QR deixou de estar disponível. Entre com utilizador e senha.'
  });
});

app.get('/api/webauthn/status', (req, res) => {
  const user = db.getUserById(req.authUserId);
  if (!user) return res.status(401).json({ error: 'Não autorizado.' });
  res.json({
    faceIdEnabled: db.isFaceIdEnabled(user),
    cameraFaceEnabled: db.hasFaceDescriptor(user),
    count: Array.isArray(user.webauthnCredentials) ? user.webauthnCredentials.length : 0
  });
});

app.post('/api/face/register', (req, res) => {
  const descriptor = req.body?.descriptor;
  const updated = db.setFaceDescriptor(req.authUserId, descriptor);
  if (!updated) {
    return res.status(404).json({ error: 'Utilizador não encontrado.' });
  }
  if (updated.error) {
    return res.status(updated.status || 400).json({ error: updated.error });
  }
  res.json({ success: true, faceIdEnabled: true, user: updated });
});

app.delete('/api/face/register', (req, res) => {
  const updated = db.clearFaceDescriptor(req.authUserId);
  if (!updated) return res.status(404).json({ error: 'Utilizador não encontrado.' });
  // Também remove WebAuthn antigo se existir
  db.removeWebAuthnCredentials(req.authUserId);
  const user = db.getUserById(req.authUserId);
  res.json({
    success: true,
    faceIdEnabled: false,
    user: user ? toPublicUser(user) : updated
  });
});

app.post('/api/webauthn/register/options', async (req, res) => {
  try {
    const user = db.getUserById(req.authUserId);
    if (!user) return res.status(401).json({ error: 'Não autorizado.' });
    const options = await webauthn.createRegistrationOptions(req, user);
    res.json(options);
  } catch (error) {
    console.error('webauthn register options:', error);
    res.status(500).json({ error: 'Não foi possível preparar o Face ID.' });
  }
});

app.post('/api/webauthn/register/verify', async (req, res) => {
  try {
    const user = db.getUserById(req.authUserId);
    if (!user) return res.status(401).json({ error: 'Não autorizado.' });
    const response = req.body?.response || req.body;
    const result = await webauthn.verifyRegistration(req, user, response);
    if (!result.ok) {
      return res.status(400).json({ error: result.error || 'Falha ao ativar Face ID.' });
    }
    const updated = db.addWebAuthnCredential(user.id, result.credential);
    res.json({
      success: true,
      faceIdEnabled: true,
      user: updated
    });
  } catch (error) {
    console.error('webauthn register verify:', error);
    res.status(400).json({ error: 'Não foi possível ativar o Face ID.' });
  }
});

app.delete('/api/webauthn/register', (req, res) => {
  const updated = db.removeWebAuthnCredentials(req.authUserId);
  if (!updated) return res.status(404).json({ error: 'Utilizador não encontrado.' });
  res.json({ success: true, faceIdEnabled: false, user: updated });
});

app.post('/api/logout', (req, res) => {
  destroyAuthSession(req.authSid);
  removeSession(req.authUserId, req.deviceId);
  res.json({ success: true });
});

app.get('/api/desktop-settings', (req, res) => {
  res.json(desktop.getPublicSettings());
});

app.put('/api/desktop-settings', ceoOnly, async (req, res) => {
  const body = req.body || {};
  const result = await desktop.updateSettings({
    openFullscreen: body.openFullscreen,
    autoStart: body.autoStart
  });
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result);
});

app.post('/api/heartbeat', (req, res) => {
  const page = normalizeSessionPage(req.body?.page);
  const device = {
    deviceId: req.deviceId,
    deviceLabel: req.deviceLabel,
    ...(page ? { currentPage: page } : {})
  };
  touchSession(req.authUserId, device);
  const session = activeSessions.get(sessionKey(req.authUserId, req.deviceId));
  res.json({
    success: true,
    online: true,
    currentPage: session?.currentPage || '',
    device: {
      id: session?.deviceId || req.deviceId,
      label: session?.deviceLabel || req.deviceLabel
    }
  });
});

app.get('/api/me', (req, res) => {
  const id = Number(req.authUserId);
  const user = db.getUserById(id);
  if (!user) {
    return res.status(401).json({ error: 'Sessão inválida. Faça login novamente.' });
  }
  const session = activeSessions.get(sessionKey(id, req.deviceId));
  res.json({
    ...toPublicUser(user),
    device: {
      id: req.deviceId,
      label: session?.deviceLabel || req.deviceLabel
    },
    sessionActive: Boolean(session)
  });
});

app.get('/api/users', ceoOnly, (req, res) => {
  pruneSessions();
  const users = db
    .getAllUsers()
    .map(({ password, qrLoginKey, faceDescriptor, webauthnCredentials, ...user }) => {
      const latest = getLatestSessionForUser(user.id);
      return {
        ...user,
        loginQr: db.buildLoginQrPayload({ ...user, qrLoginKey }),
        faceIdEnabled: db.isFaceIdEnabled({ ...user, faceDescriptor, webauthnCredentials }),
        isOnline: Boolean(latest),
        lastSeenAt: latest ? new Date(latest.lastSeenAt).toISOString() : null,
        loggedInAt: latest?.loggedInAt || null,
        deviceLabel: latest?.deviceLabel || null
      };
    })
    .sort((a, b) => Number(b.isOnline) - Number(a.isOnline) || b.id - a.id);
  res.json(users);
});

app.get('/api/sessions', ceoOnly, (req, res) => {
  res.json(getOnlineSessions(req.deviceId));
});

function localDateKey(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isOnLocalDate(iso, dateKey) {
  if (!iso || !dateKey) return false;
  return localDateKey(iso) === dateKey;
}

app.get('/api/users/:id/activity', ceoOnly, (req, res) => {
  const id = Number(req.params.id);
  const user = db.getUserById(id);
  if (!user) {
    return res.status(404).json({ error: 'Utilizador não encontrado.' });
  }

  const dateKey = String(req.query.date || '').trim() || localDateKey(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    return res.status(400).json({ error: 'Data inválida. Use AAAA-MM-DD.' });
  }

  const userNames = new Set(
    [user.fullName, user.username, user.email]
      .map((value) => String(value || '').trim().toLowerCase())
      .filter(Boolean)
  );

  function isSameUser(entryUserId, entryUserName) {
    if (Number(entryUserId) === id) return true;
    const name = String(entryUserName || '').trim().toLowerCase();
    return Boolean(name && userNames.has(name));
  }

  function formatMetaDetail(meta = {}, type, action) {
    const parts = [];
    if (meta.amount != null && Number.isFinite(Number(meta.amount))) {
      parts.push(`${Number(meta.amount).toFixed(2)} MT`);
    }
    if (meta.quantity != null && Number.isFinite(Number(meta.quantity))) {
      parts.push(`Qtd ${meta.quantity}`);
    }
    if (meta.itemName) parts.push(String(meta.itemName));
    if (meta.barcode) parts.push(`Cód. ${meta.barcode}`);
    if (meta.supplierName) parts.push(`Fornecedor ${meta.supplierName}`);
    if (meta.client) parts.push(`Cliente ${meta.client}`);
    if (meta.date && meta.date !== dateKey) parts.push(`Data ${meta.date}`);
    if (!parts.length) {
      return [type, action].filter(Boolean).join(' · ');
    }
    return parts.join(' · ');
  }

  const historyEvents = db
    .getAllHistory()
    .filter((entry) => isSameUser(entry.userId, entry.userName) && isOnLocalDate(entry.created_at, dateKey))
    .map((entry) => {
      const meta = entry.meta && typeof entry.meta === 'object' ? entry.meta : {};
      return {
        id: `history-${entry.id}`,
        source: 'history',
        at: entry.created_at,
        type: entry.type || 'sistema',
        action: entry.action || '',
        title: entry.summary || 'Movimento no sistema',
        detail: formatMetaDetail(meta, entry.type, entry.action),
        amount: meta.amount != null ? Number(meta.amount) : null,
        quantity: meta.quantity != null ? Number(meta.quantity) : null,
        meta
      };
    });

  const historyMovementIds = new Set(
    historyEvents
      .map((event) => Number(event.meta?.movementId))
      .filter((value) => Number.isFinite(value) && value > 0)
  );

  const day = db.getDiarioDay(dateKey);
  const diarioEvents =
    day && !day.error && Array.isArray(day.movements)
      ? day.movements
          .filter((m) => isSameUser(m.userId, m.userName))
          .filter((m) => !historyMovementIds.has(Number(m.id)))
          .map((m) => ({
            id: `diario-${m.id}`,
            source: 'diario',
            at: m.created_at || `${dateKey}T12:00:00.000Z`,
            type: 'diario',
            action: m.type || '',
            title:
              m.description ||
              (m.type === 'entrada' ? 'Entrada no diário' : 'Saída no diário'),
            detail: `${m.type === 'entrada' ? 'Entrada' : 'Saída'}: ${Number(m.amount || 0).toFixed(2)} MT`,
            amount: Number(m.amount) || 0,
            quantity: null,
            meta: { movementId: m.id, amount: m.amount, date: dateKey }
          }))
      : [];

  const chatEvents = db
    .getAllMessages()
    .filter((msg) => Number(msg.userId) === id && isOnLocalDate(msg.created_at, dateKey))
    .map((msg) => ({
      id: `chat-${msg.id}`,
      source: 'chat',
      at: msg.created_at,
      type: 'chat',
      action: 'mensagem',
      title: 'Mensagem no chat',
      detail: String(msg.text || '').slice(0, 220),
      amount: null,
      quantity: null,
      meta: { messageId: msg.id }
    }));

  const chatOkEvents = [];
  const chatViewEvents = [];
  for (const msg of db.getAllMessages()) {
    for (const ok of msg.oks || []) {
      if (Number(ok.userId) === id && isOnLocalDate(ok.okAt || ok.at || ok.created_at, dateKey)) {
        chatOkEvents.push({
          id: `chat-ok-${msg.id}-${ok.userId}`,
          source: 'chat',
          at: ok.okAt || ok.at || ok.created_at,
          type: 'chat',
          action: 'ok',
          title: 'Confirmou OK numa mensagem',
          detail: String(msg.text || '').slice(0, 160),
          amount: null,
          quantity: null,
          meta: { messageId: msg.id }
        });
      }
    }
    for (const view of msg.views || []) {
      if (
        Number(view.userId) === id &&
        isOnLocalDate(view.viewedAt || view.at || view.created_at, dateKey)
      ) {
        chatViewEvents.push({
          id: `chat-view-${msg.id}-${view.userId}`,
          source: 'chat',
          at: view.viewedAt || view.at || view.created_at,
          type: 'chat',
          action: 'visualizacao',
          title: 'Visualizou uma mensagem',
          detail: String(msg.text || '').slice(0, 160),
          amount: null,
          quantity: null,
          meta: { messageId: msg.id }
        });
      }
    }
  }

  const entityEvents = [];
  for (const cliente of db.getAllClientes()) {
    if (!isSameUser(cliente.userId, cliente.userName) || !isOnLocalDate(cliente.created_at, dateKey)) {
      continue;
    }
    entityEvents.push({
      id: `cliente-${cliente.id}`,
      source: 'cliente',
      at: cliente.created_at,
      type: 'cliente',
      action: 'criacao',
      title: `Cliente cadastrado: ${cliente.name || '—'}`,
      detail: [cliente.phone, cliente.email].filter(Boolean).join(' · ') || 'Cadastro de cliente',
      amount: null,
      quantity: null,
      meta: { clienteId: cliente.id }
    });
  }
  for (const fornecedor of db.getAllFornecedores()) {
    if (
      !isSameUser(fornecedor.userId, fornecedor.userName) ||
      !isOnLocalDate(fornecedor.created_at, dateKey)
    ) {
      continue;
    }
    entityEvents.push({
      id: `fornecedor-${fornecedor.id}`,
      source: 'fornecedor',
      at: fornecedor.created_at,
      type: 'fornecedor',
      action: 'criacao',
      title: `Fornecedor cadastrado: ${fornecedor.name || '—'}`,
      detail: [fornecedor.phone, fornecedor.email].filter(Boolean).join(' · ') || 'Cadastro de fornecedor',
      amount: null,
      quantity: null,
      meta: { fornecedorId: fornecedor.id }
    });
  }
  for (const cotacao of db.getAllCotacoes()) {
    if (!isSameUser(cotacao.userId, cotacao.userName) || !isOnLocalDate(cotacao.created_at, dateKey)) {
      continue;
    }
    entityEvents.push({
      id: `cotacao-${cotacao.id}`,
      source: 'cotacao',
      at: cotacao.created_at,
      type: 'cotacao',
      action: 'criacao',
      title: `Cotação ${cotacao.number || cotacao.id}: ${cotacao.client || '—'}`,
      detail: `${Array.isArray(cotacao.items) ? cotacao.items.length : 0} itens · ${cotacao.status || 'rascunho'}`,
      amount: null,
      quantity: null,
      meta: { cotacaoId: cotacao.id }
    });
  }

  // Evitar duplicar cadastros já presentes no histórico
  const historyTitles = new Set(historyEvents.map((e) => String(e.title || '').toLowerCase()));
  const entityUnique = entityEvents.filter(
    (e) => !historyTitles.has(String(e.title || '').toLowerCase())
  );

  const userSessions = findSessionsByUserId(id);
  const session = getLatestSessionForUser(id);
  const sessionEvents = [];
  for (const active of userSessions) {
    if (active?.loggedInAt && isOnLocalDate(active.loggedInAt, dateKey)) {
      sessionEvents.push({
        id: `session-login-${id}-${active.deviceId || 'unknown'}`,
        source: 'sessao',
        at: active.loggedInAt,
        type: 'sessao',
        action: 'login',
        title: 'Entrou no sistema',
        detail: [
          active.deviceLabel || 'Dispositivo',
          active.currentPage ? `Página: ${active.currentPage}` : 'Sessão ativa'
        ].join(' · '),
        amount: null,
        quantity: null,
        meta: {
          currentPage: active.currentPage || '',
          deviceId: active.deviceId || '',
          deviceLabel: active.deviceLabel || ''
        }
      });
    }
  }

  const events = [
    ...historyEvents,
    ...diarioEvents,
    ...chatEvents,
    ...chatOkEvents,
    ...chatViewEvents,
    ...entityUnique,
    ...sessionEvents
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  res.json({
    date: dateKey,
    user: {
      id: user.id,
      fullName: user.fullName || '',
      email: user.email || '',
      username: user.username || '',
      role: user.role || '',
      photo: user.photo || ''
    },
    session: session
      ? {
          currentPage: session.currentPage || '',
          loggedInAt: session.loggedInAt || null,
          lastSeenAt: new Date(session.lastSeenAt).toISOString(),
          deviceId: session.deviceId || '',
          deviceLabel: session.deviceLabel || ''
        }
      : null,
    summary: {
      total: events.length,
      history: historyEvents.length,
      diario: diarioEvents.length,
      chat: chatEvents.length + chatOkEvents.length + chatViewEvents.length,
      cadastros: entityUnique.length,
      sessao: sessionEvents.length
    },
    events
  });
});

function normalizeIncomingFaceDescriptor(value) {
  if (value === undefined || value === null || value === '') return null;
  if (!Array.isArray(value) || value.length < 64) {
    return { error: 'Descritor facial inválido. Capture o rosto novamente.' };
  }
  return value.map((n) => Number(n));
}

function userResponseWithoutSecrets(userId) {
  const user = db.getUserById(userId);
  if (!user) return null;
  const { password, qrLoginKey, faceDescriptor, webauthnCredentials, ...safe } = user;
  return {
    ...safe,
    loginQr: db.buildLoginQrPayload(user),
    faceIdEnabled: db.isFaceIdEnabled(user)
  };
}

app.post('/api/users', ceoOnly, (req, res) => {
  const {
    fullName,
    email,
    username,
    password,
    phone,
    documentId,
    birthDate,
    role,
    department,
    address,
    city,
    country,
    photo,
    faceDescriptor
  } = req.body || {};

  if (!fullName || !email || !username || !password) {
    return res.status(400).json({ error: 'Nome completo, email, utilizador e senha são obrigatórios.' });
  }
  if (!String(email).includes('@')) {
    return res.status(400).json({ error: 'Indique um email válido.' });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres.' });
  }
  if (db.findUserByUsernameOrEmail(username, email)) {
    return res.status(409).json({ error: 'Já existe um utilizador com este email ou nome de utilizador.' });
  }

  const normalizedFace = normalizeIncomingFaceDescriptor(faceDescriptor);
  if (normalizedFace?.error) {
    return res.status(400).json({ error: normalizedFace.error });
  }

  let safePhoto = '';
  if (photo && String(photo).startsWith('data:image/')) {
    if (String(photo).length > 2_500_000) {
      return res.status(400).json({ error: 'A foto é demasiado grande. Use uma imagem mais leve.' });
    }
    safePhoto = String(photo);
  }

  const user = db.addUser({
    fullName: String(fullName).trim(),
    email: String(email).trim(),
    username: String(username).trim(),
    password: String(password),
    phone: phone ? String(phone).trim() : '',
    documentId: documentId ? String(documentId).trim() : '',
    birthDate: birthDate || '',
    role: role ? String(role).trim() : '',
    department: department ? String(department).trim() : '',
    address: address ? String(address).trim() : '',
    city: city ? String(city).trim() : '',
    country: country ? String(country).trim() : '',
    photo: safePhoto
  });

  if (normalizedFace) {
    const faceResult = db.setFaceDescriptor(user.id, normalizedFace);
    if (faceResult?.error) {
      return res.status(faceResult.status || 400).json({ error: faceResult.error });
    }
  }

  res.status(201).json(userResponseWithoutSecrets(user.id) || user);
});

app.put('/api/users/:id', ceoOnly, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.getUserById(id);
  if (!existing) {
    return res.status(404).json({ error: 'Utilizador não encontrado.' });
  }

  const {
    fullName,
    email,
    username,
    password,
    phone,
    documentId,
    birthDate,
    role,
    department,
    address,
    city,
    country,
    photo,
    faceDescriptor,
    clearFaceDescriptor
  } = req.body || {};

  if (!fullName || !email || !username) {
    return res.status(400).json({ error: 'Nome completo, email e utilizador são obrigatórios.' });
  }
  if (!String(email).includes('@')) {
    return res.status(400).json({ error: 'Indique um email válido.' });
  }
  if (password && String(password).length < 6) {
    return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres.' });
  }
  if (db.findUserByUsernameOrEmail(username, email, id)) {
    return res.status(409).json({ error: 'Já existe um utilizador com este email ou nome de utilizador.' });
  }

  const normalizedFace = normalizeIncomingFaceDescriptor(faceDescriptor);
  if (normalizedFace?.error) {
    return res.status(400).json({ error: normalizedFace.error });
  }

  let safePhoto = existing.photo || '';
  if (photo === '') {
    safePhoto = '';
  } else if (photo && String(photo).startsWith('data:image/')) {
    if (String(photo).length > 2_500_000) {
      return res.status(400).json({ error: 'A foto é demasiado grande. Use uma imagem mais leve.' });
    }
    safePhoto = String(photo);
  }

  db.updateUser(id, {
    fullName: String(fullName).trim(),
    email: String(email).trim(),
    username: String(username).trim(),
    password: password ? String(password) : '',
    phone: phone ? String(phone).trim() : '',
    documentId: documentId ? String(documentId).trim() : '',
    birthDate: birthDate || '',
    role: role ? String(role).trim() : '',
    department: department ? String(department).trim() : '',
    address: address ? String(address).trim() : '',
    city: city ? String(city).trim() : '',
    country: country ? String(country).trim() : '',
    photo: safePhoto
  });

  if (password) {
    destroyUserAuthSessions(id);
    removeSession(id);
  }

  if (normalizedFace) {
    const faceResult = db.setFaceDescriptor(id, normalizedFace);
    if (faceResult?.error) {
      return res.status(faceResult.status || 400).json({ error: faceResult.error });
    }
  } else if (clearFaceDescriptor === true) {
    db.clearFaceDescriptor(id);
    db.removeWebAuthnCredentials(id);
  }

  res.json(userResponseWithoutSecrets(id));
});

app.delete('/api/users/:id', ceoOnly, (req, res) => {
  const id = Number(req.params.id);
  if (id === CEO_USER_ID) {
    return res.status(403).json({ error: 'Não é possível excluir o utilizador CEO.' });
  }
  const success = db.deleteUser(id);
  if (!success) {
    return res.status(404).json({ error: 'Utilizador não encontrado.' });
  }
  destroyUserAuthSessions(id);
  removeSession(id);
  res.json({ success: true });
});

app.post('/api/recover', recoverRateLimit, async (req, res) => {
  const { method, email, phone, username, message } = req.body || {};

  if (method === 'email') {
    const normalized = mail.normalizeEmail(email);
    if (!normalized) {
      return res.status(400).json({ error: 'Indique um email válido.' });
    }

    const user = db.findUserByLogin(normalized);
    // Resposta genérica se o email não existir (não revelar contas)
    if (!user) {
      return res.json({
        title: 'Email enviado',
        message: `Se existir uma conta para ${normalized}, enviámos um código. O código expira em 10 minutos.`,
        nextStep: 'email-verify',
        email: normalized
      });
    }

    const code = generateRecoveryCode();
    emailRecoverCodes.set(normalized, {
      userId: user.id,
      code,
      email: normalized,
      expiresAt: Date.now() + RECOVER_CODE_TTL_MS,
      attempts: 0
    });

    const emailText = [
      'Isoft — recuperação de senha',
      '',
      `Olá${user.fullName ? ` ${user.fullName}` : ''},`,
      '',
      `O seu código de recuperação é: ${code}`,
      'Válido por 10 minutos.',
      '',
      `Utilizador: ${user.username}`,
      '',
      'Se não pediu esta recuperação, ignore este email.',
      '',
      '— Equipa Isoft / Sisoft'
    ].join('\n');

    let sendResult;
    try {
      sendResult = await mail.sendEmail(
        normalized,
        'Isoft — código de recuperação de senha',
        emailText
      );
    } catch (error) {
      console.error('Erro ao enviar email:', error);
      sendResult = { ok: false, error: error.message || 'Falha no envio de email.' };
    }

    if (!sendResult.ok) {
      console.log(`[Email recuperação] Código gerado para utilizador ${user.username} (envio falhou)`);
      if ((sendResult.notConfigured || process.env.MAIL_DEV_MODE === '1') && allowPreviewCodes(req)) {
        return res.json({
          title: 'Código gerado',
          message: 'Use o código abaixo para redefinir a senha. Válido por 10 minutos.',
          nextStep: 'email-verify',
          email: normalized,
          previewCode: code,
          emailDelivered: false
        });
      }
      return res.status(502).json({
        error: sendResult.error || 'Não foi possível enviar o email. Tente novamente.'
      });
    }

    console.log(`[Email recuperação] Enviado para ${normalized} via ${sendResult.provider}`);
    return res.json({
      title: 'Email enviado',
      message: `Enviámos um código de verificação para ${normalized}. O código expira em 10 minutos. Verifique também a pasta de spam.`,
      nextStep: 'email-verify',
      email: normalized,
      emailDelivered: true
    });
  }

  if (method === 'sms') {
    const normalized = sms.normalizePhone(phone);
    if (!normalized) {
      return res.status(400).json({ error: 'Indique um número de telemóvel válido (ex.: +258 84 000 0000).' });
    }

    const user = db.findUserByPhone(normalized);
    // Resposta genérica se o número não existir (não revelar contas)
    if (!user) {
      return res.json({
        title: 'SMS enviado',
        message: `Se existir uma conta com o número ${normalized}, enviámos um código. O código expira em 10 minutos.`,
        nextStep: 'sms-verify',
        phone: normalized
      });
    }

    const code = generateRecoveryCode();
    smsRecoverCodes.set(normalized, {
      userId: user.id,
      code,
      phone: normalized,
      expiresAt: Date.now() + RECOVER_CODE_TTL_MS,
      attempts: 0
    });

    const smsText = `Isoft: o seu código de recuperação é ${code}. Válido por 10 minutos.`;
    let sendResult;
    try {
      sendResult = await sms.sendSms(normalized, smsText);
    } catch (error) {
      console.error('Erro ao enviar SMS:', error);
      sendResult = { ok: false, error: error.message || 'Falha no envio SMS.' };
    }

    if (!sendResult.ok) {
      console.log(`[SMS recuperação] Código gerado para utilizador ${user.username} (envio falhou)`);
      if ((sendResult.notConfigured || process.env.SMS_DEV_MODE === '1') && allowPreviewCodes(req)) {
        return res.json({
          title: 'Código gerado',
          message: 'Use o código abaixo para redefinir a senha. Válido por 10 minutos.',
          nextStep: 'sms-verify',
          phone: normalized,
          previewCode: code,
          smsDelivered: false
        });
      }
      return res.status(502).json({
        error: sendResult.error || 'Não foi possível enviar o SMS. Tente novamente.'
      });
    }

    console.log(`[SMS recuperação] Enviado para ${normalized} via ${sendResult.provider}`);
    return res.json({
      title: 'SMS enviado',
      message: `Enviámos um código de verificação para ${normalized}. O código expira em 10 minutos.`,
      nextStep: 'sms-verify',
      phone: normalized,
      smsDelivered: true
    });
  }

  if (method === 'admin') {
    if (!username || !String(username).trim()) {
      return res.status(400).json({ error: 'Indique o utilizador ou email da conta.' });
    }
    return res.json({
      title: 'Pedido registado',
      message: message
        ? 'O administrador Isoft vai analisar o seu pedido e contactá-lo em breve.'
        : `Pedido de redefinição para “${username}” enviado ao administrador.`
    });
  }

  res.status(400).json({ error: 'Método de recuperação inválido.' });
});

app.post('/api/recover/sms/verify', recoverVerifyRateLimit, (req, res) => {
  const { phone, code, newPassword } = req.body || {};
  const normalized = sms.normalizePhone(phone);
  if (!normalized) {
    return res.status(400).json({ error: 'Número de telemóvel inválido.' });
  }
  if (!code || String(code).trim().length < 4) {
    return res.status(400).json({ error: 'Indique o código recebido por SMS.' });
  }
  if (!newPassword || String(newPassword).length < 6) {
    return res.status(400).json({ error: 'A nova senha deve ter pelo menos 6 caracteres.' });
  }

  const entry = smsRecoverCodes.get(normalized);
  if (!entry || entry.expiresAt < Date.now()) {
    smsRecoverCodes.delete(normalized);
    return res.status(400).json({ error: 'Código expirado ou inválido. Peça um novo código.' });
  }

  entry.attempts += 1;
  if (entry.attempts > 5) {
    smsRecoverCodes.delete(normalized);
    return res.status(429).json({ error: 'Demasiadas tentativas. Peça um novo código.' });
  }

  if (String(entry.code) !== String(code).trim()) {
    return res.status(400).json({ error: 'Código incorreto.' });
  }

  const updated = db.updateUserPassword(entry.userId, String(newPassword));
  smsRecoverCodes.delete(normalized);
  if (!updated || updated.error) {
    return res.status(400).json({ error: updated?.error || 'Não foi possível atualizar a senha.' });
  }

  destroyUserAuthSessions(entry.userId);
  removeSession(entry.userId);

  return res.json({
    title: 'Senha atualizada',
    message: 'A sua senha foi redefinida com sucesso. Já pode entrar com a nova senha.'
  });
});

app.post('/api/recover/email/verify', recoverVerifyRateLimit, (req, res) => {
  const { email, code, newPassword } = req.body || {};
  const normalized = mail.normalizeEmail(email);
  if (!normalized) {
    return res.status(400).json({ error: 'Email inválido.' });
  }
  if (!code || String(code).trim().length < 4) {
    return res.status(400).json({ error: 'Indique o código recebido por email.' });
  }
  if (!newPassword || String(newPassword).length < 6) {
    return res.status(400).json({ error: 'A nova senha deve ter pelo menos 6 caracteres.' });
  }

  const entry = emailRecoverCodes.get(normalized);
  if (!entry || entry.expiresAt < Date.now()) {
    emailRecoverCodes.delete(normalized);
    return res.status(400).json({ error: 'Código expirado ou inválido. Peça um novo código.' });
  }

  entry.attempts += 1;
  if (entry.attempts > 5) {
    emailRecoverCodes.delete(normalized);
    return res.status(429).json({ error: 'Demasiadas tentativas. Peça um novo código.' });
  }

  if (String(entry.code) !== String(code).trim()) {
    return res.status(400).json({ error: 'Código incorreto.' });
  }

  const updated = db.updateUserPassword(entry.userId, String(newPassword));
  emailRecoverCodes.delete(normalized);
  if (!updated || updated.error) {
    return res.status(400).json({ error: updated?.error || 'Não foi possível atualizar a senha.' });
  }

  destroyUserAuthSessions(entry.userId);
  removeSession(entry.userId);

  return res.json({
    title: 'Senha atualizada',
    message: 'A sua senha foi redefinida com sucesso. Já pode entrar com a nova senha.'
  });
});

app.get('/api/items', (req, res) => {
  const items = db.getAllItems().sort((a, b) => b.id - a.id);
  res.json(items);
});

app.get('/api/items/barcode/:code', (req, res) => {
  const item = db.findItemByBarcode(req.params.code);
  if (!item) {
    return res.status(404).json({ error: 'Produto não encontrado para este código de barras.' });
  }
  res.json(item);
});

app.post('/api/items', ceoOnly, async (req, res) => {
  const { name, quantity, price, cost, barcode, supplierId, supplierName } = req.body;
  if (!name || typeof quantity !== 'number' || typeof price !== 'number') {
    return res.status(400).json({ error: 'Nome, quantidade e preço de venda são obrigatórios.' });
  }
  const item = db.addItem({
    name,
    quantity,
    price,
    cost: typeof cost === 'number' ? cost : Number(cost) || 0,
    barcode,
    supplierId,
    supplierName
  });
  if (item.error) {
    return res.status(item.status || 400).json({ error: item.error });
  }

  logHistory(req, {
    type: 'armazem',
    action: 'entrada',
    summary: `Entrada de stock: ${item.name} (qtd ${item.quantity})${item.supplierName ? ` — fornecedor ${item.supplierName}` : ''}`,
    meta: {
      itemId: item.id,
      barcode: item.barcode || '',
      quantity: item.quantity,
      cost: item.cost,
      price: item.price,
      supplierId: item.supplierId || null,
      supplierName: item.supplierName || ''
    }
  });

  res.status(201).json(item);
});

app.get('/api/items/entry-extract', ceoOnly, async (req, res) => {
  const period = String(req.query.period || 'daily').toLowerCase();
  const allowed = ['daily', 'weekly', 'monthly', 'yearly', 'custom'];
  if (!allowed.includes(period)) {
    return res.status(400).json({
      error: 'Período inválido. Use daily, weekly, monthly, yearly ou custom.'
    });
  }
  const anchor = String(req.query.date || req.query.anchor || '').trim() || new Date().toISOString().slice(0, 10);
  const from = String(req.query.from || '').trim();
  const to = String(req.query.to || '').trim();
  const supplierId = String(req.query.supplierId || '').trim();
  const supplierName = String(req.query.supplierName || '').trim();
  const extract = reports.collectStockExtractData(period, anchor, {
    from,
    to,
    supplierId: supplierId || undefined,
    supplierName
  });
  if (extract.error) {
    return res.status(400).json({ error: extract.error });
  }
  try {
    const author = resolveAuthUser(req.authUserId);
    const pdf = await reports.generateStockPeriodExtractPdf(extract, {
      userName: author.fullName || author.username || 'Utilizador'
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${pdf.fileName}"`);
    res.sendFile(pdf.filePath);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Não foi possível gerar o extrato do armazém.' });
  }
});

app.get('/api/items/:id/entry-report', ceoOnly, async (req, res) => {
  const id = Number(req.params.id);
  const item = db.getItem(id);
  if (!item) {
    return res.status(404).json({ error: 'Item não encontrado.' });
  }
  try {
    const author = resolveAuthUser(req.authUserId);
    const entryReport = await reports.generateStockEntryPdf(item, {
      userName: author.fullName || author.username || 'Utilizador'
    });
    res.download(entryReport.filePath, entryReport.fileName);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Não foi possível gerar o relatório de entrada.' });
  }
});

app.put('/api/items/:id', ceoOnly, (req, res) => {
  const id = Number(req.params.id);
  const { name, quantity, price, cost, barcode, supplierId, supplierName } = req.body;
  if (!name || typeof quantity !== 'number' || typeof price !== 'number') {
    return res.status(400).json({ error: 'Nome, quantidade e preço de venda são obrigatórios.' });
  }
  const item = db.updateItem(id, {
    name,
    quantity,
    price,
    cost: typeof cost === 'number' ? cost : Number(cost) || 0,
    barcode,
    supplierId,
    supplierName
  });
  if (!item) {
    return res.status(404).json({ error: 'Item não encontrado.' });
  }
  if (item.error) {
    return res.status(item.status || 400).json({ error: item.error });
  }
  logHistory(req, {
    type: 'armazem',
    action: 'atualizacao',
    summary: `Atualização de stock: ${item.name} (qtd ${item.quantity})`,
    meta: { itemId: item.id, barcode: item.barcode || '', quantity: item.quantity }
  });
  res.json(item);
});

app.delete('/api/items', ceoOnly, (req, res) => {
  const result = db.clearAllItems();
  logHistory(req, {
    type: 'armazem',
    action: 'limpeza',
    summary: `Armazém limpo (${result.removed} produtos removidos)`,
    meta: { removed: result.removed }
  });
  res.json({ success: true, removed: result.removed });
});

app.delete('/api/items/:id', ceoOnly, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.getItem(id);
  const success = db.deleteItem(id);
  if (!success) {
    return res.status(404).json({ error: 'Item não encontrado.' });
  }
  logHistory(req, {
    type: 'armazem',
    action: 'exclusao',
    summary: `Produto removido do stock: ${existing?.name || `#${id}`}`,
    meta: { itemId: id, barcode: existing?.barcode || '' }
  });
  res.json({ success: true });
});

app.get('/api/summary', (req, res) => {
  res.json(db.getSummary());
});

app.get('/api/obras', (req, res) => {
  const obras = db.getAllObras().sort((a, b) => b.id - a.id);
  res.json(obras);
});

app.post('/api/obras', (req, res) => {
  const { client, name, phone, brand, model, mileage, entryDate, plate, serviceDescription } = req.body || {};
  const clientName = String(client || name || '').trim();
  if (!clientName) {
    return res.status(400).json({ error: 'O nome do cliente é obrigatório.' });
  }
  if (!phone || !String(phone).trim()) {
    return res.status(400).json({ error: 'O celular é obrigatório.' });
  }
  if (!brand || !String(brand).trim()) {
    return res.status(400).json({ error: 'A marca é obrigatória.' });
  }
  if (!model || !String(model).trim()) {
    return res.status(400).json({ error: 'O modelo é obrigatório.' });
  }
  if (!plate || !String(plate).trim()) {
    return res.status(400).json({ error: 'A matrícula é obrigatória.' });
  }
  if (!entryDate) {
    return res.status(400).json({ error: 'A data de entrada é obrigatória.' });
  }
  const obra = db.addObra({
    client: clientName,
    phone: String(phone).trim(),
    brand: String(brand).trim(),
    model: String(model).trim(),
    mileage: Number(mileage) || 0,
    entryDate,
    plate: String(plate).trim().toUpperCase(),
    serviceDescription: String(serviceDescription || '').trim()
  });
  logHistory(req, {
    type: 'obras',
    action: 'criacao',
    summary: `Nova obra: ${obra.client} · ${obra.brand} ${obra.model} (${obra.plate})`,
    meta: { obraId: obra.id, plate: obra.plate }
  });
  res.status(201).json(obra);
});

app.put('/api/obras/:id', (req, res) => {
  const id = Number(req.params.id);
  const { client, name, phone, brand, model, mileage, entryDate, plate, serviceDescription } = req.body || {};
  const clientName = String(client || name || '').trim();
  if (!clientName) {
    return res.status(400).json({ error: 'O nome do cliente é obrigatório.' });
  }
  if (!phone || !String(phone).trim()) {
    return res.status(400).json({ error: 'O celular é obrigatório.' });
  }
  if (!brand || !String(brand).trim()) {
    return res.status(400).json({ error: 'A marca é obrigatória.' });
  }
  if (!model || !String(model).trim()) {
    return res.status(400).json({ error: 'O modelo é obrigatório.' });
  }
  if (!plate || !String(plate).trim()) {
    return res.status(400).json({ error: 'A matrícula é obrigatória.' });
  }
  if (!entryDate) {
    return res.status(400).json({ error: 'A data de entrada é obrigatória.' });
  }
  const obra = db.updateObra(id, {
    client: clientName,
    phone: String(phone).trim(),
    brand: String(brand).trim(),
    model: String(model).trim(),
    mileage: Number(mileage) || 0,
    entryDate,
    plate: String(plate).trim().toUpperCase(),
    serviceDescription: String(serviceDescription || '').trim()
  });
  if (!obra) {
    return res.status(404).json({ error: 'Obra não encontrada.' });
  }
  logHistory(req, {
    type: 'obras',
    action: 'atualizacao',
    summary: `Obra atualizada: ${obra.client} · ${obra.plate}`,
    meta: { obraId: obra.id, plate: obra.plate }
  });
  res.json(obra);
});

app.delete('/api/obras/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.getAllObras().find((o) => o.id === id);
  const success = db.deleteObra(id);
  if (!success) {
    return res.status(404).json({ error: 'Obra não encontrada.' });
  }
  logHistory(req, {
    type: 'obras',
    action: 'exclusao',
    summary: `Obra excluída: ${existing?.client || `#${id}`} · ${existing?.plate || '—'}`,
    meta: { obraId: id, plate: existing?.plate || '' }
  });
  res.json({ success: true });
});

app.post('/api/obras/:id/requisicoes', (req, res) => {
  const id = Number(req.params.id);
  const { itemId, quantity } = req.body || {};
  if (!itemId) {
    return res.status(400).json({ error: 'Selecione um produto do stock.' });
  }
  const result = db.addRequisicao(id, { itemId, quantity });
  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  const requisicao = result.requisicao;
  const qty = Number(quantity) || 0;
  const itemName = requisicao?.itemName || 'material';
  const obraLabel = `#${String(id).padStart(6, '0')}`;

  logHistory(req, {
    type: 'requisicao',
    action: 'requisicao',
    summary: `Requisição: ${itemName} (qtd ${qty}) · obra ${obraLabel} · saída do armazém`,
    meta: {
      obraId: id,
      itemId: requisicao?.itemId || itemId,
      quantity: qty,
      itemName
    }
  });
  res.status(201).json(result);
});

app.put('/api/obras/:id/requisicoes/:reqId', (req, res) => {
  const id = Number(req.params.id);
  const reqId = Number(req.params.reqId);
  const { quantity } = req.body || {};
  if (quantity === undefined || quantity === null || quantity === '') {
    return res.status(400).json({ error: 'Indique a nova quantidade.' });
  }
  const before = db.getAllObras().find((o) => o.id === id);
  const beforeReq = (before?.requisicoes || []).find((r) => Number(r.id) === reqId);
  const result = db.updateRequisicao(id, reqId, { quantity });
  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  const qty = Number(quantity);
  const itemName = beforeReq?.itemName || result.requisicao?.itemName || 'material';
  const obraLabel = `#${String(id).padStart(6, '0')}`;
  const oldQty = Number(beforeReq?.quantity || 0);

  if (qty === 0) {
    logHistory(req, {
      type: 'requisicao',
      action: 'requisicao_removida',
      summary: `Requisição removida: ${itemName} · obra ${obraLabel} · devolução ao armazém (qtd ${oldQty})`,
      meta: { obraId: id, requisicaoId: reqId, quantity: 0, itemName, returned: oldQty }
    });
  } else {
    logHistory(req, {
      type: 'requisicao',
      action: 'requisicao_atualizada',
      summary: `Requisição atualizada: ${itemName} (qtd ${qty}) · obra ${obraLabel}`,
      meta: { obraId: id, requisicaoId: reqId, quantity: qty, itemName }
    });
  }
  res.json(result);
});

app.get('/api/history', (req, res) => {
  const entries = db.getAllHistory().sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
  res.json(entries);
});

app.delete('/api/history', ceoOnly, (req, res) => {
  const type = String(req.query.type || req.body?.type || '').trim();
  const allowed = ['', 'armazem', 'obras', 'requisicao', 'diario', 'cotacao', 'cliente', 'fornecedor'];
  if (!allowed.includes(type)) {
    return res.status(400).json({ error: 'Tipo de histórico inválido.' });
  }
  const result = db.clearHistory(type);
  res.json({ success: true, ...result, type: type || null });
});

app.get('/api/diario', (req, res) => {
  const date = String(req.query.date || '').trim();
  const day = db.getDiarioDay(date || new Date().toISOString().slice(0, 10));
  if (day.error) return res.status(day.status || 400).json({ error: day.error });
  res.json(day);
});

app.get('/api/diario/report', async (req, res) => {
  const date = String(req.query.date || '').trim() || new Date().toISOString().slice(0, 10);
  const day = db.getDiarioDay(date);
  if (day.error) return res.status(day.status || 400).json({ error: day.error });
  try {
    const author = resolveAuthUser(req.authUserId);
    const pdf = await reports.generateDiarioDayPdf(day, {
      userName: author.fullName || author.username || 'Utilizador'
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${pdf.fileName}"`);
    res.sendFile(pdf.filePath);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Não foi possível gerar o PDF do diário.' });
  }
});

app.put('/api/diario/initial', (req, res) => {
  const date = String(req.body?.date || '').trim();
  const result = db.setDiarioInitialValue(date, req.body?.initialValue);
  if (result.error) return res.status(result.status || 400).json({ error: result.error });
  const author = resolveAuthUser(req.authUserId);
  logHistory(req, {
    type: 'diario',
    action: 'atualizacao',
    summary: `Valor inicial do diário (${date}): ${Number(result.initialValue).toFixed(2)} MT`,
    meta: { date, initialValue: result.initialValue, userId: author.id }
  });
  res.json(result);
});

app.post('/api/diario/movements', (req, res) => {
  const author = resolveAuthUser(req.authUserId);
  const result = db.addDiarioMovement({
    date: req.body?.date,
    type: req.body?.type,
    amount: req.body?.amount,
    description: req.body?.description,
    userId: author.id,
    userName: author.fullName || author.username || 'Utilizador'
  });
  if (result.error) return res.status(result.status || 400).json({ error: result.error });
  const movement = result.movement;
  logHistory(req, {
    type: 'diario',
    action: movement.type,
    summary: `${movement.type === 'entrada' ? 'Entrada' : 'Saída'} no diário: ${Number(movement.amount).toFixed(2)} MT — ${movement.description}`,
    meta: { date: result.day.date, movementId: movement.id, amount: movement.amount }
  });
  res.status(201).json(result.day);
});

app.delete('/api/diario/movements/:id', (req, res) => {
  const date = String(req.query.date || req.body?.date || '').trim();
  const result = db.deleteDiarioMovement(date, req.params.id);
  if (result.error) return res.status(result.status || 400).json({ error: result.error });
  logHistory(req, {
    type: 'diario',
    action: 'exclusao',
    summary: `Movimento removido do diário (${date})`,
    meta: { date, movementId: Number(req.params.id) }
  });
  res.json(result);
});

app.get('/api/cotacoes', (req, res) => {
  const list = db.getAllCotacoes().sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
  res.json(list);
});

app.get('/api/cotacoes/:id', (req, res) => {
  const cotacao = db.getCotacaoById(req.params.id);
  if (!cotacao) return res.status(404).json({ error: 'Cotação não encontrada.' });
  res.json(cotacao);
});

app.post('/api/cotacoes', (req, res) => {
  const author = resolveAuthUser(req.authUserId);
  const result = db.addCotacao({
    ...req.body,
    userId: author.id,
    userName: author.fullName || author.username || 'Utilizador'
  });
  if (result.error) return res.status(result.status || 400).json({ error: result.error });
  logHistory(req, {
    type: 'cotacao',
    action: 'criacao',
    summary: `Cotação ${result.number}: ${result.client} — ${Number(result.totals.total).toFixed(2)} MT`,
    meta: { cotacaoId: result.id, total: result.totals.total }
  });
  res.status(201).json(result);
});

app.put('/api/cotacoes/:id', (req, res) => {
  const result = db.updateCotacao(req.params.id, req.body);
  if (result.error) return res.status(result.status || 400).json({ error: result.error });
  logHistory(req, {
    type: 'cotacao',
    action: 'atualizacao',
    summary: `Cotação ${result.number} atualizada: ${result.client}`,
    meta: { cotacaoId: result.id, total: result.totals.total, status: result.status }
  });
  res.json(result);
});

app.delete('/api/cotacoes/:id', (req, res) => {
  const result = db.deleteCotacao(req.params.id);
  if (result.error) return res.status(result.status || 400).json({ error: result.error });
  logHistory(req, {
    type: 'cotacao',
    action: 'exclusao',
    summary: `Cotação ${result.number} removida: ${result.client}`,
    meta: { cotacaoId: result.id }
  });
  res.json({ success: true, removed: result });
});

app.get('/api/cotacoes/:id/report', async (req, res) => {
  const cotacao = db.getCotacaoById(req.params.id);
  if (!cotacao) return res.status(404).json({ error: 'Cotação não encontrada.' });
  try {
    const author = resolveAuthUser(req.authUserId);
    const pdf = await reports.generateCotacaoPdf(cotacao, {
      userName: author.fullName || author.username || 'Utilizador'
    });
    res.download(pdf.filePath, pdf.fileName);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Não foi possível gerar o PDF da cotação.' });
  }
});

app.get('/api/facturas', (req, res) => {
  const list = db.getAllFacturas().sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
  res.json(list);
});

app.get('/api/facturas/:id', (req, res) => {
  const factura = db.getFacturaById(req.params.id);
  if (!factura) return res.status(404).json({ error: 'Factura não encontrada.' });
  res.json(factura);
});

app.post('/api/facturas', (req, res) => {
  const author = resolveAuthUser(req.authUserId);
  const result = db.addFactura({
    ...req.body,
    userId: author.id,
    userName: author.fullName || author.username || 'Utilizador'
  });
  if (result.error) return res.status(result.status || 400).json({ error: result.error });
  logHistory(req, {
    type: 'factura',
    action: 'criacao',
    summary: `Factura ${result.number}: ${result.client} — ${Number(result.totals.total).toFixed(2)} MT`,
    meta: { facturaId: result.id, total: result.totals.total }
  });
  res.status(201).json(result);
});

app.put('/api/facturas/:id', (req, res) => {
  const result = db.updateFactura(req.params.id, req.body);
  if (result.error) return res.status(result.status || 400).json({ error: result.error });
  logHistory(req, {
    type: 'factura',
    action: 'atualizacao',
    summary: `Factura ${result.number} atualizada: ${result.client}`,
    meta: { facturaId: result.id, total: result.totals.total, status: result.status }
  });
  res.json(result);
});

app.delete('/api/facturas/:id', (req, res) => {
  const result = db.deleteFactura(req.params.id);
  if (result.error) return res.status(result.status || 400).json({ error: result.error });
  logHistory(req, {
    type: 'factura',
    action: 'exclusao',
    summary: `Factura ${result.number} removida: ${result.client}`,
    meta: { facturaId: result.id }
  });
  res.json({ success: true, removed: result });
});

app.get('/api/facturas/:id/report', async (req, res) => {
  const factura = db.getFacturaById(req.params.id);
  if (!factura) return res.status(404).json({ error: 'Factura não encontrada.' });
  try {
    const author = resolveAuthUser(req.authUserId);
    const pdf = await reports.generateFacturaPdf(factura, {
      userName: author.fullName || author.username || 'Utilizador'
    });
    res.download(pdf.filePath, pdf.fileName);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Não foi possível gerar o PDF da factura.' });
  }
});

app.get('/api/facturas/:id/attachment', (req, res) => {
  const attachment = db.getFacturaAttachmentPath(req.params.id);
  if (!attachment) return res.status(404).json({ error: 'Anexo não encontrado.' });
  res.setHeader('Content-Type', attachment.mimeType);
  res.setHeader(
    'Content-Disposition',
    `inline; filename="${String(attachment.fileName).replace(/"/g, '')}"`
  );
  res.sendFile(attachment.filePath);
});

app.get('/api/cameras', (req, res) => {
  res.json(db.getAllCameras());
});

app.post('/api/cameras', (req, res) => {
  const author = resolveAuthUser(req.authUserId);
  const result = db.addCamera({
    ...req.body,
    userId: author.id,
    userName: author.fullName || author.username || 'Utilizador'
  });
  if (result.error) return res.status(result.status || 400).json({ error: result.error });
  logHistory(req, {
    type: 'cameras',
    action: 'criacao',
    summary: `Camera adicionada: ${result.name}`,
    meta: { cameraId: result.id }
  });
  res.status(201).json(result);
});

app.put('/api/cameras/:id', (req, res) => {
  const result = db.updateCamera(req.params.id, req.body);
  if (result.error) return res.status(result.status || 400).json({ error: result.error });
  logHistory(req, {
    type: 'cameras',
    action: 'atualizacao',
    summary: `Camera atualizada: ${result.name}`,
    meta: { cameraId: result.id }
  });
  res.json(result);
});

app.delete('/api/cameras/:id', (req, res) => {
  const result = db.deleteCamera(req.params.id);
  if (result.error) return res.status(result.status || 400).json({ error: result.error });
  logHistory(req, {
    type: 'cameras',
    action: 'exclusao',
    summary: `Camera removida: ${result.name}`,
    meta: { cameraId: result.id }
  });
  res.json({ success: true, removed: result });
});

app.get('/api/clientes', (req, res) => {
  const list = db.getAllClientes().sort((a, b) =>
    String(a.name || '').localeCompare(String(b.name || ''), 'pt', { sensitivity: 'base' })
  );
  res.json(list);
});

app.get('/api/clientes/:id', (req, res) => {
  const cliente = db.getClienteById(req.params.id);
  if (!cliente) return res.status(404).json({ error: 'Cliente não encontrado.' });
  res.json(cliente);
});

app.post('/api/clientes', ceoOnly, (req, res) => {
  const author = resolveAuthUser(req.authUserId);
  const result = db.addCliente({
    ...req.body,
    userId: author.id,
    userName: author.fullName || author.username || 'Utilizador'
  });
  if (result.error) return res.status(result.status || 400).json({ error: result.error });
  logHistory(req, {
    type: 'cliente',
    action: 'criacao',
    summary: `Cliente registado (${result.type === 'empresa' ? 'empresa' : 'particular'}): ${result.name}${result.phone ? ` (${result.phone})` : ''}`,
    meta: { clienteId: result.id, type: result.type }
  });
  res.status(201).json(result);
});

app.put('/api/clientes/:id', ceoOnly, (req, res) => {
  const result = db.updateCliente(req.params.id, req.body);
  if (result.error) return res.status(result.status || 400).json({ error: result.error });
  logHistory(req, {
    type: 'cliente',
    action: 'atualizacao',
    summary: `Cliente atualizado (${result.type === 'empresa' ? 'empresa' : 'particular'}): ${result.name}`,
    meta: { clienteId: result.id, type: result.type }
  });
  res.json(result);
});

app.delete('/api/clientes/:id', ceoOnly, (req, res) => {
  const result = db.deleteCliente(req.params.id);
  if (result.error) return res.status(result.status || 400).json({ error: result.error });
  logHistory(req, {
    type: 'cliente',
    action: 'exclusao',
    summary: `Cliente removido: ${result.name}`,
    meta: { clienteId: result.id }
  });
  res.json({ success: true, removed: result });
});

app.get('/api/fornecedores', (req, res) => {
  const list = db.getAllFornecedores().sort((a, b) =>
    String(a.name || '').localeCompare(String(b.name || ''), 'pt', { sensitivity: 'base' })
  );
  res.json(list);
});

app.get('/api/fornecedores/:id', (req, res) => {
  const fornecedor = db.getFornecedorById(req.params.id);
  if (!fornecedor) return res.status(404).json({ error: 'Fornecedor não encontrado.' });
  res.json(fornecedor);
});

app.post('/api/fornecedores', ceoOnly, (req, res) => {
  const author = resolveAuthUser(req.authUserId);
  const result = db.addFornecedor({
    ...req.body,
    userId: author.id,
    userName: author.fullName || author.username || 'Utilizador'
  });
  if (result.error) return res.status(result.status || 400).json({ error: result.error });
  logHistory(req, {
    type: 'fornecedor',
    action: 'criacao',
    summary: `Fornecedor registado: ${result.name}${result.phone ? ` (${result.phone})` : ''}`,
    meta: { fornecedorId: result.id }
  });
  res.status(201).json(result);
});

app.put('/api/fornecedores/:id', ceoOnly, (req, res) => {
  const result = db.updateFornecedor(req.params.id, req.body);
  if (result.error) return res.status(result.status || 400).json({ error: result.error });
  logHistory(req, {
    type: 'fornecedor',
    action: 'atualizacao',
    summary: `Fornecedor atualizado: ${result.name}`,
    meta: { fornecedorId: result.id }
  });
  res.json(result);
});

app.delete('/api/fornecedores/:id', ceoOnly, (req, res) => {
  const result = db.deleteFornecedor(req.params.id);
  if (result.error) return res.status(result.status || 400).json({ error: result.error });
  logHistory(req, {
    type: 'fornecedor',
    action: 'exclusao',
    summary: `Fornecedor removido: ${result.name}`,
    meta: { fornecedorId: result.id }
  });
  res.json({ success: true, removed: result });
});

function resolveAuthUser(userId) {
  const user = db.getUserById(userId);
  if (!user) {
    return {
      id: Number(userId),
      fullName: 'Utilizador',
      username: 'user',
      email: '',
      role: ''
    };
  }
  return {
    id: user.id,
    fullName: user.fullName,
    username: user.username,
    email: user.email,
    role: user.role || ''
  };
}

function logHistory(req, { type, action, summary, meta }) {
  try {
    const author = resolveAuthUser(req.authUserId);
    db.addHistoryEntry({
      type,
      action,
      summary,
      meta: meta || {},
      userId: author.id,
      userName: author.fullName || author.username || 'Utilizador'
    });
  } catch (error) {
    console.error('Falha ao registar histórico:', error);
  }
}

function enrichMessage(message, currentUserId) {
  const views = Array.isArray(message.views) ? message.views : [];
  const oks = Array.isArray(message.oks) ? message.oks : [];
  return {
    ...message,
    views,
    oks,
    viewCount: views.length,
    okCount: oks.length,
    viewedByMe: views.some((view) => Number(view.userId) === Number(currentUserId)),
    okByMe: oks.some((ok) => Number(ok.userId) === Number(currentUserId))
  };
}

app.get('/api/messages', (req, res) => {
  const messages = db.getAllMessages()
    .slice()
    .sort((a, b) => a.id - b.id)
    .map((message) => enrichMessage(message, req.authUserId));
  res.json(messages);
});

app.post('/api/messages', (req, res) => {
  const text = String(req.body?.text || '').trim();
  if (!text) {
    return res.status(400).json({ error: 'Escreva a mensagem.' });
  }
  if (text.length > 2000) {
    return res.status(400).json({ error: 'A mensagem é demasiado longa (máx. 2000 caracteres).' });
  }

  let replyTo = null;
  const replyToId = Number(req.body?.replyToId);
  if (Number.isFinite(replyToId) && replyToId > 0) {
    const parent = db.getMessageById(replyToId);
    if (!parent) {
      return res.status(404).json({ error: 'Mensagem original não encontrada.' });
    }
    replyTo = {
      id: parent.id,
      userId: parent.userId,
      fullName: parent.fullName,
      username: parent.username,
      text: parent.text
    };
  }

  const author = resolveAuthUser(req.authUserId);
  const message = db.addMessage({
    userId: author.id,
    fullName: author.fullName,
    username: author.username,
    text,
    replyTo
  });
  res.status(201).json(enrichMessage(message, req.authUserId));
});

app.get('/api/messages/:id/report', (req, res) => {
  const message = db.getMessageById(req.params.id);
  if (!message) {
    return res.status(404).json({ error: 'Mensagem não encontrada.' });
  }
  const enriched = enrichMessage(message, req.authUserId);
  res.json({
    id: enriched.id,
    text: enriched.text,
    fullName: enriched.fullName,
    created_at: enriched.created_at,
    viewCount: enriched.viewCount,
    okCount: enriched.okCount,
    views: enriched.views,
    oks: enriched.oks
  });
});

app.post('/api/messages/:id/view', (req, res) => {
  const viewer = resolveAuthUser(req.authUserId);
  const result = db.markMessageViewed(req.params.id, {
    userId: viewer.id,
    fullName: viewer.fullName,
    username: viewer.username
  });
  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  res.json(enrichMessage(result, req.authUserId));
});

app.post('/api/messages/:id/ok', (req, res) => {
  const viewer = resolveAuthUser(req.authUserId);
  const result = db.markMessageOk(req.params.id, {
    userId: viewer.id,
    fullName: viewer.fullName,
    username: viewer.username
  });
  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  res.json(enrichMessage(result, req.authUserId));
});

app.delete('/api/messages/:id', (req, res) => {
  const message = db.getMessageById(req.params.id);
  if (!message) {
    return res.status(404).json({ error: 'Mensagem não encontrada.' });
  }
  const canDelete = req.isCeo || Number(message.userId) === Number(req.authUserId);
  if (!canDelete) {
    return res.status(403).json({ error: 'Só pode excluir as suas mensagens.' });
  }
  const result = db.deleteMessage(req.params.id);
  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  res.json({ success: true, id: Number(req.params.id) });
});

app.get('/api/reports', ceoOnly, (req, res) => {
  res.json(reports.listReports());
});

app.post('/api/reports/generate', ceoOnly, async (req, res) => {
  try {
    const now = new Date();
    let year = Number(req.body?.year);
    let month = Number(req.body?.month);
    if (!Number.isFinite(year) || !Number.isFinite(month)) {
      // por omissão gera o mês anterior (fecho automático)
      const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      year = prev.getFullYear();
      month = prev.getMonth() + 1;
    }
    const force = Boolean(req.body?.force);
    const meta = await reports.generateMonthlyPdf(year, month, { force });
    if (meta?.error) {
      return res.status(meta.status || 400).json({ error: meta.error });
    }
    res.status(201).json(meta);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Não foi possível gerar o relatório PDF.' });
  }
});

app.get('/api/reports/:year/:month/download', ceoOnly, (req, res) => {
  const year = Number(req.params.year);
  const month = Number(req.params.month);
  const found = reports.getReportFilePath(year, month);
  if (!found) {
    return res.status(404).json({ error: 'Relatório não encontrado.' });
  }
  res.download(found.filePath, found.meta.fileName);
});

function startServer(options = {}) {
  const openBrowser =
    options.openBrowser !== undefined
      ? Boolean(options.openBrowser)
      : String(process.env.OPEN_BROWSER || '1') !== '0';
  return new Promise((resolve, reject) => {
    const server = app.listen(PORT, HOST, () => {
      const urls = config.getAccessUrls();
      console.log(`Servidor Isoft a escutar em ${HOST}:${PORT}`);
      urls.forEach((url) => console.log(`  → ${url}`));
      if (config.PUBLIC_URL) {
        console.log(`URL pública configurada: ${config.PUBLIC_URL}`);
      }
      reports.startMonthlyReportScheduler();
      if (openBrowser) {
        const target = `http://localhost:${PORT}/login.html`;
        const prefs = desktop.readSettings();
        console.log(
          `A abrir navegador${prefs.openFullscreen ? ' (ecrã inteiro)' : ''}: ${target}`
        );
        desktop.openInBrowser(target, { fullscreen: prefs.openFullscreen });
      }
      resolve(server);
    });
    server.on('error', reject);
  });
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error('Falha ao iniciar o servidor:', error.message || error);
    process.exit(1);
  });
}

module.exports = {
  app,
  startServer,
  PORT,
  HOST
};
