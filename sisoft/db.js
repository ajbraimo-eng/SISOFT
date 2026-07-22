const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 32;
const HASH_PREFIX = '$scrypt$';

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJson(file, fallback) {
  ensureDir();
  const full = path.join(DATA_DIR, file);
  if (!fs.existsSync(full)) {
    writeJson(file, fallback);
    return structuredClone(fallback);
  }
  try {
    return JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch {
    return structuredClone(fallback);
  }
}

function writeJson(file, data) {
  ensureDir();
  const full = path.join(DATA_DIR, file);
  fs.writeFileSync(full, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
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
  if (!value.startsWith(HASH_PREFIX)) {
    return crypto.timingSafeEqual(
      Buffer.from(String(password)),
      Buffer.from(value.padEnd(String(password).length).slice(0, String(password).length))
    );
  }
  const parts = value.split('$');
  if (parts.length !== 7 || parts[1] !== 'scrypt') return false;
  const salt = parts[5];
  const expected = parts[6];
  const derived = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN, {
    N: Number(parts[2]),
    r: Number(parts[3]),
    p: Number(parts[4])
  });
  const left = Buffer.from(expected);
  const right = Buffer.from(derived.toString('base64url'));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function nextId(items) {
  return items.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1;
}

function ensureSeedUsers() {
  const data = readJson('users.json', { users: [] });
  if (!data.users.length) {
    const password = process.env.SISOFT_ADMIN_PASSWORD || 'sisoft2026';
    data.users.push({
      id: 1,
      fullName: 'Administrador Sisoft',
      email: 'sisoftcenter@gmail.com',
      username: 'admin',
      password: hashPassword(password),
      role: 'admin',
      created_at: new Date().toISOString()
    });
    writeJson('users.json', data);
  }
  return data.users;
}

function findUserByLogin(login) {
  const value = String(login || '').trim().toLowerCase();
  return ensureSeedUsers().find(
    (user) =>
      String(user.username || '').toLowerCase() === value ||
      String(user.email || '').toLowerCase() === value
  );
}

function publicUser(user) {
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    username: user.username,
    role: user.role
  };
}

function listLeads() {
  return readJson('leads.json', { leads: [] }).leads.sort(
    (a, b) => new Date(b.created_at) - new Date(a.created_at)
  );
}

function addLead(payload) {
  const data = readJson('leads.json', { leads: [] });
  const lead = {
    id: nextId(data.leads),
    name: String(payload.name || '').trim(),
    email: String(payload.email || '').trim(),
    phone: String(payload.phone || '').trim(),
    service: String(payload.service || '').trim(),
    message: String(payload.message || '').trim(),
    status: 'novo',
    created_at: new Date().toISOString()
  };
  if (!lead.name || !lead.message) {
    return { error: 'Nome e mensagem são obrigatórios.', status: 400 };
  }
  data.leads.push(lead);
  writeJson('leads.json', data);
  return lead;
}

function updateLead(id, patch) {
  const data = readJson('leads.json', { leads: [] });
  const index = data.leads.findIndex((item) => item.id === Number(id));
  if (index < 0) return { error: 'Pedido não encontrado.', status: 404 };
  const allowed = ['status', 'notes'];
  for (const key of allowed) {
    if (patch[key] !== undefined) data.leads[index][key] = patch[key];
  }
  data.leads[index].updated_at = new Date().toISOString();
  writeJson('leads.json', data);
  return data.leads[index];
}

function deleteLead(id) {
  const data = readJson('leads.json', { leads: [] });
  const before = data.leads.length;
  data.leads = data.leads.filter((item) => item.id !== Number(id));
  if (data.leads.length === before) return { error: 'Pedido não encontrado.', status: 404 };
  writeJson('leads.json', data);
  return { ok: true };
}

function listClients() {
  return readJson('clients.json', { clients: [] }).clients.sort(
    (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)
  );
}

function addClient(payload) {
  const data = readJson('clients.json', { clients: [] });
  const client = {
    id: nextId(data.clients),
    name: String(payload.name || '').trim(),
    email: String(payload.email || '').trim(),
    phone: String(payload.phone || '').trim(),
    notes: String(payload.notes || '').trim(),
    created_at: new Date().toISOString()
  };
  if (!client.name) return { error: 'Nome do cliente é obrigatório.', status: 400 };
  data.clients.push(client);
  writeJson('clients.json', data);
  return client;
}

function deleteClient(id) {
  const data = readJson('clients.json', { clients: [] });
  const before = data.clients.length;
  data.clients = data.clients.filter((item) => item.id !== Number(id));
  if (data.clients.length === before) return { error: 'Cliente não encontrado.', status: 404 };
  writeJson('clients.json', data);
  return { ok: true };
}

function listServices() {
  const fallback = {
    services: [
      {
        id: 1,
        name: 'Reparação de equipamentos',
        description: 'Computadores, portáteis e periféricos'
      },
      { id: 2, name: 'Criação de sites', description: 'Sites institucionais e landing pages' },
      { id: 3, name: 'Apps e sistemas', description: 'Aplicações à medida' },
      { id: 4, name: 'Design', description: 'Identidade visual e interfaces' },
      { id: 5, name: 'Redes e infraestrutura', description: 'Wi-Fi, rede local e acesso seguro' },
      { id: 6, name: 'Suporte técnico', description: 'Instalação, backup e apoio contínuo' }
    ]
  };
  return readJson('services.json', fallback).services;
}

function getSummary() {
  const leads = listLeads();
  const clients = listClients();
  return {
    leadsTotal: leads.length,
    leadsNew: leads.filter((l) => l.status === 'novo').length,
    clientsTotal: clients.length,
    servicesTotal: listServices().length
  };
}

module.exports = {
  hashPassword,
  verifyPassword,
  findUserByLogin,
  publicUser,
  ensureSeedUsers,
  listLeads,
  addLead,
  updateLead,
  deleteLead,
  listClients,
  addClient,
  deleteClient,
  listServices,
  getSummary
};
