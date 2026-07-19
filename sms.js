const https = require('https');
const http = require('http');
const { URL } = require('url');

function normalizePhone(phone) {
  let digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) digits = digits.slice(2);
  // Moçambique: 84/85/86/87 + 7 dígitos
  if (digits.length === 9 && /^8[4-7]\d{7}$/.test(digits)) {
    digits = `258${digits}`;
  }
  if (digits.length === 12 && digits.startsWith('258')) {
    return `+${digits}`;
  }
  if (digits.length >= 10 && digits.length <= 15) {
    return `+${digits}`;
  }
  return '';
}

function phonesMatch(a, b) {
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  if (!na || !nb) return false;
  return na === nb || na.replace(/^\+/, '') === nb.replace(/^\+/, '');
}

function postJson(urlString, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const payload = JSON.stringify(body);
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          ...headers
        }
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          resolve({ status: res.statusCode || 0, body: data });
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function postForm(urlString, formBody, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const payload = formBody;
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(payload),
          ...headers
        }
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          resolve({ status: res.statusCode || 0, body: data });
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function isSmsConfigured() {
  const hasTwilio = Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_FROM
  );
  const hasWebhook = Boolean(process.env.SMS_WEBHOOK_URL);
  return hasTwilio || hasWebhook;
}

async function sendViaTwilio(to, text) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM;
  if (!sid || !token || !from) {
    return { ok: false, error: 'Twilio não configurado.' };
  }

  const auth = Buffer.from(`${sid}:${token}`).toString('base64');
  const body = new URLSearchParams({
    To: to,
    From: from,
    Body: text
  }).toString();

  const result = await postForm(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
    body,
    { Authorization: `Basic ${auth}` }
  );

  if (result.status >= 200 && result.status < 300) {
    return { ok: true, provider: 'twilio' };
  }
  return {
    ok: false,
    error: `Twilio HTTP ${result.status}: ${result.body.slice(0, 200)}`
  };
}

async function sendViaWebhook(to, text) {
  const webhook = process.env.SMS_WEBHOOK_URL;
  if (!webhook) {
    return { ok: false, error: 'Webhook SMS não configurado.' };
  }
  const result = await postJson(webhook, {
    to,
    phone: to,
    message: text,
    text
  });
  if (result.status >= 200 && result.status < 300) {
    return { ok: true, provider: 'webhook' };
  }
  return {
    ok: false,
    error: `Webhook SMS HTTP ${result.status}: ${result.body.slice(0, 200)}`
  };
}

/**
 * Envia SMS. Ordem: Twilio → SMS_WEBHOOK_URL.
 */
async function sendSms(toRaw, text) {
  const to = normalizePhone(toRaw);
  if (!to) {
    return { ok: false, error: 'Número de telemóvel inválido.' };
  }

  if (process.env.TWILIO_ACCOUNT_SID) {
    const twilio = await sendViaTwilio(to, text);
    if (twilio.ok) return { ...twilio, to };
    console.error('Falha Twilio SMS:', twilio.error);
  }

  if (process.env.SMS_WEBHOOK_URL) {
    const webhook = await sendViaWebhook(to, text);
    if (webhook.ok) return { ...webhook, to };
    console.error('Falha webhook SMS:', webhook.error);
    return { ok: false, error: webhook.error, to };
  }

  if (process.env.TWILIO_ACCOUNT_SID) {
    return { ok: false, error: 'Falha ao enviar SMS via Twilio.', to };
  }

  return {
    ok: false,
    error: 'Serviço SMS não configurado. Defina TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN e TWILIO_FROM (ou SMS_WEBHOOK_URL).',
    to,
    notConfigured: true
  };
}

module.exports = {
  normalizePhone,
  phonesMatch,
  isSmsConfigured,
  sendSms
};
