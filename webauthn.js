const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse
} = require('@simplewebauthn/server');
const { isoBase64URL } = require('@simplewebauthn/server/helpers');

/** @type {Map<string, { challenge: string, userId?: number, expiresAt: number }>} */
const challenges = new Map();
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

function pruneChallenges() {
  const now = Date.now();
  for (const [key, value] of challenges.entries()) {
    if (!value || value.expiresAt < now) challenges.delete(key);
  }
}

function getRequestOrigin(req) {
  const host = String(req.get('host') || 'localhost:3000');
  const protoHeader = String(req.get('x-forwarded-proto') || '').split(',')[0].trim();
  const protocol = protoHeader || (req.secure ? 'https' : 'http');
  return `${protocol}://${host}`;
}

function getRpID(req) {
  const host = String(req.get('host') || 'localhost:3000');
  return host.split(':')[0] || 'localhost';
}

function storeChallenge(challenge, userId) {
  pruneChallenges();
  challenges.set(String(challenge), {
    challenge: String(challenge),
    userId: userId == null ? undefined : Number(userId),
    expiresAt: Date.now() + CHALLENGE_TTL_MS
  });
}

function takeChallenge(challenge) {
  pruneChallenges();
  const key = String(challenge || '');
  const entry = challenges.get(key);
  challenges.delete(key);
  if (!entry || entry.expiresAt < Date.now()) return null;
  return entry;
}

function toCredentialDescriptors(credentials = []) {
  return credentials.map((cred) => ({
    id: cred.id,
    transports: Array.isArray(cred.transports) ? cred.transports : undefined
  }));
}

async function createRegistrationOptions(req, user) {
  const rpID = getRpID(req);
  const existing = Array.isArray(user.webauthnCredentials) ? user.webauthnCredentials : [];
  const userID = new Uint8Array(Buffer.from(String(user.id), 'utf8'));

  const options = await generateRegistrationOptions({
    rpName: 'Sisoft',
    rpID,
    userName: user.username || user.email || `user-${user.id}`,
    userDisplayName: user.fullName || user.username || 'Utilizador Sisoft',
    userID,
    attestationType: 'none',
    excludeCredentials: toCredentialDescriptors(existing),
    authenticatorSelection: {
      authenticatorAttachment: 'platform',
      residentKey: 'preferred',
      requireResidentKey: false,
      userVerification: 'required'
    },
    preferredAuthenticatorType: 'local'
  });

  storeChallenge(options.challenge, user.id);
  return options;
}

async function verifyRegistration(req, user, response) {
  const expectedChallenge = String(req.body?.challenge || '');
  const expected = takeChallenge(expectedChallenge);
  if (!expected) {
    return { ok: false, error: 'Desafio Face ID expirado. Tente novamente.' };
  }

  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: expected.challenge,
    expectedOrigin: getRequestOrigin(req),
    expectedRPID: getRpID(req),
    requireUserVerification: true
  });

  if (!verification.verified || !verification.registrationInfo) {
    return { ok: false, error: 'Não foi possível ativar o Face ID.' };
  }

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
  return {
    ok: true,
    credential: {
      id: credential.id,
      publicKey: isoBase64URL.fromBuffer(credential.publicKey),
      counter: credential.counter,
      transports: response?.response?.transports || credential.transports || [],
      deviceType: credentialDeviceType,
      backedUp: Boolean(credentialBackedUp),
      createdAt: new Date().toISOString()
    }
  };
}

async function createAuthenticationOptions(req, user) {
  const rpID = getRpID(req);
  const allowCredentials = user
    ? toCredentialDescriptors(user.webauthnCredentials || [])
    : [];

  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials,
    userVerification: 'required'
  });

  storeChallenge(options.challenge, user?.id);
  return options;
}

async function verifyAuthentication(req, response, findUserByCredentialId) {
  const credentialId = String(response?.id || '');
  if (!credentialId) {
    return { ok: false, error: 'Resposta Face ID inválida.' };
  }

  const user = findUserByCredentialId(credentialId);
  if (!user) {
    return { ok: false, error: 'Face ID não está associado a nenhuma conta. Ative-o no menu Sistema após entrar.' };
  }

  const credentials = Array.isArray(user.webauthnCredentials) ? user.webauthnCredentials : [];
  const dbCred = credentials.find((c) => c.id === credentialId);
  if (!dbCred) {
    return { ok: false, error: 'Credencial Face ID não encontrada.' };
  }

  const expectedChallenge = String(req.body?.challenge || '');
  const expected = takeChallenge(expectedChallenge);
  if (!expected) {
    return { ok: false, error: 'Desafio Face ID expirado. Tente novamente.' };
  }

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: expected.challenge,
    expectedOrigin: getRequestOrigin(req),
    expectedRPID: getRpID(req),
    credential: {
      id: dbCred.id,
      publicKey: isoBase64URL.toBuffer(dbCred.publicKey),
      counter: Number(dbCred.counter) || 0,
      transports: dbCred.transports
    },
    requireUserVerification: true
  });

  if (!verification.verified) {
    return { ok: false, error: 'Face ID não verificado.' };
  }

  return {
    ok: true,
    user,
    credentialId,
    newCounter: verification.authenticationInfo.newCounter
  };
}

module.exports = {
  createRegistrationOptions,
  verifyRegistration,
  createAuthenticationOptions,
  verifyAuthentication,
  getRequestOrigin,
  getRpID
};
