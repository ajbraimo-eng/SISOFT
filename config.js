const fs = require('fs');
const path = require('path');
const os = require('os');

function loadEnvFile() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] == null || process.env[key] === '') {
      process.env[key] = value;
    }
  }
}

loadEnvFile();

function readEnv(name, fallback = '') {
  const value = process.env[name];
  return value == null || value === '' ? fallback : String(value);
}

const PORT = Number(readEnv('PORT', '3000')) || 3000;
const HOST = readEnv('HOST', '0.0.0.0');
const PUBLIC_URL = readEnv('PUBLIC_URL', '').replace(/\/$/, '');

function getLanAddresses() {
  const nets = os.networkInterfaces();
  const result = [];
  for (const entries of Object.values(nets)) {
    for (const net of entries || []) {
      if (net.family !== 'IPv4' && net.family !== 4) continue;
      if (net.internal) continue;
      result.push(net.address);
    }
  }
  return result;
}

function getAccessUrls() {
  const urls = [`http://localhost:${PORT}`];
  if (PUBLIC_URL) {
    urls.unshift(PUBLIC_URL);
  }
  for (const ip of getLanAddresses()) {
    urls.push(`http://${ip}:${PORT}`);
  }
  return [...new Set(urls)];
}

module.exports = {
  PORT,
  HOST,
  PUBLIC_URL,
  getAccessUrls
};
