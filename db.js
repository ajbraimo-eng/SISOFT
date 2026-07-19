const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const security = require('./security');

const dataFile = path.join(__dirname, 'stock.json');
const usersFile = path.join(__dirname, 'users.json');

function ensureDataFile() {
  if (!fs.existsSync(dataFile)) {
    fs.writeFileSync(dataFile, JSON.stringify({ items: [] }, null, 2), 'utf8');
  }
}

function ensureUsersFile() {
  if (!fs.existsSync(usersFile)) {
    fs.writeFileSync(usersFile, JSON.stringify({ users: [] }, null, 2), 'utf8');
  }
}

function readData() {
  ensureDataFile();
  const raw = fs.readFileSync(dataFile, 'utf8');
  return JSON.parse(raw);
}

function writeData(data) {
  fs.writeFileSync(dataFile, JSON.stringify(data, null, 2), 'utf8');
}

function readUsersData() {
  ensureUsersFile();
  const raw = fs.readFileSync(usersFile, 'utf8');
  return JSON.parse(raw);
}

function writeUsersData(data) {
  fs.writeFileSync(usersFile, JSON.stringify(data, null, 2), 'utf8');
}

function getAllItems() {
  return readData().items;
}

function getItem(id) {
  return getAllItems().find((item) => item.id === id);
}

function getNextId(items) {
  return items.reduce((max, item) => Math.max(max, item.id), 0) + 1;
}

function addItem({ name, quantity, price, cost, barcode, supplierId, supplierName }) {
  const data = readData();
  const items = data.items;
  const code = String(barcode || '').trim();
  if (code) {
    const existing = items.find(
      (item) => String(item.barcode || '').trim().toLowerCase() === code.toLowerCase()
    );
    if (existing) {
      return { error: 'Já existe um produto com este código de barras.', status: 409 };
    }
  }
  const supplier = resolveSupplier(supplierId, supplierName);
  if (supplier.error) return supplier;

  const newItem = {
    id: getNextId(items),
    name,
    quantity,
    price: Number(price) || 0,
    cost: Number(cost) || 0,
    barcode: code,
    supplierId: supplier.supplierId,
    supplierName: supplier.supplierName,
    created_at: new Date().toISOString()
  };
  items.push(newItem);
  writeData(data);
  return newItem;
}

function resolveSupplier(supplierId, supplierName) {
  const id = Number(supplierId);
  if (Number.isFinite(id) && id > 0) {
    const fornecedor = getFornecedorById(id);
    if (!fornecedor) {
      return { error: 'Fornecedor não encontrado. Escolha um fornecedor válido.', status: 400 };
    }
    return {
      supplierId: fornecedor.id,
      supplierName: fornecedor.name || ''
    };
  }
  const name = String(supplierName || '').trim();
  if (name) {
    return { supplierId: null, supplierName: name };
  }
  return { error: 'Escolha o fornecedor do produto.', status: 400 };
}

function updateItem(id, { name, quantity, price, cost, barcode, supplierId, supplierName }) {
  const data = readData();
  const item = data.items.find((item) => item.id === id);
  if (!item) return null;
  const code = String(barcode || '').trim();
  if (code) {
    const existing = data.items.find(
      (entry) =>
        entry.id !== id &&
        String(entry.barcode || '').trim().toLowerCase() === code.toLowerCase()
    );
    if (existing) {
      return { error: 'Já existe um produto com este código de barras.', status: 409 };
    }
  }
  const supplier = resolveSupplier(
    supplierId !== undefined ? supplierId : item.supplierId,
    supplierName !== undefined ? supplierName : item.supplierName
  );
  if (supplier.error) return supplier;

  item.name = name;
  item.quantity = quantity;
  item.price = Number(price) || 0;
  item.cost = Number(cost) || 0;
  item.barcode = code;
  item.supplierId = supplier.supplierId;
  item.supplierName = supplier.supplierName;
  writeData(data);
  return item;
}

function findItemByBarcode(barcode) {
  const code = String(barcode || '').trim().toLowerCase();
  if (!code) return null;
  return getAllItems().find(
    (item) => String(item.barcode || '').trim().toLowerCase() === code
  ) || null;
}

function deleteItem(id) {
  const data = readData();
  const index = data.items.findIndex((item) => item.id === id);
  if (index === -1) return false;
  data.items.splice(index, 1);
  writeData(data);
  return true;
}

function clearAllItems() {
  const data = readData();
  const removed = data.items.length;
  data.items = [];
  writeData(data);
  return { removed };
}

const historyFile = path.join(__dirname, 'history.json');
const HISTORY_LIMIT = 500;

function ensureHistoryFile() {
  if (!fs.existsSync(historyFile)) {
    fs.writeFileSync(historyFile, JSON.stringify({ entries: [] }, null, 2), 'utf8');
  }
}

function readHistoryData() {
  ensureHistoryFile();
  const raw = fs.readFileSync(historyFile, 'utf8');
  return JSON.parse(raw);
}

function writeHistoryData(data) {
  fs.writeFileSync(historyFile, JSON.stringify(data, null, 2), 'utf8');
}

function getAllHistory() {
  return readHistoryData().entries || [];
}

function addHistoryEntry(entry) {
  const data = readHistoryData();
  if (!Array.isArray(data.entries)) data.entries = [];
  const newEntry = {
    id: getNextId(data.entries),
    type: entry.type || 'sistema',
    action: entry.action || 'evento',
    summary: entry.summary || '',
    meta: entry.meta || {},
    userId: entry.userId ?? null,
    userName: entry.userName || 'Utilizador',
    created_at: new Date().toISOString()
  };
  data.entries.unshift(newEntry);
  if (data.entries.length > HISTORY_LIMIT) {
    data.entries = data.entries.slice(0, HISTORY_LIMIT);
  }
  writeHistoryData(data);
  return newEntry;
}

function clearHistory(type) {
  const data = readHistoryData();
  if (!Array.isArray(data.entries)) data.entries = [];
  const before = data.entries.length;
  const serviceType = String(type || '').trim();
  if (!serviceType) {
    data.entries = [];
  } else {
    data.entries = data.entries.filter((entry) => entry.type !== serviceType);
  }
  writeHistoryData(data);
  return { removed: before - data.entries.length, remaining: data.entries.length };
}

const diarioFile = path.join(__dirname, 'diario.json');

function ensureDiarioFile() {
  if (!fs.existsSync(diarioFile)) {
    fs.writeFileSync(diarioFile, JSON.stringify({ days: {}, nextMovementId: 1 }, null, 2), 'utf8');
  }
}

function readDiarioData() {
  ensureDiarioFile();
  const raw = fs.readFileSync(diarioFile, 'utf8');
  const data = JSON.parse(raw);
  if (!data.days || typeof data.days !== 'object') data.days = {};
  if (!Number.isFinite(Number(data.nextMovementId))) data.nextMovementId = 1;
  return data;
}

function writeDiarioData(data) {
  fs.writeFileSync(diarioFile, JSON.stringify(data, null, 2), 'utf8');
}

function normalizeDiarioDate(value) {
  const raw = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function enrichDiarioDay(day) {
  const movements = Array.isArray(day.movements) ? day.movements.slice() : [];
  movements.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  const initialValue = Number(day.initialValue) || 0;
  const entradas = movements
    .filter((m) => m.type === 'entrada')
    .reduce((sum, m) => sum + (Number(m.amount) || 0), 0);
  const saidas = movements
    .filter((m) => m.type === 'saida')
    .reduce((sum, m) => sum + (Number(m.amount) || 0), 0);
  return {
    date: day.date,
    initialValue,
    movements,
    updated_at: day.updated_at || null,
    totals: {
      initialValue,
      entradas,
      saidas,
      balance: initialValue + entradas - saidas,
      count: movements.length
    }
  };
}

function getDiarioDay(date) {
  const key = normalizeDiarioDate(date);
  if (!key) return { error: 'Data inválida.', status: 400 };
  const data = readDiarioData();
  const existing = data.days[key];
  if (!existing) {
    return enrichDiarioDay({ date: key, initialValue: 0, movements: [] });
  }
  return enrichDiarioDay(existing);
}

function setDiarioInitialValue(date, initialValue) {
  const key = normalizeDiarioDate(date);
  if (!key) return { error: 'Data inválida.', status: 400 };
  const amount = Number(initialValue);
  if (!Number.isFinite(amount) || amount < 0) {
    return { error: 'Valor inicial inválido.', status: 400 };
  }
  const data = readDiarioData();
  const day = data.days[key] || { date: key, initialValue: 0, movements: [] };
  day.date = key;
  day.initialValue = Math.round(amount * 100) / 100;
  day.updated_at = new Date().toISOString();
  if (!Array.isArray(day.movements)) day.movements = [];
  data.days[key] = day;
  writeDiarioData(data);
  return enrichDiarioDay(day);
}

function addDiarioMovement({ date, type, amount, description, userId, userName }) {
  const key = normalizeDiarioDate(date);
  if (!key) return { error: 'Data inválida.', status: 400 };
  const movementType = String(type || '').trim().toLowerCase();
  if (movementType !== 'entrada' && movementType !== 'saida') {
    return { error: 'Tipo deve ser entrada ou saída.', status: 400 };
  }
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) {
    return { error: 'Indique um valor válido maior que zero.', status: 400 };
  }
  const desc = String(description || '').trim();
  if (!desc) return { error: 'A descrição é obrigatória.', status: 400 };

  const data = readDiarioData();
  const day = data.days[key] || { date: key, initialValue: 0, movements: [] };
  if (!Array.isArray(day.movements)) day.movements = [];
  const id = Number(data.nextMovementId) || 1;
  const movement = {
    id,
    type: movementType,
    amount: Math.round(value * 100) / 100,
    description: desc,
    userId: userId ?? null,
    userName: userName || 'Utilizador',
    created_at: new Date().toISOString()
  };
  day.movements.unshift(movement);
  day.date = key;
  day.updated_at = movement.created_at;
  data.days[key] = day;
  data.nextMovementId = id + 1;
  writeDiarioData(data);
  return { day: enrichDiarioDay(day), movement };
}

function deleteDiarioMovement(date, movementId) {
  const key = normalizeDiarioDate(date);
  if (!key) return { error: 'Data inválida.', status: 400 };
  const id = Number(movementId);
  if (!Number.isFinite(id)) return { error: 'Movimento inválido.', status: 400 };
  const data = readDiarioData();
  const day = data.days[key];
  if (!day || !Array.isArray(day.movements)) {
    return { error: 'Movimento não encontrado.', status: 404 };
  }
  const index = day.movements.findIndex((m) => Number(m.id) === id);
  if (index === -1) return { error: 'Movimento não encontrado.', status: 404 };
  day.movements.splice(index, 1);
  day.updated_at = new Date().toISOString();
  data.days[key] = day;
  writeDiarioData(data);
  return enrichDiarioDay(day);
}

const cotacoesFile = path.join(__dirname, 'cotacoes.json');
const COTACAO_IVA_RATE = 0.16;

function ensureCotacoesFile() {
  if (!fs.existsSync(cotacoesFile)) {
    fs.writeFileSync(cotacoesFile, JSON.stringify({ cotacoes: [] }, null, 2), 'utf8');
  }
}

function readCotacoesData() {
  ensureCotacoesFile();
  const raw = fs.readFileSync(cotacoesFile, 'utf8');
  const data = JSON.parse(raw);
  if (!Array.isArray(data.cotacoes)) data.cotacoes = [];
  return data;
}

function writeCotacoesData(data) {
  fs.writeFileSync(cotacoesFile, JSON.stringify(data, null, 2), 'utf8');
}

function normalizeCotacaoItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item, index) => {
      const description = String(item?.description || '').trim();
      const quantity = Number(item?.quantity);
      const unitPrice = Number(item?.unitPrice);
      if (!description || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0) {
        return null;
      }
      return {
        id: Number(item?.id) || index + 1,
        description,
        quantity: Math.round(quantity * 100) / 100,
        unitPrice: Math.round(unitPrice * 100) / 100
      };
    })
    .filter(Boolean);
}

function computeCotacaoTotals(items, discount = 0) {
  const subtotal = items.reduce(
    (sum, item) => sum + Number(item.quantity || 0) * Number(item.unitPrice || 0),
    0
  );
  const discountValue = Math.max(0, Number(discount) || 0);
  const taxable = Math.max(0, Math.round((subtotal - discountValue) * 100) / 100);
  const iva = Math.round(taxable * COTACAO_IVA_RATE * 100) / 100;
  const total = Math.round((taxable + iva) * 100) / 100;
  return {
    subtotal: Math.round(subtotal * 100) / 100,
    discount: Math.round(discountValue * 100) / 100,
    taxable,
    iva,
    total,
    ivaRate: COTACAO_IVA_RATE
  };
}

function formatCotacaoNumber(id) {
  const num = Number(id);
  if (!Number.isFinite(num) || num < 1) return 'COT-000001';
  return `COT-${String(Math.trunc(num)).padStart(6, '0')}`;
}

function enrichCotacao(cotacao) {
  const items = Array.isArray(cotacao.items) ? cotacao.items : [];
  const totals = computeCotacaoTotals(items, cotacao.discount);
  return {
    ...cotacao,
    number: cotacao.number || formatCotacaoNumber(cotacao.id),
    address: cotacao.address || '',
    discount: Number(cotacao.discount) || 0,
    items,
    totals
  };
}

function getAllCotacoes() {
  return readCotacoesData().cotacoes.map(enrichCotacao);
}

function getCotacaoById(id) {
  const cotacao = readCotacoesData().cotacoes.find((item) => item.id === Number(id));
  return cotacao ? enrichCotacao(cotacao) : null;
}

function addCotacao(payload) {
  const client = String(payload.client || '').trim();
  if (!client) return { error: 'O nome do cliente é obrigatório.', status: 400 };
  const items = normalizeCotacaoItems(payload.items);
  if (!items.length) return { error: 'Adicione pelo menos um item válido.', status: 400 };

  const status = String(payload.status || 'rascunho').trim().toLowerCase();
  const allowed = ['rascunho', 'enviada', 'aceite', 'rejeitada'];
  if (!allowed.includes(status)) return { error: 'Estado inválido.', status: 400 };

  const data = readCotacoesData();
  const id = getNextId(data.cotacoes);
  const now = new Date().toISOString();
  const cotacao = {
    id,
    number: formatCotacaoNumber(id),
    client,
    phone: String(payload.phone || '').trim(),
    nuit: String(payload.nuit || '').trim(),
    address: String(payload.address || '').trim(),
    brand: String(payload.brand || '').trim(),
    model: String(payload.model || '').trim(),
    plate: String(payload.plate || '').trim(),
    mileage: Number(payload.mileage) || 0,
    discount: Math.max(0, Number(payload.discount) || 0),
    notes: String(payload.notes || '').trim(),
    validUntil: String(payload.validUntil || '').trim(),
    status,
    items,
    userId: payload.userId ?? null,
    userName: payload.userName || 'Utilizador',
    created_at: now,
    updated_at: now
  };
  data.cotacoes.push(cotacao);
  writeCotacoesData(data);
  return enrichCotacao(cotacao);
}

function updateCotacao(id, payload) {
  const data = readCotacoesData();
  const cotacao = data.cotacoes.find((item) => item.id === Number(id));
  if (!cotacao) return { error: 'Cotação não encontrada.', status: 404 };

  const client = String(payload.client || '').trim();
  if (!client) return { error: 'O nome do cliente é obrigatório.', status: 400 };
  const items = normalizeCotacaoItems(payload.items);
  if (!items.length) return { error: 'Adicione pelo menos um item válido.', status: 400 };

  const status = String(payload.status || cotacao.status || 'rascunho').trim().toLowerCase();
  const allowed = ['rascunho', 'enviada', 'aceite', 'rejeitada'];
  if (!allowed.includes(status)) return { error: 'Estado inválido.', status: 400 };

  cotacao.client = client;
  cotacao.phone = String(payload.phone || '').trim();
  cotacao.nuit = String(payload.nuit || '').trim();
  cotacao.address = String(payload.address || '').trim();
  cotacao.brand = String(payload.brand || '').trim();
  cotacao.model = String(payload.model || '').trim();
  cotacao.plate = String(payload.plate || '').trim();
  cotacao.mileage = Number(payload.mileage) || 0;
  cotacao.discount = Math.max(0, Number(payload.discount) || 0);
  cotacao.notes = String(payload.notes || '').trim();
  cotacao.validUntil = String(payload.validUntil || '').trim();
  cotacao.status = status;
  cotacao.items = items;
  cotacao.updated_at = new Date().toISOString();
  writeCotacoesData(data);
  return enrichCotacao(cotacao);
}

function deleteCotacao(id) {
  const data = readCotacoesData();
  const index = data.cotacoes.findIndex((item) => item.id === Number(id));
  if (index === -1) return { error: 'Cotação não encontrada.', status: 404 };
  const [removed] = data.cotacoes.splice(index, 1);
  writeCotacoesData(data);
  return enrichCotacao(removed);
}

const facturasFile = path.join(__dirname, 'facturas.json');
const FACTURA_STATUSES = ['pendente', 'pago', 'anulada'];

function ensureFacturasFile() {
  if (!fs.existsSync(facturasFile)) {
    fs.writeFileSync(facturasFile, JSON.stringify({ facturas: [] }, null, 2), 'utf8');
  }
}

function readFacturasData() {
  ensureFacturasFile();
  const raw = fs.readFileSync(facturasFile, 'utf8');
  const data = JSON.parse(raw);
  if (!Array.isArray(data.facturas)) data.facturas = [];
  return data;
}

function writeFacturasData(data) {
  fs.writeFileSync(facturasFile, JSON.stringify(data, null, 2), 'utf8');
}

function normalizeFacturaStatus(status) {
  const raw = String(status || '').trim().toLowerCase();
  const aliases = {
    rascunho: 'pendente',
    emitida: 'pendente',
    paga: 'pago',
    pendente: 'pendente',
    pago: 'pago',
    anulada: 'anulada'
  };
  return aliases[raw] || null;
}

function nextFacturaNumber(facturas, dateValue) {
  const base = dateValue ? new Date(dateValue) : new Date();
  const year = Number.isFinite(base.getTime()) ? base.getFullYear() : new Date().getFullYear();
  let max = 0;
  (facturas || []).forEach((item) => {
    const match = String(item.number || '').match(/^FT-(\d{4})-(\d+)$/i);
    if (!match) return;
    if (Number(match[1]) !== year) return;
    max = Math.max(max, Number(match[2]) || 0);
  });
  return `FT-${year}-${String(max + 1).padStart(4, '0')}`;
}

function parseFacturaMoney(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  let text = String(value || '').trim().replace(/\s/g, '');
  if (!text) return NaN;
  if (text.includes(',') && text.includes('.')) {
    text = text.replace(/\./g, '').replace(',', '.');
  } else if (text.includes(',')) {
    text = text.replace(',', '.');
  }
  return Number(text);
}

function resolveFacturaNumber(payload, facturas, issueDate, excludeId) {
  const manual = String(payload.number || '').trim().toUpperCase();
  if (manual) {
    const exists = (facturas || []).some(
      (item) =>
        String(item.number || '').trim().toUpperCase() === manual &&
        Number(item.id) !== Number(excludeId)
    );
    if (exists) return { error: 'Já existe uma fatura com este número.', status: 400 };
    return { number: manual };
  }
  const others = (facturas || []).filter((item) => Number(item.id) !== Number(excludeId));
  return { number: nextFacturaNumber(others, issueDate) };
}

function formatFacturaNumber(id, year) {
  const y = Number(year) || new Date().getFullYear();
  const num = Number(id);
  if (!Number.isFinite(num) || num < 1) return `FT-${y}-0001`;
  return `FT-${y}-${String(Math.trunc(num)).padStart(4, '0')}`;
}

function enrichFactura(factura) {
  const items = Array.isArray(factura.items) ? factura.items : [];
  const totals = computeCotacaoTotals(items, factura.discount);
  const status = normalizeFacturaStatus(factura.status) || 'pendente';
  const year = factura.issueDate
    ? new Date(factura.issueDate).getFullYear()
    : new Date(factura.created_at || Date.now()).getFullYear();
  const attachment = factura.attachment && factura.attachment.storedName
    ? {
        fileName: factura.attachment.fileName || 'anexo',
        mimeType: factura.attachment.mimeType || 'application/octet-stream',
        size: Number(factura.attachment.size) || 0
      }
    : null;
  return {
    ...factura,
    number: factura.number || formatFacturaNumber(factura.id, year),
    address: factura.address || '',
    discount: Number(factura.discount) || 0,
    status,
    items,
    totals,
    attachment,
    hasAttachment: Boolean(attachment)
  };
}

const facturasUploadDir = path.join(__dirname, 'uploads', 'facturas');
const FACTURA_ATTACHMENT_MAX_BYTES = 8 * 1024 * 1024;
const FACTURA_ATTACHMENT_MIME =
  /^(application\/pdf|image\/(jpeg|jpg|png|webp|gif)|application\/msword|application\/vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet))$/i;

function ensureFacturasUploadDir() {
  if (!fs.existsSync(facturasUploadDir)) {
    fs.mkdirSync(facturasUploadDir, { recursive: true });
  }
}

function sanitizeAttachmentName(name) {
  const cleaned = String(name || 'anexo')
    .replace(/[^\w.\- ()\[\]]+/g, '_')
    .replace(/_+/g, '_')
    .trim();
  return (cleaned || 'anexo').slice(0, 120);
}

function parseAttachmentDataUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;
  const match = value.match(/^data:([^;]+);base64,(.+)$/i);
  if (match) {
    return { mimeType: match[1], buffer: Buffer.from(match[2], 'base64') };
  }
  return { mimeType: '', buffer: Buffer.from(value, 'base64') };
}

function removeFacturaAttachmentFile(attachment) {
  if (!attachment?.storedName) return;
  const filePath = path.join(facturasUploadDir, path.basename(attachment.storedName));
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch {
      /* ignore */
    }
  }
}

function applyFacturaAttachment(factura, payload) {
  if (payload.removeAttachment) {
    removeFacturaAttachmentFile(factura.attachment);
    factura.attachment = null;
    return null;
  }

  const incoming = payload.attachment;
  if (!incoming || typeof incoming !== 'object' || !incoming.data) {
    return null;
  }

  const parsed = parseAttachmentDataUrl(incoming.data);
  if (!parsed || !parsed.buffer?.length) {
    return { error: 'Anexo inválido.', status: 400 };
  }
  if (parsed.buffer.length > FACTURA_ATTACHMENT_MAX_BYTES) {
    return { error: 'O anexo não pode ultrapassar 8 MB.', status: 400 };
  }

  const mimeType = String(incoming.mimeType || parsed.mimeType || '').trim().toLowerCase();
  if (!FACTURA_ATTACHMENT_MIME.test(mimeType)) {
    return { error: 'Tipo de anexo não suportado. Use PDF, imagem, Word ou Excel.', status: 400 };
  }

  ensureFacturasUploadDir();
  removeFacturaAttachmentFile(factura.attachment);

  const fileName = sanitizeAttachmentName(incoming.fileName || incoming.name || 'anexo');
  const ext = path.extname(fileName) || (mimeType.includes('pdf') ? '.pdf' : '');
  const storedName = `${factura.id}-${Date.now()}${ext}`;
  const filePath = path.join(facturasUploadDir, storedName);
  fs.writeFileSync(filePath, parsed.buffer);

  factura.attachment = {
    fileName,
    storedName,
    mimeType,
    size: parsed.buffer.length,
    uploaded_at: new Date().toISOString()
  };
  return null;
}

function getFacturaAttachmentPath(id) {
  const raw = readFacturasData().facturas.find((item) => item.id === Number(id));
  if (!raw?.attachment?.storedName) return null;
  const filePath = path.join(facturasUploadDir, path.basename(raw.attachment.storedName));
  if (!fs.existsSync(filePath)) return null;
  return {
    factura: enrichFactura(raw),
    filePath,
    fileName: raw.attachment.fileName || 'anexo',
    mimeType: raw.attachment.mimeType || 'application/octet-stream'
  };
}

function getAllFacturas() {
  return readFacturasData().facturas.map(enrichFactura);
}

function getFacturaById(id) {
  const factura = readFacturasData().facturas.find((item) => item.id === Number(id));
  return factura ? enrichFactura(factura) : null;
}

function resolveFacturaItems(payload) {
  const fromItems = normalizeCotacaoItems(payload.items);
  if (fromItems.length) return fromItems;
  const amount = parseFacturaMoney(payload.amount ?? payload.valor ?? payload.subtotal);
  if (Number.isFinite(amount) && amount > 0) {
    return [
      {
        id: 1,
        description: 'Serviços',
        quantity: 1,
        unitPrice: Math.round(amount * 100) / 100
      }
    ];
  }
  return [];
}

function addFactura(payload) {
  const client = String(payload.client || '').trim();
  if (!client) return { error: 'O nome do cliente é obrigatório.', status: 400 };
  const items = resolveFacturaItems(payload);
  if (!items.length) return { error: 'Indique um valor válido.', status: 400 };

  const status = normalizeFacturaStatus(payload.status || 'pendente');
  if (!status || !FACTURA_STATUSES.includes(status)) {
    return { error: 'Estado inválido.', status: 400 };
  }

  const data = readFacturasData();
  const id = getNextId(data.facturas);
  const now = new Date().toISOString();
  const issueDate = String(payload.issueDate || now.slice(0, 10)).trim();
  const numberResult = resolveFacturaNumber(payload, data.facturas, issueDate, null);
  if (numberResult.error) return numberResult;

  const factura = {
    id,
    number: numberResult.number,
    client,
    phone: String(payload.phone || '').trim(),
    nuit: String(payload.nuit || '').trim(),
    address: String(payload.address || '').trim(),
    brand: '',
    model: '',
    plate: String(payload.plate || '').trim(),
    mileage: 0,
    discount: Math.max(0, parseFacturaMoney(payload.discount) || 0),
    notes: '',
    issueDate,
    status,
    items,
    attachment: null,
    userId: payload.userId ?? null,
    userName: payload.userName || 'Utilizador',
    created_at: now,
    updated_at: now
  };

  const attachmentError = applyFacturaAttachment(factura, payload);
  if (attachmentError) return attachmentError;

  data.facturas.push(factura);
  writeFacturasData(data);
  return enrichFactura(factura);
}

function updateFactura(id, payload) {
  const data = readFacturasData();
  const factura = data.facturas.find((item) => item.id === Number(id));
  if (!factura) return { error: 'Factura não encontrada.', status: 404 };

  const client = String(payload.client || '').trim();
  if (!client) return { error: 'O nome do cliente é obrigatório.', status: 400 };
  const items = resolveFacturaItems(payload);
  if (!items.length) return { error: 'Indique um valor válido.', status: 400 };

  const status = normalizeFacturaStatus(payload.status || factura.status || 'pendente');
  if (!status || !FACTURA_STATUSES.includes(status)) {
    return { error: 'Estado inválido.', status: 400 };
  }

  const issueDate = String(payload.issueDate || factura.issueDate || '').trim();
  const numberResult = resolveFacturaNumber(
    { number: payload.number !== undefined ? payload.number : factura.number },
    data.facturas,
    issueDate || factura.created_at,
    factura.id
  );
  if (numberResult.error) return numberResult;

  factura.number = numberResult.number;
  factura.client = client;
  factura.phone = String(payload.phone || '').trim();
  factura.nuit = String(payload.nuit || '').trim();
  factura.address = String(payload.address || '').trim();
  factura.brand = '';
  factura.model = '';
  factura.plate = String(payload.plate || '').trim();
  factura.mileage = 0;
  factura.discount = Math.max(0, parseFacturaMoney(payload.discount) || 0);
  factura.notes = '';
  factura.issueDate = issueDate;
  factura.status = status;
  factura.items = items;
  factura.updated_at = new Date().toISOString();

  const attachmentError = applyFacturaAttachment(factura, payload);
  if (attachmentError) return attachmentError;

  writeFacturasData(data);
  return enrichFactura(factura);
}

function deleteFactura(id) {
  const data = readFacturasData();
  const index = data.facturas.findIndex((item) => item.id === Number(id));
  if (index === -1) return { error: 'Factura não encontrada.', status: 404 };
  const [removed] = data.facturas.splice(index, 1);
  removeFacturaAttachmentFile(removed.attachment);
  writeFacturasData(data);
  return enrichFactura(removed);
}

const camerasFile = path.join(__dirname, 'cameras.json');

function ensureCamerasFile() {
  if (!fs.existsSync(camerasFile)) {
    fs.writeFileSync(camerasFile, JSON.stringify({ cameras: [] }, null, 2), 'utf8');
  }
}

function readCamerasData() {
  ensureCamerasFile();
  const raw = fs.readFileSync(camerasFile, 'utf8');
  const data = JSON.parse(raw);
  if (!Array.isArray(data.cameras)) data.cameras = [];
  return data;
}

function writeCamerasData(data) {
  fs.writeFileSync(camerasFile, JSON.stringify(data, null, 2), 'utf8');
}

function getAllCameras() {
  return readCamerasData().cameras.slice().sort(
    (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
  );
}

function getCameraById(id) {
  return getAllCameras().find((item) => item.id === Number(id)) || null;
}

function addCamera(payload) {
  const name = String(payload.name || '').trim();
  const url = String(payload.url || '').trim();
  if (!name) return { error: 'O nome da camera é obrigatório.', status: 400 };
  if (!url) return { error: 'A URL da camera é obrigatória.', status: 400 };
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { error: 'Use uma URL http ou https.', status: 400 };
    }
  } catch {
    return { error: 'URL inválida.', status: 400 };
  }

  const data = readCamerasData();
  const now = new Date().toISOString();
  const camera = {
    id: getNextId(data.cameras),
    name,
    url,
    userId: payload.userId ?? null,
    userName: payload.userName || 'Utilizador',
    created_at: now,
    updated_at: now
  };
  data.cameras.push(camera);
  writeCamerasData(data);
  return camera;
}

function updateCamera(id, payload) {
  const data = readCamerasData();
  const camera = data.cameras.find((item) => item.id === Number(id));
  if (!camera) return { error: 'Camera não encontrada.', status: 404 };

  const name = String(payload.name || '').trim();
  const url = String(payload.url || '').trim();
  if (!name) return { error: 'O nome da camera é obrigatório.', status: 400 };
  if (!url) return { error: 'A URL da camera é obrigatória.', status: 400 };
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { error: 'Use uma URL http ou https.', status: 400 };
    }
  } catch {
    return { error: 'URL inválida.', status: 400 };
  }

  camera.name = name;
  camera.url = url;
  camera.updated_at = new Date().toISOString();
  writeCamerasData(data);
  return camera;
}

function deleteCamera(id) {
  const data = readCamerasData();
  const index = data.cameras.findIndex((item) => item.id === Number(id));
  if (index === -1) return { error: 'Camera não encontrada.', status: 404 };
  const [removed] = data.cameras.splice(index, 1);
  writeCamerasData(data);
  return removed;
}

const clientesFile = path.join(__dirname, 'clientes.json');

function ensureClientesFile() {
  if (!fs.existsSync(clientesFile)) {
    fs.writeFileSync(clientesFile, JSON.stringify({ clientes: [] }, null, 2), 'utf8');
  }
}

function readClientesData() {
  ensureClientesFile();
  const raw = fs.readFileSync(clientesFile, 'utf8');
  const data = JSON.parse(raw);
  if (!Array.isArray(data.clientes)) data.clientes = [];
  return data;
}

function writeClientesData(data) {
  fs.writeFileSync(clientesFile, JSON.stringify(data, null, 2), 'utf8');
}

function getAllClientes() {
  const clientes = readClientesData().clientes;
  return clientes.map((cliente) => ({
    ...cliente,
    type: normalizeClienteType(cliente.type)
  }));
}

function getClienteById(id) {
  return getAllClientes().find((item) => item.id === Number(id)) || null;
}

function findClienteByPhone(phone, excludeId) {
  const sms = require('./sms');
  const target = String(phone || '').trim();
  if (!target) return null;
  return getAllClientes().find((cliente) => {
    if (excludeId && Number(cliente.id) === Number(excludeId)) return false;
    if (!cliente.phone) return false;
    if (typeof sms.phonesMatch === 'function') {
      return sms.phonesMatch(cliente.phone, target);
    }
    return String(cliente.phone).replace(/\D/g, '') === target.replace(/\D/g, '');
  }) || null;
}

function normalizeClienteType(value) {
  const type = String(value || '').trim().toLowerCase();
  if (type === 'empresa' || type === 'empresas' || type === 'company') return 'empresa';
  return 'particular';
}

function addCliente(payload) {
  const name = String(payload.name || payload.client || '').trim();
  if (!name) return { error: 'O nome do cliente é obrigatório.', status: 400 };
  const phone = String(payload.phone || '').trim();
  if (phone && findClienteByPhone(phone)) {
    return { error: 'Já existe um cliente com este telemóvel.', status: 409 };
  }

  const data = readClientesData();
  const now = new Date().toISOString();
  const cliente = {
    id: getNextId(data.clientes),
    type: normalizeClienteType(payload.type),
    name,
    phone,
    email: String(payload.email || '').trim(),
    document: String(payload.document || '').trim(),
    address: String(payload.address || '').trim(),
    notes: String(payload.notes || '').trim(),
    userId: payload.userId ?? null,
    userName: payload.userName || 'Utilizador',
    created_at: now,
    updated_at: now
  };
  data.clientes.push(cliente);
  writeClientesData(data);
  return cliente;
}

function updateCliente(id, payload) {
  const data = readClientesData();
  const cliente = data.clientes.find((item) => item.id === Number(id));
  if (!cliente) return { error: 'Cliente não encontrado.', status: 404 };

  const name = String(payload.name || payload.client || '').trim();
  if (!name) return { error: 'O nome do cliente é obrigatório.', status: 400 };
  const phone = String(payload.phone || '').trim();
  if (phone && findClienteByPhone(phone, id)) {
    return { error: 'Já existe um cliente com este telemóvel.', status: 409 };
  }

  cliente.type = normalizeClienteType(payload.type ?? cliente.type);
  cliente.name = name;
  cliente.phone = phone;
  cliente.email = String(payload.email || '').trim();
  cliente.document = String(payload.document || '').trim();
  cliente.address = String(payload.address || '').trim();
  cliente.notes = String(payload.notes || '').trim();
  cliente.updated_at = new Date().toISOString();
  writeClientesData(data);
  return cliente;
}

function deleteCliente(id) {
  const data = readClientesData();
  const index = data.clientes.findIndex((item) => item.id === Number(id));
  if (index === -1) return { error: 'Cliente não encontrado.', status: 404 };
  const [removed] = data.clientes.splice(index, 1);
  writeClientesData(data);
  return removed;
}

const fornecedoresFile = path.join(__dirname, 'fornecedores.json');

function ensureFornecedoresFile() {
  if (!fs.existsSync(fornecedoresFile)) {
    fs.writeFileSync(fornecedoresFile, JSON.stringify({ fornecedores: [] }, null, 2), 'utf8');
  }
}

function readFornecedoresData() {
  ensureFornecedoresFile();
  const raw = fs.readFileSync(fornecedoresFile, 'utf8');
  const data = JSON.parse(raw);
  if (!Array.isArray(data.fornecedores)) data.fornecedores = [];
  return data;
}

function writeFornecedoresData(data) {
  fs.writeFileSync(fornecedoresFile, JSON.stringify(data, null, 2), 'utf8');
}

function getAllFornecedores() {
  return readFornecedoresData().fornecedores;
}

function getFornecedorById(id) {
  return getAllFornecedores().find((item) => item.id === Number(id)) || null;
}

function findFornecedorByPhone(phone, excludeId) {
  const sms = require('./sms');
  const target = String(phone || '').trim();
  if (!target) return null;
  return getAllFornecedores().find((fornecedor) => {
    if (excludeId && Number(fornecedor.id) === Number(excludeId)) return false;
    if (!fornecedor.phone) return false;
    if (typeof sms.phonesMatch === 'function') {
      return sms.phonesMatch(fornecedor.phone, target);
    }
    return String(fornecedor.phone).replace(/\D/g, '') === target.replace(/\D/g, '');
  }) || null;
}

function addFornecedor(payload) {
  const name = String(payload.name || '').trim();
  if (!name) return { error: 'O nome do fornecedor é obrigatório.', status: 400 };
  const phone = String(payload.phone || '').trim();
  if (phone && findFornecedorByPhone(phone)) {
    return { error: 'Já existe um fornecedor com este telemóvel.', status: 409 };
  }

  const data = readFornecedoresData();
  const now = new Date().toISOString();
  const fornecedor = {
    id: getNextId(data.fornecedores),
    name,
    phone,
    email: String(payload.email || '').trim(),
    nuit: String(payload.nuit || payload.document || '').trim(),
    contact: String(payload.contact || '').trim(),
    address: String(payload.address || '').trim(),
    notes: String(payload.notes || '').trim(),
    userId: payload.userId ?? null,
    userName: payload.userName || 'Utilizador',
    created_at: now,
    updated_at: now
  };
  data.fornecedores.push(fornecedor);
  writeFornecedoresData(data);
  return fornecedor;
}

function updateFornecedor(id, payload) {
  const data = readFornecedoresData();
  const fornecedor = data.fornecedores.find((item) => item.id === Number(id));
  if (!fornecedor) return { error: 'Fornecedor não encontrado.', status: 404 };

  const name = String(payload.name || '').trim();
  if (!name) return { error: 'O nome do fornecedor é obrigatório.', status: 400 };
  const phone = String(payload.phone || '').trim();
  if (phone && findFornecedorByPhone(phone, id)) {
    return { error: 'Já existe um fornecedor com este telemóvel.', status: 409 };
  }

  fornecedor.name = name;
  fornecedor.phone = phone;
  fornecedor.email = String(payload.email || '').trim();
  fornecedor.nuit = String(payload.nuit || payload.document || '').trim();
  fornecedor.contact = String(payload.contact || '').trim();
  fornecedor.address = String(payload.address || '').trim();
  fornecedor.notes = String(payload.notes || '').trim();
  fornecedor.updated_at = new Date().toISOString();
  writeFornecedoresData(data);
  return fornecedor;
}

function deleteFornecedor(id) {
  const data = readFornecedoresData();
  const index = data.fornecedores.findIndex((item) => item.id === Number(id));
  if (index === -1) return { error: 'Fornecedor não encontrado.', status: 404 };
  const [removed] = data.fornecedores.splice(index, 1);
  writeFornecedoresData(data);
  return removed;
}

function getSummary() {
  const items = getAllItems();
  const purchaseTotal = items.reduce(
    (sum, item) => sum + Number(item.quantity || 0) * Number(item.cost || 0),
    0
  );
  const saleTotal = items.reduce(
    (sum, item) => sum + Number(item.quantity || 0) * Number(item.price || 0),
    0
  );
  return {
    totalItems: items.length,
    totalValue: saleTotal,
    purchaseTotal,
    saleTotal,
    profitTotal: saleTotal - purchaseTotal
  };
}

function getAllUsers() {
  return ensureQrLoginKeys();
}

function generateQrLoginKey() {
  return crypto.randomBytes(16).toString('hex');
}

function ensureQrLoginKeys() {
  const data = readUsersData();
  let changed = false;
  for (const user of data.users) {
    if (!user.qrLoginKey || String(user.qrLoginKey).length < 16) {
      user.qrLoginKey = generateQrLoginKey();
      changed = true;
    }
  }
  if (changed) {
    writeUsersData(data);
  }
  return data.users;
}

function buildLoginQrPayload(user) {
  if (!user || !user.id || !user.qrLoginKey) return '';
  return `ISOFTLOGIN:1:${user.id}:${user.qrLoginKey}`;
}

function findUserByLoginQr(payload) {
  const text = String(payload || '').trim();
  const match = text.match(/^ISOFTLOGIN:1:(\d+):([a-f0-9]{16,})$/i);
  if (!match) return null;
  const user = getUserById(Number(match[1]));
  if (!user || !user.qrLoginKey) return null;
  if (String(user.qrLoginKey).toLowerCase() !== String(match[2]).toLowerCase()) {
    return null;
  }
  return user;
}

function hasWebAuthnCredentials(user) {
  return Array.isArray(user?.webauthnCredentials) && user.webauthnCredentials.length > 0;
}

function hasFaceDescriptor(user) {
  return Array.isArray(user?.faceDescriptor) && user.faceDescriptor.length >= 64;
}

function isFaceIdEnabled(user) {
  return hasFaceDescriptor(user) || hasWebAuthnCredentials(user);
}

function setFaceDescriptor(userId, descriptor) {
  const data = readUsersData();
  const user = data.users.find((u) => u.id === Number(userId));
  if (!user) return null;
  if (!Array.isArray(descriptor) || descriptor.length < 64) {
    return { error: 'Descritor facial inválido.', status: 400 };
  }
  user.faceDescriptor = descriptor.map((n) => Number(n));
  user.faceDescriptorUpdatedAt = new Date().toISOString();
  user.updated_at = new Date().toISOString();
  writeUsersData(data);
  const { password, qrLoginKey, faceDescriptor, webauthnCredentials, ...safeUser } = user;
  return {
    ...safeUser,
    loginQr: buildLoginQrPayload(user),
    faceIdEnabled: true
  };
}

function clearFaceDescriptor(userId) {
  const data = readUsersData();
  const user = data.users.find((u) => u.id === Number(userId));
  if (!user) return null;
  delete user.faceDescriptor;
  delete user.faceDescriptorUpdatedAt;
  user.updated_at = new Date().toISOString();
  writeUsersData(data);
  const { password, qrLoginKey, faceDescriptor, webauthnCredentials, ...safeUser } = user;
  return {
    ...safeUser,
    loginQr: buildLoginQrPayload(user),
    faceIdEnabled: isFaceIdEnabled(user)
  };
}

function faceDistance(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
    return Number.POSITIVE_INFINITY;
  }
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    const d = Number(a[i]) - Number(b[i]);
    sum += d * d;
  }
  return Math.sqrt(sum);
}

function findUserByFaceDescriptor(descriptor, threshold = 0.52) {
  if (!Array.isArray(descriptor) || descriptor.length < 64) return null;
  let best = null;
  for (const user of getAllUsers()) {
    if (!hasFaceDescriptor(user)) continue;
    const distance = faceDistance(descriptor, user.faceDescriptor);
    if (distance <= threshold && (!best || distance < best.distance)) {
      best = { user, distance };
    }
  }
  return best;
}

function addWebAuthnCredential(userId, credential) {
  const data = readUsersData();
  const user = data.users.find((u) => u.id === Number(userId));
  if (!user) return null;
  if (!Array.isArray(user.webauthnCredentials)) user.webauthnCredentials = [];
  user.webauthnCredentials = user.webauthnCredentials.filter((c) => c.id !== credential.id);
  user.webauthnCredentials.push(credential);
  user.updated_at = new Date().toISOString();
  writeUsersData(data);
  const { password, qrLoginKey, ...safeUser } = user;
  return {
    ...safeUser,
    loginQr: buildLoginQrPayload(user),
    faceIdEnabled: isFaceIdEnabled(user)
  };
}

function findUserByWebAuthnCredentialId(credentialId) {
  const id = String(credentialId || '');
  if (!id) return null;
  return (
    getAllUsers().find(
      (u) =>
        Array.isArray(u.webauthnCredentials) &&
        u.webauthnCredentials.some((c) => c.id === id)
    ) || null
  );
}

function updateWebAuthnCredentialCounter(userId, credentialId, counter) {
  const data = readUsersData();
  const user = data.users.find((u) => u.id === Number(userId));
  if (!user || !Array.isArray(user.webauthnCredentials)) return null;
  const cred = user.webauthnCredentials.find((c) => c.id === credentialId);
  if (!cred) return null;
  cred.counter = Number(counter) || 0;
  user.updated_at = new Date().toISOString();
  writeUsersData(data);
  return cred;
}

function removeWebAuthnCredentials(userId) {
  const data = readUsersData();
  const user = data.users.find((u) => u.id === Number(userId));
  if (!user) return null;
  user.webauthnCredentials = [];
  user.updated_at = new Date().toISOString();
  writeUsersData(data);
  const { password, qrLoginKey, ...safeUser } = user;
  return {
    ...safeUser,
    loginQr: buildLoginQrPayload(user),
    faceIdEnabled: isFaceIdEnabled(user)
  };
}

function findUserByUsernameOrEmail(username, email, excludeId) {
  const users = getAllUsers();
  return users.find(
    (u) =>
      u.id !== excludeId &&
      (u.username.toLowerCase() === String(username || '').toLowerCase() ||
        u.email.toLowerCase() === String(email || '').toLowerCase())
  );
}

function findUserByLogin(login) {
  const value = String(login || '').toLowerCase();
  return getAllUsers().find(
    (u) => u.username.toLowerCase() === value || u.email.toLowerCase() === value
  );
}

function findUserByPhone(phone) {
  const sms = require('./sms');
  const target = sms.normalizePhone(phone);
  if (!target) return null;
  return getAllUsers().find((u) => sms.phonesMatch(u.phone, target)) || null;
}

function getUserById(id) {
  return getAllUsers().find((u) => u.id === Number(id)) || null;
}

function addUser(userData) {
  const data = readUsersData();
  const users = data.users;
  const rawPassword = String(userData.password || '');
  const newUser = {
    id: getNextId(users),
    fullName: userData.fullName,
    email: userData.email,
    username: userData.username,
    password: security.hashPassword(rawPassword),
    phone: userData.phone || '',
    documentId: userData.documentId || '',
    birthDate: userData.birthDate || '',
    role: userData.role || '',
    department: userData.department || '',
    address: userData.address || '',
    city: userData.city || '',
    country: userData.country || '',
    photo: userData.photo || '',
    qrLoginKey: generateQrLoginKey(),
    created_at: new Date().toISOString()
  };
  users.push(newUser);
  writeUsersData(data);
  const { password, qrLoginKey, faceDescriptor, webauthnCredentials, ...safeUser } = newUser;
  return { ...safeUser, loginQr: buildLoginQrPayload(newUser) };
}

function updateUser(id, userData) {
  const data = readUsersData();
  const user = data.users.find((u) => u.id === Number(id));
  if (!user) return null;

  user.fullName = userData.fullName;
  user.email = userData.email;
  user.username = userData.username;
  if (userData.password) {
    user.password = security.hashPassword(String(userData.password));
  }
  user.phone = userData.phone || '';
  user.documentId = userData.documentId || '';
  user.birthDate = userData.birthDate || '';
  user.role = userData.role || '';
  user.department = userData.department || '';
  user.address = userData.address || '';
  user.city = userData.city || '';
  user.country = userData.country || '';
  if (typeof userData.photo === 'string') {
    user.photo = userData.photo;
  }
  if (!user.qrLoginKey) {
    user.qrLoginKey = generateQrLoginKey();
  }
  user.updated_at = new Date().toISOString();

  writeUsersData(data);
  const { password, qrLoginKey, faceDescriptor, webauthnCredentials, ...safeUser } = user;
  return { ...safeUser, loginQr: buildLoginQrPayload(user) };
}

function updateUserPassword(id, password) {
  const data = readUsersData();
  const user = data.users.find((u) => u.id === Number(id));
  if (!user) return null;
  if (!password || String(password).length < 6) {
    return { error: 'A senha deve ter pelo menos 6 caracteres.', status: 400 };
  }
  user.password = security.hashPassword(String(password));
  user.updated_at = new Date().toISOString();
  writeUsersData(data);
  const { password: _pw, qrLoginKey, faceDescriptor, webauthnCredentials, ...safeUser } = user;
  return safeUser;
}

function deleteUser(id) {
  const data = readUsersData();
  const index = data.users.findIndex((u) => u.id === Number(id));
  if (index === -1) return false;
  data.users.splice(index, 1);
  writeUsersData(data);
  return true;
}

const obrasFile = path.join(__dirname, 'obras.json');

function ensureObrasFile() {
  if (!fs.existsSync(obrasFile)) {
    fs.writeFileSync(obrasFile, JSON.stringify({ obras: [] }, null, 2), 'utf8');
  }
}

function readObrasData() {
  ensureObrasFile();
  const raw = fs.readFileSync(obrasFile, 'utf8');
  return JSON.parse(raw);
}

function writeObrasData(data) {
  fs.writeFileSync(obrasFile, JSON.stringify(data, null, 2), 'utf8');
}

function getAllObras() {
  return readObrasData().obras;
}

function addObra(obraData) {
  const data = readObrasData();
  const obras = data.obras;
  const clientName = String(obraData.client || obraData.name || '').trim();
  const newObra = {
    id: getNextId(obras),
    client: clientName,
    name: clientName,
    phone: obraData.phone || '',
    brand: obraData.brand || '',
    model: obraData.model || '',
    mileage: Number(obraData.mileage) || 0,
    entryDate: obraData.entryDate || '',
    plate: obraData.plate || '',
    serviceDescription: obraData.serviceDescription || '',
    requisicoes: [],
    created_at: new Date().toISOString()
  };
  obras.push(newObra);
  writeObrasData(data);
  return newObra;
}

function updateObra(id, obraData) {
  const data = readObrasData();
  const obra = data.obras.find((o) => o.id === Number(id));
  if (!obra) return null;
  const clientName = String(obraData.client || obraData.name || '').trim();
  obra.client = clientName;
  obra.name = clientName;
  obra.phone = obraData.phone || '';
  obra.brand = obraData.brand || '';
  obra.model = obraData.model || '';
  obra.mileage = Number(obraData.mileage) || 0;
  obra.entryDate = obraData.entryDate || '';
  obra.plate = obraData.plate || '';
  obra.serviceDescription = obraData.serviceDescription || '';
  obra.updated_at = new Date().toISOString();
  writeObrasData(data);
  return obra;
}

function deleteObra(id) {
  const data = readObrasData();
  const index = data.obras.findIndex((o) => o.id === Number(id));
  if (index === -1) return false;
  data.obras.splice(index, 1);
  writeObrasData(data);
  return true;
}

function addRequisicao(obraId, { itemId, quantity }) {
  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty <= 0) {
    return { error: 'Quantidade inválida.', status: 400 };
  }

  const stockData = readData();
  const item = stockData.items.find((entry) => entry.id === Number(itemId));
  if (!item) {
    return { error: 'Produto não encontrado no stock.', status: 404 };
  }
  if (item.quantity < qty) {
    return { error: `Stock insuficiente. Disponível: ${item.quantity}.`, status: 400 };
  }

  const obrasData = readObrasData();
  const obra = obrasData.obras.find((o) => o.id === Number(obraId));
  if (!obra) {
    return { error: 'Obra não encontrada.', status: 404 };
  }

  if (!Array.isArray(obra.requisicoes)) {
    obra.requisicoes = [];
  }

  const unitPrice = Number(item.price) || 0;
  const lineTotal = qty * unitPrice;
  let requisicao = obra.requisicoes.find((entry) => Number(entry.itemId) === Number(item.id));

  if (requisicao) {
    requisicao.quantity = Number(requisicao.quantity || 0) + qty;
    requisicao.unitPrice = unitPrice;
    requisicao.total = Number(requisicao.quantity) * unitPrice;
    requisicao.itemName = item.name;
    requisicao.updated_at = new Date().toISOString();
  } else {
    requisicao = {
      id: getNextId(obra.requisicoes),
      itemId: item.id,
      itemName: item.name,
      quantity: qty,
      unitPrice,
      total: lineTotal,
      created_at: new Date().toISOString()
    };
    obra.requisicoes.push(requisicao);
  }

  item.quantity -= qty;
  obra.updated_at = new Date().toISOString();

  writeData(stockData);
  writeObrasData(obrasData);

  return { obra, requisicao, item };
}

function updateRequisicao(obraId, requisicaoId, { quantity }) {
  const newQty = Number(quantity);
  if (!Number.isFinite(newQty) || newQty < 0) {
    return { error: 'Quantidade inválida.', status: 400 };
  }

  const obrasData = readObrasData();
  const obra = obrasData.obras.find((o) => o.id === Number(obraId));
  if (!obra) {
    return { error: 'Obra não encontrada.', status: 404 };
  }
  if (!Array.isArray(obra.requisicoes)) {
    return { error: 'Requisição não encontrada.', status: 404 };
  }

  const reqIndex = obra.requisicoes.findIndex((entry) => entry.id === Number(requisicaoId));
  if (reqIndex === -1) {
    return { error: 'Requisição não encontrada.', status: 404 };
  }

  const requisicao = obra.requisicoes[reqIndex];
  const oldQty = Number(requisicao.quantity || 0);
  const delta = newQty - oldQty;

  const stockData = readData();
  let item = stockData.items.find((entry) => entry.id === Number(requisicao.itemId));

  if (delta > 0) {
    if (!item) {
      return { error: 'Produto não encontrado no stock.', status: 404 };
    }
    if (item.quantity < delta) {
      return { error: `Stock insuficiente. Disponível: ${item.quantity}.`, status: 400 };
    }
    item.quantity -= delta;
  } else if (delta < 0) {
    if (!item) {
      item = {
        id: Number(requisicao.itemId),
        name: requisicao.itemName,
        quantity: 0,
        price: Number(requisicao.unitPrice) || 0,
        created_at: new Date().toISOString()
      };
      stockData.items.push(item);
    }
    item.quantity += Math.abs(delta);
  }

  if (newQty === 0) {
    obra.requisicoes.splice(reqIndex, 1);
  } else {
    const unitPrice = item ? Number(item.price) || Number(requisicao.unitPrice) || 0 : Number(requisicao.unitPrice) || 0;
    requisicao.quantity = newQty;
    requisicao.unitPrice = unitPrice;
    requisicao.total = newQty * unitPrice;
    if (item) {
      requisicao.itemName = item.name;
    }
    requisicao.updated_at = new Date().toISOString();
  }

  obra.updated_at = new Date().toISOString();
  writeData(stockData);
  writeObrasData(obrasData);

  return {
    obra,
    requisicao: newQty === 0 ? null : requisicao,
    item: item || null
  };
}

const messagesFile = path.join(__dirname, 'messages.json');

function ensureMessagesFile() {
  if (!fs.existsSync(messagesFile)) {
    fs.writeFileSync(messagesFile, JSON.stringify({ messages: [] }, null, 2), 'utf8');
  }
}

function readMessagesData() {
  ensureMessagesFile();
  const raw = fs.readFileSync(messagesFile, 'utf8');
  return JSON.parse(raw);
}

function writeMessagesData(data) {
  fs.writeFileSync(messagesFile, JSON.stringify(data, null, 2), 'utf8');
}

function getAllMessages() {
  return readMessagesData().messages;
}

function getMessageById(id) {
  return getAllMessages().find((message) => message.id === Number(id)) || null;
}

function addMessage({ userId, fullName, username, text, replyTo = null }) {
  const data = readMessagesData();
  const messages = data.messages;
  const newMessage = {
    id: getNextId(messages),
    userId: Number(userId),
    fullName: fullName || 'Utilizador',
    username: username || '',
    text: String(text).trim(),
    created_at: new Date().toISOString(),
    replyTo: replyTo || null,
    views: [],
    oks: []
  };
  messages.push(newMessage);
  writeMessagesData(data);
  return newMessage;
}

function markMessageViewed(id, viewer) {
  const data = readMessagesData();
  const message = data.messages.find((item) => item.id === Number(id));
  if (!message) return { error: 'Mensagem não encontrada.', status: 404 };

  if (!Array.isArray(message.views)) message.views = [];
  if (!Array.isArray(message.oks)) message.oks = [];

  const already = message.views.find((view) => Number(view.userId) === Number(viewer.userId));
  if (!already) {
    message.views.push({
      userId: Number(viewer.userId),
      fullName: viewer.fullName || 'Utilizador',
      username: viewer.username || '',
      viewedAt: new Date().toISOString()
    });
    writeMessagesData(data);
  }

  return message;
}

function markMessageOk(id, viewer) {
  const data = readMessagesData();
  const message = data.messages.find((item) => item.id === Number(id));
  if (!message) return { error: 'Mensagem não encontrada.', status: 404 };

  if (!Array.isArray(message.views)) message.views = [];
  if (!Array.isArray(message.oks)) message.oks = [];

  const alreadyViewed = message.views.find((view) => Number(view.userId) === Number(viewer.userId));
  if (!alreadyViewed) {
    message.views.push({
      userId: Number(viewer.userId),
      fullName: viewer.fullName || 'Utilizador',
      username: viewer.username || '',
      viewedAt: new Date().toISOString()
    });
  }

  const alreadyOk = message.oks.find((ok) => Number(ok.userId) === Number(viewer.userId));
  if (!alreadyOk) {
    message.oks.push({
      userId: Number(viewer.userId),
      fullName: viewer.fullName || 'Utilizador',
      username: viewer.username || '',
      okAt: new Date().toISOString()
    });
  }

  writeMessagesData(data);
  return message;
}

function deleteMessage(id) {
  const data = readMessagesData();
  const index = data.messages.findIndex((item) => item.id === Number(id));
  if (index === -1) return { error: 'Mensagem não encontrada.', status: 404 };
  const [removed] = data.messages.splice(index, 1);
  writeMessagesData(data);
  return removed;
}

module.exports = {
  getAllItems,
  getItem,
  addItem,
  updateItem,
  deleteItem,
  clearAllItems,
  findItemByBarcode,
  getSummary,
  getAllUsers,
  getUserById,
  findUserByUsernameOrEmail,
  findUserByLogin,
  findUserByPhone,
  findUserByLoginQr,
  buildLoginQrPayload,
  addWebAuthnCredential,
  findUserByWebAuthnCredentialId,
  updateWebAuthnCredentialCounter,
  removeWebAuthnCredentials,
  hasWebAuthnCredentials,
  hasFaceDescriptor,
  isFaceIdEnabled,
  setFaceDescriptor,
  clearFaceDescriptor,
  findUserByFaceDescriptor,
  addUser,
  updateUser,
  updateUserPassword,
  deleteUser,
  getAllObras,
  addObra,
  updateObra,
  deleteObra,
  addRequisicao,
  updateRequisicao,
  getAllMessages,
  getMessageById,
  addMessage,
  markMessageViewed,
  markMessageOk,
  deleteMessage,
  getAllHistory,
  addHistoryEntry,
  clearHistory,
  getDiarioDay,
  setDiarioInitialValue,
  addDiarioMovement,
  deleteDiarioMovement,
  getAllCotacoes,
  getCotacaoById,
  addCotacao,
  updateCotacao,
  deleteCotacao,
  getAllFacturas,
  getFacturaById,
  addFactura,
  updateFactura,
  deleteFactura,
  getFacturaAttachmentPath,
  getAllCameras,
  getCameraById,
  addCamera,
  updateCamera,
  deleteCamera,
  getAllClientes,
  getClienteById,
  addCliente,
  updateCliente,
  deleteCliente,
  getAllFornecedores,
  getFornecedorById,
  addFornecedor,
  updateFornecedor,
  deleteFornecedor,
};
