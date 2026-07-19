const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const db = require('./db');

const reportsDir = path.join(__dirname, 'reports');
const reportsIndexFile = path.join(__dirname, 'reports.json');

const MONTH_NAMES_PT = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

function ensureReportsDir() {
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }
}

function ensureReportsIndex() {
  ensureReportsDir();
  if (!fs.existsSync(reportsIndexFile)) {
    fs.writeFileSync(reportsIndexFile, JSON.stringify({ reports: [] }, null, 2), 'utf8');
  }
}

function readReportsIndex() {
  ensureReportsIndex();
  return JSON.parse(fs.readFileSync(reportsIndexFile, 'utf8'));
}

function writeReportsIndex(data) {
  ensureReportsIndex();
  fs.writeFileSync(reportsIndexFile, JSON.stringify(data, null, 2), 'utf8');
}

function reportId(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function getReportMeta(year, month) {
  const id = reportId(year, month);
  return readReportsIndex().reports.find((entry) => entry.id === id) || null;
}

function listReports() {
  return readReportsIndex().reports
    .slice()
    .sort((a, b) => b.id.localeCompare(a.id));
}

function money(value) {
  return `${Number(value || 0).toFixed(2)} MT`;
}

function inMonth(isoDate, year, month) {
  if (!isoDate) return false;
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    const fallback = new Date(`${isoDate}T00:00:00`);
    if (Number.isNaN(fallback.getTime())) return false;
    return fallback.getFullYear() === year && fallback.getMonth() + 1 === month;
  }
  return date.getFullYear() === year && date.getMonth() + 1 === month;
}

function collectReportData(year, month) {
  const items = db.getAllItems().slice().sort((a, b) => a.id - b.id);
  const summary = db.getSummary();
  const obras = db.getAllObras()
    .filter((obra) => inMonth(obra.entryDate || obra.created_at, year, month))
    .sort((a, b) => a.id - b.id);
  const users = db.getAllUsers();
  const messages = typeof db.getAllMessages === 'function'
    ? db.getAllMessages().filter((message) => inMonth(message.created_at, year, month))
    : [];

  const obrasRequisicoesTotal = obras.reduce((sum, obra) => {
    const reqs = Array.isArray(obra.requisicoes) ? obra.requisicoes : [];
    return sum + reqs.reduce((inner, req) => {
      return inner + Number(req.quantity || 0) * Number(req.unitPrice || req.price || 0);
    }, 0);
  }, 0);

  return {
    year,
    month,
    monthName: MONTH_NAMES_PT[month - 1] || String(month),
    generatedAt: new Date().toISOString(),
    summary,
    items,
    obras,
    obrasCount: obras.length,
    obrasRequisicoesTotal,
    usersCount: users.length,
    messagesCount: messages.length
  };
}

function drawSectionTitle(doc, text) {
  doc.moveDown(0.8);
  doc.fontSize(13).fillColor('#0f2744').text(text, { underline: true });
  doc.moveDown(0.35);
  doc.fontSize(10).fillColor('#111827');
}

function generateMonthlyPdf(year, month, options = {}) {
  const force = Boolean(options.force);
  const y = Number(year);
  const m = Number(month);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) {
    return { error: 'Mês inválido.', status: 400 };
  }

  ensureReportsDir();
  const id = reportId(y, m);
  const existing = getReportMeta(y, m);
  const fileName = `relatorio-${id}.pdf`;
  const filePath = path.join(reportsDir, fileName);

  if (existing && fs.existsSync(filePath) && !force) {
    return existing;
  }

  const data = collectReportData(y, m);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 42, size: 'A4' });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    doc.fontSize(18).fillColor('#0f2744').text('Isoft — Relatório Mensal', { align: 'left' });
    doc.moveDown(0.3);
    doc.fontSize(12).fillColor('#334155').text(`${data.monthName} de ${y}`);
    doc.fontSize(9).fillColor('#64748b').text(
      `Gerado automaticamente em ${new Date(data.generatedAt).toLocaleString('pt-PT')}`
    );

    drawSectionTitle(doc, '1. Resumo financeiro do stock');
    doc.text(`Total de produtos: ${data.summary.totalItems}`);
    doc.text(`Valor de compra: ${money(data.summary.purchaseTotal)}`);
    doc.text(`Valor de venda: ${money(data.summary.saleTotal || data.summary.totalValue)}`);
    doc.text(`Lucro estimado: ${money(data.summary.profitTotal)}`);
    doc.text(`Utilizadores registados: ${data.usersCount}`);
    doc.text(`Mensagens de chat no mês: ${data.messagesCount}`);

    drawSectionTitle(doc, '2. Inventário detalhado');
    if (!data.items.length) {
      doc.text('Nenhum produto em stock.');
    } else {
      data.items.forEach((item) => {
        const qty = Number(item.quantity || 0);
        const cost = Number(item.cost || 0);
        const price = Number(item.price || 0);
        const purchaseValue = qty * cost;
        const profit = price - cost;
        doc.fontSize(10).fillColor('#111827').text(
          `#${item.id} ${item.name} | Cód: ${item.barcode || '—'} | Qtd: ${qty}`
        );
        doc.fontSize(9).fillColor('#475569').text(
          `Compra: ${money(cost)} | Valor compra: ${money(purchaseValue)} | Venda: ${money(price)} | Lucro/un: ${money(profit)}`
        );
        doc.moveDown(0.25);
        if (doc.y > 760) doc.addPage();
      });
    }

    drawSectionTitle(doc, '3. Obras do mês');
    doc.text(`Total de obras no período: ${data.obrasCount}`);
    doc.text(`Valor de requisições (mês): ${money(data.obrasRequisicoesTotal)}`);
    doc.moveDown(0.3);

    if (!data.obras.length) {
      doc.text('Nenhuma obra registada neste mês.');
    } else {
      data.obras.forEach((obra) => {
        if (doc.y > 740) doc.addPage();
        const reqs = Array.isArray(obra.requisicoes) ? obra.requisicoes : [];
        doc.fontSize(10).fillColor('#111827').text(
          `Obra ${String(obra.id).padStart(6, '0')} — ${obra.client || obra.name || 'Sem cliente'}`
        );
        doc.fontSize(9).fillColor('#475569').text(
          `Veículo: ${obra.brand || '—'} ${obra.model || ''} | Matrícula: ${obra.plate || '—'} | Entrada: ${obra.entryDate || '—'}`
        );
        doc.text(`Contacto: ${obra.phone || '—'} | Serviço: ${obra.serviceDescription || '—'}`);
        if (reqs.length) {
          reqs.forEach((req) => {
            doc.text(
              `  · ${req.itemName || 'Item'} × ${req.quantity} = ${money(Number(req.quantity || 0) * Number(req.unitPrice || req.price || 0))}`
            );
          });
        } else {
          doc.text('  · Sem requisições.');
        }
        doc.moveDown(0.35);
      });
    }

    drawSectionTitle(doc, '4. Notas');
    doc.fontSize(9).fillColor('#475569').text(
      'Este relatório é gerado automaticamente no fecho de cada mês. Os valores de lucro são estimados com base no preço de compra e de venda registados no stock.'
    );

    doc.end();

    stream.on('finish', () => {
      const meta = {
        id,
        year: y,
        month: m,
        monthName: data.monthName,
        fileName,
        created_at: data.generatedAt,
        purchaseTotal: data.summary.purchaseTotal,
        saleTotal: data.summary.saleTotal || data.summary.totalValue,
        profitTotal: data.summary.profitTotal,
        itemsCount: data.items.length,
        obrasCount: data.obrasCount
      };

      const index = readReportsIndex();
      const idx = index.reports.findIndex((entry) => entry.id === id);
      if (idx >= 0) index.reports[idx] = meta;
      else index.reports.push(meta);
      writeReportsIndex(index);
      resolve(meta);
    });

    stream.on('error', reject);
  });
}

function getReportFilePath(year, month) {
  const meta = getReportMeta(year, month);
  if (!meta) return null;
  const filePath = path.join(reportsDir, meta.fileName);
  if (!fs.existsSync(filePath)) return null;
  return { meta, filePath };
}

async function ensureClosedMonthReport() {
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const year = prev.getFullYear();
  const month = prev.getMonth() + 1;
  try {
    return await generateMonthlyPdf(year, month, { force: false });
  } catch (error) {
    console.error('Falha ao gerar relatório mensal automático:', error);
    return null;
  }
}

function startMonthlyReportScheduler() {
  ensureClosedMonthReport();
  const SIX_HOURS = 6 * 60 * 60 * 1000;
  setInterval(() => {
    ensureClosedMonthReport();
  }, SIX_HOURS);
}

function generateStockEntryPdf(item, options = {}) {
  return new Promise((resolve, reject) => {
    if (!item || !item.id) {
      reject(new Error('Produto inválido.'));
      return;
    }

    ensureReportsDir();
    const entriesDir = path.join(reportsDir, 'entries');
    if (!fs.existsSync(entriesDir)) {
      fs.mkdirSync(entriesDir, { recursive: true });
    }

    const qty = Number(item.quantity || 0);
    const cost = Number(item.cost || 0);
    const price = Number(item.price || 0);
    const purchaseValue = qty * cost;
    const saleValue = qty * price;
    const createdAt = item.created_at || new Date().toISOString();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `entrada-${item.id}-${stamp}.pdf`;
    const filePath = path.join(entriesDir, fileName);

    const doc = new PDFDocument({ margin: 48, size: 'A4' });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    doc.fontSize(18).fillColor('#0f2744').text('Isoft — Relatório de Entrada de Material');
    doc.moveDown(0.35);
    doc.fontSize(10).fillColor('#64748b').text(
      `Gerado em ${new Date().toLocaleString('pt-PT')}`
    );
    if (options.userName) {
      doc.text(`Registado por: ${options.userName}`);
    }

    doc.moveDown(1);
    doc.fontSize(13).fillColor('#0f2744').text('Detalhes do material', { underline: true });
    doc.moveDown(0.4);
    doc.fontSize(11).fillColor('#111827');
    doc.text(`ID: ${item.id}`);
    doc.text(`Nome: ${item.name || '—'}`);
    doc.text(`Código de barras: ${item.barcode || '—'}`);
    doc.text(`Fornecedor: ${item.supplierName || '—'}`);
    doc.text(`Quantidade: ${qty}`);
    doc.text(`Preço de compra (un.): ${money(cost)}`);
    doc.text(`Valor de compra: ${money(purchaseValue)}`);
    doc.text(`Preço de venda (un.): ${money(price)}`);
    doc.text(`Valor de venda: ${money(saleValue)}`);
    doc.text(`Data de registo: ${new Date(createdAt).toLocaleString('pt-PT')}`);

    doc.moveDown(1.2);
    doc.fontSize(9).fillColor('#475569').text(
      'Este documento confirma a entrada do material no armazém. Conserve-o para controlo de stock e auditoria.'
    );

    doc.end();

    stream.on('finish', () => {
      resolve({
        fileName,
        filePath,
        itemId: item.id,
        purchaseValue,
        saleValue
      });
    });
    stream.on('error', reject);
  });
}

function startOfLocalDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfLocalDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function startOfLocalWeek(date) {
  const d = startOfLocalDay(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function endOfLocalWeek(date) {
  const d = startOfLocalWeek(date);
  d.setDate(d.getDate() + 6);
  return endOfLocalDay(d);
}

function startOfLocalMonth(date) {
  const d = startOfLocalDay(date);
  d.setDate(1);
  return d;
}

function endOfLocalMonth(date) {
  const d = startOfLocalMonth(date);
  d.setMonth(d.getMonth() + 1);
  d.setDate(0);
  return endOfLocalDay(d);
}

function startOfLocalYear(date) {
  const d = startOfLocalDay(date);
  d.setMonth(0, 1);
  return d;
}

function endOfLocalYear(date) {
  const d = startOfLocalDay(date);
  d.setMonth(11, 31);
  return endOfLocalDay(d);
}

function resolveStockExtractRange(period, anchorIso, options = {}) {
  const fromIso = String(options.from || '').trim().slice(0, 10);
  const toIso = String(options.to || '').trim().slice(0, 10);
  if (fromIso || toIso || String(period || '').toLowerCase() === 'custom') {
    const startRaw = fromIso || toIso || new Date().toISOString().slice(0, 10);
    const endRaw = toIso || fromIso || startRaw;
    const start = startOfLocalDay(new Date(`${startRaw}T12:00:00`));
    const end = endOfLocalDay(new Date(`${endRaw}T12:00:00`));
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return { error: 'Intervalo de datas inválido.' };
    }
    if (start.getTime() > end.getTime()) {
      return { error: 'A data inicial não pode ser posterior à data final.' };
    }
    return { period: 'custom', start, end };
  }

  const anchor = anchorIso ? new Date(`${String(anchorIso).slice(0, 10)}T12:00:00`) : new Date();
  if (Number.isNaN(anchor.getTime())) {
    return { error: 'Data âncora inválida.' };
  }
  const value = String(period || 'daily').toLowerCase();
  if (value === 'weekly') {
    return { period: 'weekly', start: startOfLocalWeek(anchor), end: endOfLocalWeek(anchor) };
  }
  if (value === 'monthly') {
    return { period: 'monthly', start: startOfLocalMonth(anchor), end: endOfLocalMonth(anchor) };
  }
  if (value === 'yearly') {
    return { period: 'yearly', start: startOfLocalYear(anchor), end: endOfLocalYear(anchor) };
  }
  return { period: 'daily', start: startOfLocalDay(anchor), end: endOfLocalDay(anchor) };
}

function formatStockExtractPeriodLabel(period, start, end) {
  if (period === 'daily') {
    return start.toLocaleDateString('pt-PT', {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      year: 'numeric'
    });
  }
  if (period === 'weekly' || period === 'custom') {
    return `${start.toLocaleDateString('pt-PT')} – ${end.toLocaleDateString('pt-PT')}`;
  }
  if (period === 'monthly') {
    return start.toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' });
  }
  return String(start.getFullYear());
}

function matchesSupplierFilter(entryOrItem, supplierId, supplierName) {
  const id = supplierId == null || supplierId === '' ? null : Number(supplierId);
  const name = String(supplierName || '').trim().toLowerCase();
  if (!Number.isFinite(id) && !name) return true;

  const meta = entryOrItem?.meta || {};
  const entrySupplierId = Number(
    entryOrItem.supplierId ?? meta.supplierId ?? entryOrItem.fornecedorId ?? meta.fornecedorId
  );
  const entrySupplierName = String(
    entryOrItem.supplierName || meta.supplierName || entryOrItem.fornecedor || meta.fornecedor || ''
  )
    .trim()
    .toLowerCase();

  if (Number.isFinite(id) && id > 0) {
    if (Number.isFinite(entrySupplierId) && entrySupplierId === id) return true;
    // histórico antigo sem id: tentar pelo nome
    if (name && entrySupplierName && entrySupplierName === name) return true;
    return false;
  }
  if (name) {
    return entrySupplierName === name || entrySupplierName.includes(name);
  }
  return true;
}

function collectStockExtractData(period, anchorIso, options = {}) {
  const range = resolveStockExtractRange(period, anchorIso, options);
  if (range.error) return range;

  const supplierId = options.supplierId;
  const supplierName = String(options.supplierName || '').trim();
  let resolvedSupplierName = supplierName;
  if ((!resolvedSupplierName || !resolvedSupplierName.length) && supplierId != null && supplierId !== '') {
    const fornecedores = typeof db.getAllFornecedores === 'function' ? db.getAllFornecedores() : [];
    const found = fornecedores.find((f) => Number(f.id) === Number(supplierId));
    if (found) resolvedSupplierName = found.name || '';
  }

  const startMs = range.start.getTime();
  const endMs = range.end.getTime();
  const inRange = (iso) => {
    const time = new Date(iso).getTime();
    return Number.isFinite(time) && time >= startMs && time <= endMs;
  };

  const historyEntries = (typeof db.getAllHistory === 'function' ? db.getAllHistory() : [])
    .filter(
      (entry) =>
        entry &&
        entry.type === 'armazem' &&
        inRange(entry.created_at) &&
        matchesSupplierFilter(entry, supplierId, resolvedSupplierName)
    )
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  const items = (typeof db.getAllItems === 'function' ? db.getAllItems() : [])
    .filter(
      (item) =>
        item &&
        inRange(item.created_at || item.updated_at) &&
        matchesSupplierFilter(item, supplierId, resolvedSupplierName)
    )
    .sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime());

  const entradas = historyEntries.filter((entry) => entry.action === 'entrada');
  const atualizacoes = historyEntries.filter((entry) => entry.action === 'atualizacao');
  const totalQty = historyEntries.reduce(
    (sum, entry) => sum + (Number(entry.meta?.quantity) || 0),
    0
  );
  const purchaseTotal = items.reduce(
    (sum, item) => sum + Number(item.quantity || 0) * Number(item.cost || 0),
    0
  );
  const saleTotal = items.reduce(
    (sum, item) => sum + Number(item.quantity || 0) * Number(item.price || 0),
    0
  );

  return {
    period: range.period,
    start: range.start.toISOString(),
    end: range.end.toISOString(),
    label: formatStockExtractPeriodLabel(range.period, range.start, range.end),
    supplierId: Number.isFinite(Number(supplierId)) && Number(supplierId) > 0 ? Number(supplierId) : null,
    supplierName: resolvedSupplierName || '',
    historyEntries,
    items,
    totals: {
      movements: historyEntries.length,
      entradas: entradas.length,
      atualizacoes: atualizacoes.length,
      totalQty,
      itemsRegistered: items.length,
      purchaseTotal,
      saleTotal
    }
  };
}

function generateStockPeriodExtractPdf(extract, options = {}) {
  return new Promise((resolve, reject) => {
    if (!extract || extract.error) {
      reject(new Error(extract?.error || 'Extrato inválido.'));
      return;
    }

    ensureReportsDir();
    const extractDir = path.join(reportsDir, 'extracts');
    if (!fs.existsSync(extractDir)) {
      fs.mkdirSync(extractDir, { recursive: true });
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const supplierSlug = extract.supplierName
      ? `-${String(extract.supplierName).toLowerCase().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')}`
      : '';
    const fileName = `extrato-armazem-${extract.period}${supplierSlug}-${stamp}.pdf`;
    const filePath = path.join(extractDir, fileName);
    const movements = Array.isArray(extract.historyEntries) ? extract.historyEntries : [];
    const items = Array.isArray(extract.items) ? extract.items : [];
    const totals = extract.totals || {};

    const doc = new PDFDocument({ margin: 42, size: 'A4' });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    const periodTitle = {
      daily: 'Diário',
      weekly: 'Semanal',
      monthly: 'Mensal',
      yearly: 'Anual',
      custom: 'Intervalo'
    }[extract.period] || 'Período';

    doc.fontSize(18).fillColor('#0f2744').text('Isoft — Extrato de Entradas de Material');
    doc.moveDown(0.3);
    doc.fontSize(12).fillColor('#334155').text(`${periodTitle}: ${extract.label}`);
    if (extract.supplierName) {
      doc.fontSize(11).fillColor('#0f2744').text(`Fornecedor: ${extract.supplierName}`);
    } else {
      doc.fontSize(11).fillColor('#64748b').text('Fornecedor: todos');
    }
    doc.fontSize(9).fillColor('#64748b').text(
      `Gerado em ${new Date().toLocaleString('pt-PT')}`
    );
    if (options.userName) {
      doc.text(`Emitido por: ${options.userName}`);
    }

    drawSectionTitle(doc, 'Resumo do período');
    doc.fontSize(11).fillColor('#111827');
    doc.text(`Movimentos de armazém: ${totals.movements || 0}`);
    doc.text(`Entradas: ${totals.entradas || 0}`);
    doc.text(`Atualizações: ${totals.atualizacoes || 0}`);
    doc.text(`Quantidade total (meta): ${totals.totalQty || 0}`);
    doc.text(`Produtos registados no período: ${totals.itemsRegistered || 0}`);
    doc.text(`Valor de compra (produtos do período): ${money(totals.purchaseTotal)}`);
    doc.text(`Valor de venda (produtos do período): ${money(totals.saleTotal)}`);

    drawSectionTitle(doc, 'Movimentos do armazém');
    if (!movements.length) {
      doc.fontSize(10).fillColor('#64748b').text('Sem movimentos de armazém neste período.');
    } else {
      const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const cols = { when: 95, action: 70, qty: 45, user: 85 };
      cols.summary = pageWidth - cols.when - cols.action - cols.qty - cols.user;

      const actionLabel = (action) => {
        if (action === 'entrada') return 'Entrada';
        if (action === 'atualizacao') return 'Atualização';
        if (action === 'exclusao') return 'Exclusão';
        return action || 'Evento';
      };

      const drawHeader = () => {
        const y = doc.y;
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#0f2744');
        doc.text('Data/hora', doc.page.margins.left, y, { width: cols.when });
        doc.text('Ação', doc.page.margins.left + cols.when, y, { width: cols.action });
        doc.text('Qtd', doc.page.margins.left + cols.when + cols.action, y, { width: cols.qty });
        doc.text('Descrição', doc.page.margins.left + cols.when + cols.action + cols.qty, y, {
          width: cols.summary
        });
        doc.text(
          'Utilizador',
          doc.page.margins.left + cols.when + cols.action + cols.qty + cols.summary,
          y,
          { width: cols.user }
        );
        doc.moveDown(0.35);
        doc
          .moveTo(doc.page.margins.left, doc.y)
          .lineTo(doc.page.width - doc.page.margins.right, doc.y)
          .strokeColor('#cbd5e1')
          .stroke();
        doc.moveDown(0.25);
        doc.font('Helvetica').fontSize(8).fillColor('#111827');
      };

      drawHeader();
      movements.forEach((entry) => {
        if (doc.y > doc.page.height - 70) {
          doc.addPage();
          drawHeader();
        }
        const when = entry.created_at
          ? new Date(entry.created_at).toLocaleString('pt-PT', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            })
          : '—';
        const summary = String(entry.summary || '—');
        const userName = String(entry.userName || '—');
        const qty = entry.meta?.quantity != null ? String(entry.meta.quantity) : '—';
        const y = doc.y;
        const summaryHeight = doc.heightOfString(summary, { width: cols.summary });
        const rowHeight = Math.max(14, summaryHeight);

        doc.text(when, doc.page.margins.left, y, { width: cols.when });
        doc.text(actionLabel(entry.action), doc.page.margins.left + cols.when, y, {
          width: cols.action
        });
        doc.text(qty, doc.page.margins.left + cols.when + cols.action, y, { width: cols.qty });
        doc.text(summary, doc.page.margins.left + cols.when + cols.action + cols.qty, y, {
          width: cols.summary
        });
        doc.text(
          userName,
          doc.page.margins.left + cols.when + cols.action + cols.qty + cols.summary,
          y,
          { width: cols.user }
        );
        doc.y = y + rowHeight + 4;
      });
    }

    drawSectionTitle(doc, 'Produtos registados no período');
    if (!items.length) {
      doc.fontSize(10).fillColor('#64748b').text('Nenhum produto com data de registo neste período.');
    } else {
      items.forEach((item) => {
        if (doc.y > doc.page.height - 80) doc.addPage();
        const qty = Number(item.quantity || 0);
        const cost = Number(item.cost || 0);
        doc.fontSize(10).fillColor('#111827');
        doc.text(
          `#${item.id} · ${item.name || '—'} · qtd ${qty} · compra ${money(cost)} · ` +
            `fornecedor ${item.supplierName || '—'} · ` +
            `${item.created_at ? new Date(item.created_at).toLocaleString('pt-PT') : '—'}`
        );
        doc.moveDown(0.2);
      });
    }

    doc.moveDown(1);
    doc.fontSize(9).fillColor('#475569').text(
      'Extrato de movimentos do armazém para o período selecionado. Conserve para controlo e auditoria.'
    );

    doc.end();
    stream.on('finish', () => {
      resolve({
        fileName,
        filePath,
        period: extract.period,
        label: extract.label,
        supplierName: extract.supplierName || '',
        totals
      });
    });
    stream.on('error', reject);
  });
}

function formatDiarioDateLabel(dateKey) {
  const d = new Date(`${dateKey}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dateKey;
  return d.toLocaleDateString('pt-PT', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  });
}

function generateDiarioDayPdf(day, options = {}) {
  return new Promise((resolve, reject) => {
    if (!day || !day.date) {
      reject(new Error('Dia do diário inválido.'));
      return;
    }

    ensureReportsDir();
    const diarioDir = path.join(reportsDir, 'diario');
    if (!fs.existsSync(diarioDir)) {
      fs.mkdirSync(diarioDir, { recursive: true });
    }

    const totals = day.totals || {
      initialValue: Number(day.initialValue) || 0,
      entradas: 0,
      saidas: 0,
      balance: Number(day.initialValue) || 0,
      count: 0
    };
    const movements = Array.isArray(day.movements)
      ? day.movements
          .slice()
          .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))
      : [];

    const fileName = `diario-${day.date}.pdf`;
    const filePath = path.join(diarioDir, fileName);

    const doc = new PDFDocument({ margin: 42, size: 'A4' });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    doc.fontSize(18).fillColor('#0f2744').text('Isoft — Relatório do Diário');
    doc.moveDown(0.3);
    doc.fontSize(12).fillColor('#334155').text(formatDiarioDateLabel(day.date));
    doc.fontSize(9).fillColor('#64748b').text(
      `Gerado em ${new Date().toLocaleString('pt-PT')}`
    );
    if (options.userName) {
      doc.text(`Emitido por: ${options.userName}`);
    }

    drawSectionTitle(doc, 'Resumo do dia');
    doc.fontSize(11).fillColor('#111827');
    doc.text(`Valor inicial: ${money(totals.initialValue)}`);
    doc.text(`Entradas: ${money(totals.entradas)}`);
    doc.text(`Saídas: ${money(totals.saidas)}`);
    doc.font('Helvetica-Bold').text(`Saldo: ${money(totals.balance)}`);
    doc.font('Helvetica');
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor('#64748b').text(
      `${movements.length} movimento${movements.length === 1 ? '' : 's'} registado${movements.length === 1 ? '' : 's'}`
    );

    drawSectionTitle(doc, 'Movimentos');
    if (!movements.length) {
      doc.fontSize(10).fillColor('#64748b').text('Sem movimentos neste dia.');
    } else {
      const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const cols = {
        time: 55,
        type: 60,
        amount: 80,
        user: 90
      };
      cols.desc = pageWidth - cols.time - cols.type - cols.amount - cols.user;

      const drawHeader = () => {
        const y = doc.y;
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#0f2744');
        doc.text('Hora', doc.page.margins.left, y, { width: cols.time });
        doc.text('Tipo', doc.page.margins.left + cols.time, y, { width: cols.type });
        doc.text('Valor', doc.page.margins.left + cols.time + cols.type, y, { width: cols.amount });
        doc.text('Descrição', doc.page.margins.left + cols.time + cols.type + cols.amount, y, {
          width: cols.desc
        });
        doc.text(
          'Utilizador',
          doc.page.margins.left + cols.time + cols.type + cols.amount + cols.desc,
          y,
          { width: cols.user }
        );
        doc.moveDown(0.35);
        doc
          .moveTo(doc.page.margins.left, doc.y)
          .lineTo(doc.page.width - doc.page.margins.right, doc.y)
          .strokeColor('#cbd5e1')
          .stroke();
        doc.moveDown(0.25);
        doc.font('Helvetica').fontSize(9).fillColor('#111827');
      };

      drawHeader();

      movements.forEach((item) => {
        if (doc.y > doc.page.height - 70) {
          doc.addPage();
          drawHeader();
        }

        const time = item.created_at
          ? new Date(item.created_at).toLocaleTimeString('pt-PT', {
              hour: '2-digit',
              minute: '2-digit'
            })
          : '—';
        const typeLabel = item.type === 'entrada' ? 'Entrada' : 'Saída';
        const amountLabel = money(item.amount);
        const description = String(item.description || '—');
        const userName = String(item.userName || '—');
        const y = doc.y;
        const descHeight = doc.heightOfString(description, { width: cols.desc });
        const userHeight = doc.heightOfString(userName, { width: cols.user });
        const rowHeight = Math.max(14, descHeight, userHeight);

        doc.fillColor('#111827').text(time, doc.page.margins.left, y, {
          width: cols.time,
          lineBreak: false
        });
        doc.fillColor(item.type === 'entrada' ? '#166534' : '#991b1b').text(
          typeLabel,
          doc.page.margins.left + cols.time,
          y,
          { width: cols.type, lineBreak: false }
        );
        doc.fillColor(item.type === 'entrada' ? '#166534' : '#991b1b').text(
          amountLabel,
          doc.page.margins.left + cols.time + cols.type,
          y,
          { width: cols.amount, lineBreak: false }
        );
        doc.fillColor('#111827').text(
          description,
          doc.page.margins.left + cols.time + cols.type + cols.amount,
          y,
          { width: cols.desc }
        );
        doc.text(
          userName,
          doc.page.margins.left + cols.time + cols.type + cols.amount + cols.desc,
          y,
          { width: cols.user }
        );
        doc.y = y + rowHeight + 6;
      });
    }

    doc.moveDown(1);
    doc.fontSize(9).fillColor('#475569').text(
      'Documento gerado a partir dos movimentos do diário de caixa. Conserve para controlo e auditoria.'
    );

    doc.end();

    stream.on('finish', () => {
      resolve({
        fileName,
        filePath,
        date: day.date,
        totals
      });
    });
    stream.on('error', reject);
  });
}

function cotacaoStatusLabel(status) {
  const map = {
    rascunho: 'Rascunho',
    enviada: 'Enviada',
    aceite: 'Aceite',
    rejeitada: 'Rejeitada'
  };
  return map[status] || status || '—';
}

const COTACAO_COMPANY = {
  name: 'Auto Meneses & Irmãos, Lda.',
  workshops: 'Oficinas: Auto Meneses & Irmãos, Lda.',
  email: 'email. automeneses14@gmail.com',
  nuit: 'Nuit 400466289',
  phones: 'Cells: 842018288, 843615730',
  city: 'Cidade: Nampula',
  accountsTitle: 'Numeros de conta',
  accounts: [
    'BIM 396218326 NIB 000100000039621832657',
    'BCI 7786209510001 NIB 000800007786209510180'
  ],
  logoPath: (() => {
    const jpg = path.join(__dirname, 'assets', 'auto-meneses-logo.jpg');
    const jpeg = path.join(__dirname, 'assets', 'auto-meneses-logo.jpeg');
    if (fs.existsSync(jpg)) return jpg;
    if (fs.existsSync(jpeg)) return jpeg;
    return jpg;
  })()
};

function formatCotacaoDocNumber(cotacao) {
  const raw = String(cotacao?.number || '').replace(/\D/g, '');
  if (raw) return raw.padStart(6, '0').slice(-6);
  const id = Number(cotacao?.id);
  if (Number.isFinite(id) && id > 0) return String(Math.trunc(id)).padStart(6, '0');
  return '000000';
}

function formatCotacaoDatePt(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    return new Date().toLocaleDateString('pt-PT', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
  }
  return date.toLocaleDateString('pt-PT', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
}

function moneyPlain(value) {
  return Number(value || 0).toFixed(2);
}

function generateCotacaoPdf(cotacao, options = {}) {
  return new Promise((resolve, reject) => {
    if (!cotacao || !cotacao.id) {
      reject(new Error('Cotação inválida.'));
      return;
    }

    ensureReportsDir();
    const docTitle = String(options.docTitle || 'Factura pro forma').trim() || 'Factura pro forma';
    const reportsSubdir = options.reportsSubdir || 'cotacoes';
    const filePrefix = options.filePrefix || 'cotacao';
    const cotacoesDir = path.join(reportsDir, reportsSubdir);
    if (!fs.existsSync(cotacoesDir)) {
      fs.mkdirSync(cotacoesDir, { recursive: true });
    }

    const items = Array.isArray(cotacao.items) ? cotacao.items : [];
    const totals = cotacao.totals || {
      subtotal: 0,
      discount: 0,
      iva: 0,
      total: 0,
      ivaRate: 0.16
    };
    const fileName = `${filePrefix}-${cotacao.number || cotacao.id}.pdf`;
    const filePath = path.join(cotacoesDir, fileName);
    const docNumber = formatCotacaoDocNumber(cotacao);
    const issueDate = formatCotacaoDatePt(
      cotacao.issueDate || cotacao.created_at || Date.now()
    );

    const doc = new PDFDocument({
      margin: 36,
      size: 'A4',
      info: {
        Title: `${docTitle} Nº ${docNumber}`,
        Author: COTACAO_COMPANY.name
      }
    });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const width = right - left;
    const black = '#111111';
    const red = '#cc0000';

    // Cabeçalho: logotipo à esquerda, título ao centro, número à direita
    const headerTop = 28;
    const logoW = 110;
    const logoH = 58;
    let headerBottom = headerTop + 24;

    if (fs.existsSync(COTACAO_COMPANY.logoPath)) {
      try {
        doc.image(COTACAO_COMPANY.logoPath, left, headerTop, {
          fit: [logoW, logoH],
          align: 'left'
        });
        headerBottom = headerTop + logoH;
      } catch {
        /* sem logo */
      }
    }

    const titleY = headerTop + Math.max(0, (logoH - 22) / 2);
    doc.font('Times-Bold').fontSize(18).fillColor(black)
      .text(docTitle, left, titleY, {
        width,
        align: 'center',
        lineBreak: false
      });
    doc.font('Times-BoldItalic').fontSize(14).fillColor(red)
      .text(`Nº  ${docNumber}`, left, titleY + 2, {
        width,
        align: 'right',
        lineBreak: false
      });
    doc.fillColor(black);
    doc.y = headerBottom + 14;
    doc.moveDown(0.2);

    // Company block (two columns)
    const companyTop = doc.y;
    doc.font('Times-Bold').fontSize(12).text(COTACAO_COMPANY.name, left, companyTop, {
      width: width * 0.55
    });
    doc.font('Times-Roman').fontSize(10);
    doc.text(COTACAO_COMPANY.workshops, left, doc.y, { width: width * 0.55 });
    doc.text(COTACAO_COMPANY.email, left, doc.y, { width: width * 0.55 });
    doc.text(COTACAO_COMPANY.phones, left, doc.y, { width: width * 0.55 });

    const metaX = left + width * 0.72;
    const metaW = width * 0.28;
    doc.font('Times-Roman').fontSize(10);
    doc.text(`Data ${issueDate}`, metaX, companyTop, {
      width: metaW,
      align: 'right'
    });
    doc.text(COTACAO_COMPANY.nuit, metaX, companyTop + 14, {
      width: metaW,
      align: 'right'
    });
    doc.text(COTACAO_COMPANY.city, metaX, companyTop + 28, {
      width: metaW,
      align: 'right'
    });

    doc.y = Math.max(doc.y, companyTop + 58);
    doc.moveDown(0.7);

    // Client / vehicle fields
    const brandLabel = [cotacao.brand, cotacao.model].filter(Boolean).join(' ');
    const clientLines = [
      ['Cliente:', cotacao.client || '—'],
      ['Cell:', cotacao.phone || '—'],
      ['NUIT :', cotacao.nuit || '—'],
      ['Morada:', cotacao.address || '—'],
      ['Matricula:', cotacao.plate || '—'],
      ['Km:', Number(cotacao.mileage) > 0 ? String(cotacao.mileage) : '—'],
      ['Marca:', brandLabel || '—']
    ];

    clientLines.forEach(([label, value]) => {
      const y = doc.y;
      doc.font('Times-Bold').fontSize(11).fillColor(black).text(label, left, y, {
        width: 78,
        continued: false
      });
      doc.font('Times-Roman').fontSize(11).text(String(value), left + 82, y, {
        width: width - 82
      });
      doc.y = Math.max(doc.y, y + 16);
    });

    doc.moveDown(0.45);

    // Items table (sem bordas/linhas)
    const cols = {
      qty: 70,
      desc: width - 70 - 90 - 90,
      unit: 90,
      total: 90
    };
    const headers = [
      { key: 'qty', label: 'Quantidade', w: cols.qty },
      { key: 'desc', label: 'Descrição', w: cols.desc },
      { key: 'unit', label: 'Unitario', w: cols.unit },
      { key: 'total', label: 'Total', w: cols.total }
    ];

    const drawTableHeader = () => {
      const y = doc.y;
      let x = left;
      headers.forEach((col) => {
        doc.font('Times-Bold').fontSize(11).fillColor(black)
          .text(col.label, x + 4, y, { width: col.w - 8, align: 'center', lineBreak: false });
        x += col.w;
      });
      doc.y = y + 18;
    };

    const ensureSpace = (needed) => {
      if (doc.y + needed > doc.page.height - doc.page.margins.bottom - 20) {
        doc.addPage();
        drawTableHeader();
      }
    };

    drawTableHeader();

    const rows = items.length ? items : [];
    rows.forEach((item) => {
      const desc = String(item.description || '—');
      const qty = String(item.quantity || '');
      const unit = moneyPlain(item.unitPrice);
      const lineTotal = moneyPlain(Number(item.quantity || 0) * Number(item.unitPrice || 0));
      const descHeight = doc.heightOfString(desc, { width: cols.desc - 8 });
      const rowH = Math.max(18, descHeight + 6);
      ensureSpace(rowH + 4);
      const y = doc.y;
      let x = left;
      const values = [qty, desc, unit, lineTotal];
      headers.forEach((col, index) => {
        doc.font('Times-Roman').fontSize(10).fillColor(black)
          .text(values[index], x + 4, y, {
            width: col.w - 8,
            align: index === 1 ? 'left' : 'center'
          });
        x += col.w;
      });
      doc.y = y + rowH;
    });

    if (!rows.length) {
      doc.font('Times-Roman').fontSize(10).fillColor(black)
        .text('Sem itens.', left, doc.y, { width });
      doc.moveDown(0.4);
    }

    doc.moveDown(0.5);

    // Totals (sem caixas/linhas)
    const totalsBoxW = 210;
    const totalsX = right - totalsBoxW;
    const drawTotalRow = (label, value, bold = false) => {
      ensureSpace(18);
      const y = doc.y;
      doc.font(bold ? 'Times-Bold' : 'Times-Roman').fontSize(11).fillColor(black)
        .text(label, totalsX, y, { width: 110, lineBreak: false });
      doc.font(bold ? 'Times-Bold' : 'Times-Roman').fontSize(11)
        .text(moneyPlain(value), totalsX + 110, y, { width: 100, align: 'right', lineBreak: false });
      doc.y = y + 16;
    };

    drawTotalRow('Sub Total', totals.subtotal);
    drawTotalRow('Desconto', totals.discount || 0);
    drawTotalRow(`IVA (${Math.round((totals.ivaRate || 0.16) * 100)}%)`, totals.iva);
    drawTotalRow('Total', totals.total, true);

    if (cotacao.notes) {
      doc.moveDown(0.6);
      ensureSpace(40);
      doc.font('Times-Bold').fontSize(11).text('Observações', left);
      doc.font('Times-Roman').fontSize(10).text(String(cotacao.notes), left, doc.y, {
        width
      });
    }

    doc.moveDown(1);
    ensureSpace(90);
    doc.font('Times-Bold').fontSize(12).fillColor(black)
      .text(COTACAO_COMPANY.accountsTitle, left, doc.y, { width, align: 'center' });
    doc.moveDown(0.25);
    COTACAO_COMPANY.accounts.forEach((line) => {
      doc.font('Times-BoldItalic').fontSize(11).text(line, left, doc.y, {
        width,
        align: 'center'
      });
    });

    doc.moveDown(1.2);
    ensureSpace(50);
    doc.font('Times-Roman').fontSize(11)
      .text('Assinado e carimbado', left, doc.y, { width, align: 'center' });
    doc.moveDown(0.8);
    doc.text('_____________________________________________', left, doc.y, {
      width,
      align: 'center'
    });

    doc.end();

    stream.on('finish', () => {
      resolve({
        fileName,
        filePath,
        cotacaoId: cotacao.id,
        number: cotacao.number
      });
    });
    stream.on('error', reject);
  });
}

function generateFacturaPdf(factura, options = {}) {
  return generateCotacaoPdf(factura, {
    ...options,
    docTitle: 'Factura',
    reportsSubdir: 'facturas',
    filePrefix: 'factura'
  });
}

module.exports = {
  listReports,
  generateMonthlyPdf,
  getReportFilePath,
  ensureClosedMonthReport,
  startMonthlyReportScheduler,
  generateStockEntryPdf,
  collectStockExtractData,
  generateStockPeriodExtractPdf,
  generateDiarioDayPdf,
  generateCotacaoPdf,
  generateFacturaPdf,
  reportId
};
