const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SECRET_FILE = path.join(__dirname, '.auth-secret');
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 32;
const HASH_PREFIX = '$scrypt$';

/** @type {Map<string, { userId: number, expiresAt: number, createdAt: number }>} */
const authSessions = new Map();

/** @type {Map<string, { count: number, resetAt: number, blockedUntil: number }>} */
const rateBuckets = new Map();

function ensureAuthSecret() {
  const fromEnv = String(process.env.AUTH_SECRET || '').trim();
  if (fromEnv && fromEnv.length >= 32) return fromEnv;

  try {
    if (fs.existsSync(SECRET_FILE)) {
      const saved = fs.readFileSync(SECRET_FILE, 'utf8').trim();
      if (saved.length >= 32) return saved;
    }
  } catch {
    // ignore and regenerate
  }

  const generated = crypto.randomBytes(48).toString('base64url');
  try {
    fs.writeFileSync(SECRET_FILE, `${generated}\n`, { encoding: 'utf8', mode: 0o600 });
  } catch (error) {
    console.warn('Não foi possível gravar .auth-secret:', error.message);
  }
  return generated;
}

const AUTH_SECRET = ensureAuthSecret();

function timingSafeEqualString(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  if (left.length !== right.length) {
    crypto.timingSafeEqual(left, left);
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

function isHashedPassword(value) {
  return String(value || '').startsWith(HASH_PREFIX);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('base64url');
  const derived = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P
  });
  return `${HASH_PREFIX}${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt}$${derived.toString('base64url')}`;
}

function verifyPassword(password, stored) {
  const value = String(stored || '');
  if (!password) return false;

  if (!isHashedPassword(value)) {
    return timingSafeEqualString(password, value);
  }

  const parts = value.split('$');
  // '', 'scrypt', N, r, p, salt, hash
  if (parts.length !== 7 || parts[1] !== 'scrypt') return false;
  const n = Number(parts[2]);
  const r = Number(parts[3]);
  const p = Number(parts[4]);
  const salt = parts[5];
  const expected = parts[6];
  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p) || !salt || !expected) {
    return false;
  }

  try {
    const derived = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN, { N: n, r, p });
    const left = Buffer.from(expected, 'base64url');
    const right = derived;
    if (left.length !== right.length) return false;
    return crypto.timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

function createAuthSession(userId) {
  const sid = crypto.randomBytes(18).toString('base64url');
  const now = Date.now();
  const expiresAt = now + TOKEN_TTL_MS;
  authSessions.set(sid, {
    userId: Number(userId),
    expiresAt,
    createdAt: now
  });
  return { sid, expiresAt };
}

function destroyAuthSession(sid) {
  if (!sid) return;
  authSessions.delete(String(sid));
}

function destroyUserAuthSessions(userId) {
  const id = Number(userId);
  for (const [sid, session] of authSessions.entries()) {
    if (Number(session.userId) === id) authSessions.delete(sid);
  }
}

function pruneAuthSessions() {
  const now = Date.now();
  for (const [sid, session] of authSessions.entries()) {
    if (!session || session.expiresAt <= now) authSessions.delete(sid);
  }
}

function signPayload(payload) {
  return crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('base64url');
}

function makeToken(userId) {
  pruneAuthSessions();
  const { sid, expiresAt } = createAuthSession(userId);
  const exp = Math.floor(expiresAt / 1000);
  const body = `ISOFT2.${Number(userId)}.${sid}.${exp}`;
  const sig = signPayload(body);
  return `${body}.${sig}`;
}

function parseToken(token) {
  if (!token || typeof token !== 'string') return null;
  pruneAuthSessions();

  const parts = token.split('.');
  // New format: ISOFT2.userId.sid.exp.sig
  if (parts.length === 5 && parts[0] === 'ISOFT2') {
    const userId = Number(parts[1]);
    const sid = parts[2];
    const exp = Number(parts[3]);
    const sig = parts[4];
    if (!Number.isFinite(userId) || !sid || !Number.isFinite(exp) || !sig) return null;

    const body = `ISOFT2.${userId}.${sid}.${exp}`;
    const expected = signPayload(body);
    if (!timingSafeEqualString(sig, expected)) return null;
    if (exp * 1000 <= Date.now()) {
      destroyAuthSession(sid);
      return null;
    }

    const session = authSessions.get(sid);
    if (!session || Number(session.userId) !== userId || session.expiresAt <= Date.now()) {
      destroyAuthSession(sid);
      return null;
    }

    return { userId, sid, exp };
  }

  // Reject legacy forgeable tokens
  return null;
}

function getClientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '')
    .split(',')[0]
    .trim();
  return forwarded || req.socket?.remoteAddress || req.ip || 'unknown';
}

function rateLimit({
  name,
  windowMs = 15 * 60 * 1000,
  max = 20,
  blockMs = 15 * 60 * 1000,
  keyFn = getClientIp
} = {}) {
  return (req, res, next) => {
    const now = Date.now();
    const key = `${name}:${keyFn(req)}`;
    let bucket = rateBuckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs, blockedUntil: 0 };
      rateBuckets.set(key, bucket);
    }

    if (bucket.blockedUntil > now) {
      const retryAfter = Math.ceil((bucket.blockedUntil - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({
        error: 'Demasiadas tentativas. Aguarde e tente novamente.'
      });
    }

    bucket.count += 1;
    if (bucket.count > max) {
      bucket.blockedUntil = now + blockMs;
      const retryAfter = Math.ceil(blockMs / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({
        error: 'Demasiadas tentativas. Aguarde e tente novamente.'
      });
    }

    next();
  };
}

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'self'",
      "frame-src 'self' blob: data:",
      "child-src 'self' blob: data:",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data: https://fonts.gstatic.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
      "connect-src 'self' https://cdn.jsdelivr.net",
      "object-src 'self' blob: data:",
      "worker-src 'self' blob: https://cdn.jsdelivr.net"
    ].join('; ')
  );
  next();
}

function generateRecoveryCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function allowPreviewCodes(req) {
  if (process.env.ALLOW_RECOVERY_PREVIEW === '1') return true;
  if (process.env.NODE_ENV === 'production') return false;
  const ip = getClientIp(req);
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

module.exports = {
  AUTH_SECRET,
  TOKEN_TTL_MS,
  hashPassword,
  verifyPassword,
  isHashedPassword,
  makeToken,
  parseToken,
  destroyAuthSession,
  destroyUserAuthSessions,
  rateLimit,
  securityHeaders,
  generateRecoveryCode,
  allowPreviewCodes,
  getClientIp
};
