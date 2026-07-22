const https = require('https');
const http = require('http');
const net = require('net');
const tls = require('tls');
const { URL } = require('url');

function normalizeEmail(email) {
  const value = String(email || '').trim().toLowerCase();
  if (!value || !value.includes('@') || value.length > 254) return '';
  return value;
}

function isEmailConfigured() {
  const hasSmtp = Boolean(
    process.env.SMTP_HOST &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS
  );
  const hasWebhook = Boolean(process.env.EMAIL_WEBHOOK_URL);
  return hasSmtp || hasWebhook;
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

function readSmtpResponse(socket) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const onData = (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split(/\r?\n/).filter((line) => line.length > 0);
      if (!lines.length) return;
      const last = lines[lines.length - 1];
      // Última linha de um bloco SMTP: "250 OK" (espaço após o código)
      if (/^\d{3} /.test(last)) {
        socket.off('data', onData);
        socket.off('error', onError);
        resolve(buffer);
      }
    };
    const onError = (err) => {
      socket.off('data', onData);
      reject(err);
    };
    socket.on('data', onData);
    socket.on('error', onError);
  });
}

function writeSmtp(socket, line) {
  return new Promise((resolve, reject) => {
    socket.write(`${line}\r\n`, (err) => (err ? reject(err) : resolve()));
  });
}

async function expectSmtp(socket, okCodes) {
  const raw = await readSmtpResponse(socket);
  const match = String(raw).match(/(\d{3})[ -]/);
  const code = match ? Number(match[1]) : 0;
  if (!okCodes.includes(code)) {
    throw new Error(`SMTP ${code}: ${String(raw).trim().slice(0, 180)}`);
  }
  return raw;
}

/**
 * Cliente SMTP mínimo (STARTTLS / TLS) sem dependências extra.
 */
async function sendViaSmtp(to, subject, text) {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || user;
  const secure = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465;

  if (!host || !user || !pass || !from) {
    return { ok: false, error: 'SMTP não configurado.' };
  }

  const connect = () =>
    new Promise((resolve, reject) => {
      const socket = secure
        ? tls.connect({ host, port, servername: host }, () => resolve(socket))
        : net.connect({ host, port }, () => resolve(socket));
      socket.setEncoding('utf8');
      socket.setTimeout(20000);
      socket.on('error', reject);
      socket.on('timeout', () => {
        socket.destroy();
        reject(new Error('Timeout SMTP.'));
      });
    });

  let socket;
  try {
    socket = await connect();
    await expectSmtp(socket, [220]);
    await writeSmtp(socket, `EHLO sisoft.local`);
    await expectSmtp(socket, [250]);

    if (!secure) {
      await writeSmtp(socket, 'STARTTLS');
      await expectSmtp(socket, [220]);
      socket = await new Promise((resolve, reject) => {
        const tlsSocket = tls.connect({ socket, servername: host }, () => resolve(tlsSocket));
        tlsSocket.setEncoding('utf8');
        tlsSocket.on('error', reject);
      });
      await writeSmtp(socket, `EHLO sisoft.local`);
      await expectSmtp(socket, [250]);
    }

    await writeSmtp(socket, 'AUTH LOGIN');
    await expectSmtp(socket, [334]);
    await writeSmtp(socket, Buffer.from(user).toString('base64'));
    await expectSmtp(socket, [334]);
    await writeSmtp(socket, Buffer.from(pass).toString('base64'));
    await expectSmtp(socket, [235]);

    await writeSmtp(socket, `MAIL FROM:<${from}>`);
    await expectSmtp(socket, [250]);
    await writeSmtp(socket, `RCPT TO:<${to}>`);
    await expectSmtp(socket, [250, 251]);
    await writeSmtp(socket, 'DATA');
    await expectSmtp(socket, [354]);

    const payload = [
      `From: Sisoft <${from}>`,
      `To: <${to}>`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      text,
      '.'
    ].join('\r\n');

    await writeSmtp(socket, payload);
    await expectSmtp(socket, [250]);
    await writeSmtp(socket, 'QUIT');
    socket.end();
    return { ok: true, provider: 'smtp' };
  } catch (error) {
    if (socket) {
      try { socket.destroy(); } catch (_) { /* ignore */ }
    }
    return { ok: false, error: error.message || 'Falha SMTP.' };
  }
}

async function sendViaWebhook(to, subject, text) {
  const webhook = process.env.EMAIL_WEBHOOK_URL;
  if (!webhook) {
    return { ok: false, error: 'Webhook de email não configurado.' };
  }
  const result = await postJson(webhook, {
    to,
    email: to,
    subject,
    message: text,
    text
  });
  if (result.status >= 200 && result.status < 300) {
    return { ok: true, provider: 'webhook' };
  }
  return {
    ok: false,
    error: `Webhook email HTTP ${result.status}: ${result.body.slice(0, 200)}`
  };
}

/**
 * Envia email. Ordem: SMTP → EMAIL_WEBHOOK_URL.
 */
async function sendEmail(toRaw, subject, text) {
  const to = normalizeEmail(toRaw);
  if (!to) {
    return { ok: false, error: 'Email inválido.' };
  }

  if (process.env.SMTP_HOST) {
    const smtp = await sendViaSmtp(to, subject, text);
    if (smtp.ok) return { ...smtp, to };
    console.error('Falha SMTP email:', smtp.error);
    if (!process.env.EMAIL_WEBHOOK_URL) {
      return { ok: false, error: smtp.error, to };
    }
  }

  if (process.env.EMAIL_WEBHOOK_URL) {
    const webhook = await sendViaWebhook(to, subject, text);
    if (webhook.ok) return { ...webhook, to };
    console.error('Falha webhook email:', webhook.error);
    return { ok: false, error: webhook.error, to };
  }

  return {
    ok: false,
    error: 'Serviço de email não configurado. Defina SMTP_HOST, SMTP_USER, SMTP_PASS (e SMTP_FROM) ou EMAIL_WEBHOOK_URL.',
    to,
    notConfigured: true
  };
}

module.exports = {
  normalizeEmail,
  isEmailConfigured,
  sendEmail
};
