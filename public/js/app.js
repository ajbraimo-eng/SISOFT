(function () {
  const {
    api,
    requireAuth,
    getUser,
    clearSession,
    setSession,
    money,
    formatDate,
    formatDay,
    escapeHtml,
    toast,
    qs,
    qsa
  } = Isoft;

  if (!requireAuth()) return;

  let user = getUser();
  let currentPage = 'inventario';
  let heartbeatTimer = null;
  let chatTimer = null;
  let state = {
    items: [],
    obras: [],
    cotacoes: [],
    facturas: [],
    clientes: [],
    fornecedores: [],
    users: [],
    history: [],
    cameras: [],
    messages: [],
    diario: null,
    summary: null,
    sessions: []
  };

  const PAGE_META = {
    inventario: { title: 'Inventário', sub: 'Resumo do stock e valores' },
    armazem: { title: 'Armazém', sub: 'Entradas e gestão de produtos' },
    obras: { title: 'Obras', sub: 'Ordens de serviço e requisições' },
    cotacao: { title: 'Cotações', sub: 'Orçamentos para clientes' },
    factura: { title: 'Facturas', sub: 'Facturação e anexos' },
    diario: { title: 'Diário de caixa', sub: 'Entradas e saídas do dia' },
    historico: { title: 'Histórico', sub: 'Atividade recente do sistema' },
    cameras: { title: 'Câmaras', sub: 'Streams e monitores' },
    chat: { title: 'Chat interno', sub: 'Mensagens da equipa' },
    cadastro: { title: 'Cadastro', sub: 'Utilizadores, clientes e fornecedores' }
  };

  const content = qs('#content');
  const modalRoot = qs('#modalRoot');
  const sidebar = qs('#sidebar');

  function isCeo() {
    return Boolean(user && (user.isCeo || Number(user.id) === 1));
  }

  function applyRoleVisibility() {
    qsa('.ceo-only').forEach((el) => {
      el.classList.toggle('hidden-role', !isCeo());
    });
  }

  function renderUser() {
    qs('#userName').textContent = user.fullName || user.username || 'Utilizador';
    qs('#userRole').textContent = user.role || (isCeo() ? 'CEO' : 'Utilizador');
    const avatar = qs('#userAvatar');
    if (user.photo) {
      avatar.innerHTML = `<img src="${escapeHtml(user.photo)}" alt="" />`;
    } else {
      const initial = String(user.fullName || user.username || 'I').trim().charAt(0).toUpperCase();
      avatar.textContent = initial;
    }
  }

  function openModal(html) {
    modalRoot.innerHTML = `<div class="modal-backdrop" id="modalBackdrop">${html}</div>`;
    qs('#modalBackdrop').addEventListener('click', (e) => {
      if (e.target.id === 'modalBackdrop') closeModal();
    });
  }

  function closeModal() {
    modalRoot.innerHTML = '';
  }

  function setTopbar(actionsHtml = '') {
    qs('#topbarActions').innerHTML = actionsHtml;
  }

  async function heartbeat() {
    try {
      await api('/heartbeat', {
        method: 'POST',
        body: { page: currentPage, deviceId: Isoft.getDeviceId(), deviceLabel: Isoft.getDeviceLabel() }
      });
    } catch {
      /* ignore */
    }
  }

  function startHeartbeat() {
    clearInterval(heartbeatTimer);
    heartbeat();
    heartbeatTimer = setInterval(heartbeat, 25000);
  }

  function stopChatPoll() {
    clearInterval(chatTimer);
    chatTimer = null;
  }

  async function navigate(page) {
    if (!PAGE_META[page]) page = 'inventario';
    if (page === 'armazem' || page === 'cadastro') {
      if (!isCeo()) {
        toast('Apenas o CEO pode aceder a esta área.', 'error');
        page = 'inventario';
      }
    }

    currentPage = page;
    stopChatPoll();
    if (location.hash.replace('#', '') !== page) {
      history.replaceState(null, '', `#${page}`);
    }
    qsa('.nav-item').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.page === page);
    });
    qs('#pageTitle').textContent = PAGE_META[page].title;
    qs('#pageSub').textContent = PAGE_META[page].sub;
    sidebar.classList.remove('open');
    content.innerHTML = `<div class="empty"><strong>A carregar…</strong></div>`;
    setTopbar('');
    await heartbeat();

    try {
      if (page === 'inventario') await renderInventario();
      else if (page === 'armazem') await renderArmazem();
      else if (page === 'obras') await renderObras();
      else if (page === 'cotacao') await renderCotacoes();
      else if (page === 'factura') await renderFacturas();
      else if (page === 'diario') await renderDiario();
      else if (page === 'historico') await renderHistorico();
      else if (page === 'cameras') await renderCameras();
      else if (page === 'chat') await renderChat();
      else if (page === 'cadastro') await renderCadastro();
    } catch (err) {
      content.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    }
  }

  /* ——— Inventário ——— */
  async function renderInventario() {
    const [summary, items] = await Promise.all([api('/summary'), api('/items')]);
    state.summary = summary;
    state.items = items;
    setTopbar(`<button class="btn btn-ghost btn-sm" id="refreshInv">Atualizar</button>`);
    qs('#refreshInv').onclick = () => navigate('inventario');

    content.innerHTML = `
      <div class="stats">
        <div class="stat"><div class="label">Produtos</div><div class="value accent">${summary.totalItems}</div></div>
        <div class="stat"><div class="label">Valor de venda</div><div class="value">${escapeHtml(money(summary.saleTotal))}</div></div>
        <div class="stat"><div class="label">Custo de compra</div><div class="value warn">${escapeHtml(money(summary.purchaseTotal))}</div></div>
        <div class="stat"><div class="label">Margem estimada</div><div class="value ok">${escapeHtml(money(summary.profitTotal))}</div></div>
      </div>
      <div class="toolbar">
        <input class="input search" id="invSearch" placeholder="Pesquisar produto…" />
      </div>
      <div class="table-wrap">
        <table class="data">
          <thead>
            <tr>
              <th>Produto</th>
              <th>Qtd</th>
              <th>Custo</th>
              <th>Venda</th>
              <th>Fornecedor</th>
            </tr>
          </thead>
          <tbody id="invBody"></tbody>
        </table>
      </div>`;

    const paint = (filter = '') => {
      const q = filter.trim().toLowerCase();
      const rows = items.filter((it) => !q || String(it.name).toLowerCase().includes(q));
      qs('#invBody').innerHTML = rows.length
        ? rows
            .map(
              (it) => `<tr>
            <td>${escapeHtml(it.name)}</td>
            <td>${Number(it.quantity) || 0}</td>
            <td class="money">${escapeHtml(money(it.cost))}</td>
            <td class="money">${escapeHtml(money(it.price))}</td>
            <td>${escapeHtml(it.supplierName || '—')}</td>
          </tr>`
            )
            .join('')
        : `<tr><td colspan="5"><div class="empty">Sem produtos.</div></td></tr>`;
    };
    paint();
    qs('#invSearch').oninput = (e) => paint(e.target.value);
  }

  /* ——— Armazém ——— */
  async function renderArmazem() {
    const [items, fornecedores] = await Promise.all([api('/items'), api('/fornecedores')]);
    state.items = items;
    state.fornecedores = fornecedores;

    setTopbar(`
      <button class="btn btn-primary btn-sm" id="addItemBtn">+ Entrada</button>
      <button class="btn btn-ghost btn-sm" id="extractBtn">Extrato PDF</button>
    `);

    qs('#addItemBtn').onclick = () => openItemModal();
    qs('#extractBtn').onclick = async () => {
      try {
        const blob = await api('/items/entry-extract?period=monthly');
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
      } catch (err) {
        toast(err.message, 'error');
      }
    };

    content.innerHTML = `
      <div class="toolbar">
        <input class="input search" id="armSearch" placeholder="Pesquisar no armazém…" />
      </div>
      <div class="table-wrap">
        <table class="data">
          <thead>
            <tr><th>Produto</th><th>Qtd</th><th>Custo</th><th>Venda</th><th>Código</th><th></th></tr>
          </thead>
          <tbody id="armBody"></tbody>
        </table>
      </div>`;

    const paint = (filter = '') => {
      const q = filter.trim().toLowerCase();
      const rows = items.filter((it) => !q || String(it.name).toLowerCase().includes(q));
      qs('#armBody').innerHTML = rows
        .map(
          (it) => `<tr>
          <td>${escapeHtml(it.name)}</td>
          <td>${Number(it.quantity) || 0}</td>
          <td>${escapeHtml(money(it.cost))}</td>
          <td>${escapeHtml(money(it.price))}</td>
          <td>${escapeHtml(it.barcode || '—')}</td>
          <td class="row-actions">
            <button class="btn btn-ghost btn-sm" data-edit="${it.id}">Editar</button>
            <button class="btn btn-danger btn-sm" data-del="${it.id}">Apagar</button>
          </td>
        </tr>`
        )
        .join('');

      qsa('[data-edit]').forEach((btn) => {
        btn.onclick = () => openItemModal(items.find((i) => i.id === Number(btn.dataset.edit)));
      });
      qsa('[data-del]').forEach((btn) => {
        btn.onclick = async () => {
          if (!confirm('Remover este produto?')) return;
          try {
            await api(`/items/${btn.dataset.del}`, { method: 'DELETE' });
            toast('Produto removido.');
            navigate('armazem');
          } catch (err) {
            toast(err.message, 'error');
          }
        };
      });
    };
    paint();
    qs('#armSearch').oninput = (e) => paint(e.target.value);
  }

  function openItemModal(item = null) {
    const isEdit = Boolean(item);
    const suppliers = state.fornecedores || [];
    openModal(`
      <div class="modal">
        <div class="modal-header">
          <h2>${isEdit ? 'Editar produto' : 'Nova entrada de stock'}</h2>
          <button class="btn btn-ghost btn-sm" id="closeModal">Fechar</button>
        </div>
        <form id="itemForm" class="form-grid">
          <div class="field full">
            <label>Nome</label>
            <input name="name" required value="${escapeHtml(item?.name || '')}" />
          </div>
          <div class="field">
            <label>Quantidade</label>
            <input name="quantity" type="number" min="0" step="1" required value="${Number(item?.quantity) || 0}" />
          </div>
          <div class="field">
            <label>Preço de venda</label>
            <input name="price" type="number" min="0" step="0.01" required value="${Number(item?.price) || 0}" />
          </div>
          <div class="field">
            <label>Custo</label>
            <input name="cost" type="number" min="0" step="0.01" value="${Number(item?.cost) || 0}" />
          </div>
          <div class="field">
            <label>Código de barras</label>
            <input name="barcode" value="${escapeHtml(item?.barcode || '')}" />
          </div>
          <div class="field full">
            <label>Fornecedor</label>
            <select name="supplierId">
              <option value="">— Sem fornecedor —</option>
              ${suppliers
                .map(
                  (s) =>
                    `<option value="${s.id}" ${Number(item?.supplierId) === Number(s.id) ? 'selected' : ''}>${escapeHtml(s.name)}</option>`
                )
                .join('')}
            </select>
          </div>
          <div class="modal-footer full">
            <button type="button" class="btn btn-ghost" id="cancelItem">Cancelar</button>
            <button type="submit" class="btn btn-primary">${isEdit ? 'Guardar' : 'Registar entrada'}</button>
          </div>
        </form>
      </div>`);

    qs('#closeModal').onclick = closeModal;
    qs('#cancelItem').onclick = closeModal;
    qs('#itemForm').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const supplierId = fd.get('supplierId') ? Number(fd.get('supplierId')) : null;
      const supplier = suppliers.find((s) => Number(s.id) === supplierId);
      const body = {
        name: String(fd.get('name') || '').trim(),
        quantity: Number(fd.get('quantity')),
        price: Number(fd.get('price')),
        cost: Number(fd.get('cost')) || 0,
        barcode: String(fd.get('barcode') || '').trim(),
        supplierId,
        supplierName: supplier?.name || ''
      };
      try {
        if (isEdit) await api(`/items/${item.id}`, { method: 'PUT', body });
        else await api('/items', { method: 'POST', body });
        toast(isEdit ? 'Produto atualizado.' : 'Entrada registada.');
        closeModal();
        navigate('armazem');
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  }

  /* ——— Obras ——— */
  async function renderObras() {
    const [obras, items] = await Promise.all([api('/obras'), api('/items')]);
    state.obras = obras;
    state.items = items;

    setTopbar(`<button class="btn btn-primary btn-sm" id="addObraBtn">+ Nova obra</button>`);
    qs('#addObraBtn').onclick = () => openObraModal();

    content.innerHTML = `
      <div class="table-wrap">
        <table class="data">
          <thead>
            <tr><th>Cliente</th><th>Veículo</th><th>Matrícula</th><th>Entrada</th><th>Requisições</th><th></th></tr>
          </thead>
          <tbody>
            ${
              obras.length
                ? obras
                    .map((o) => {
                      const reqTotal = (o.requisicoes || []).reduce((s, r) => s + Number(r.total || 0), 0);
                      return `<tr>
                      <td>${escapeHtml(o.client || o.name)}</td>
                      <td>${escapeHtml(`${o.brand || ''} ${o.model || ''}`.trim())}</td>
                      <td>${escapeHtml(o.plate || '—')}</td>
                      <td>${escapeHtml(formatDay(o.entryDate))}</td>
                      <td>${(o.requisicoes || []).length} · ${escapeHtml(money(reqTotal))}</td>
                      <td class="row-actions">
                        <button class="btn btn-ghost btn-sm" data-view-obra="${o.id}">Detalhe</button>
                        <button class="btn btn-danger btn-sm" data-del-obra="${o.id}">Apagar</button>
                      </td>
                    </tr>`;
                    })
                    .join('')
                : `<tr><td colspan="6"><div class="empty">Sem obras registadas.</div></td></tr>`
            }
          </tbody>
        </table>
      </div>`;

    qsa('[data-view-obra]').forEach((btn) => {
      btn.onclick = () => openObraDetail(obras.find((o) => o.id === Number(btn.dataset.viewObra)));
    });
    qsa('[data-del-obra]').forEach((btn) => {
      btn.onclick = async () => {
        if (!confirm('Apagar esta obra?')) return;
        try {
          await api(`/obras/${btn.dataset.delObra}`, { method: 'DELETE' });
          toast('Obra removida.');
          navigate('obras');
        } catch (err) {
          toast(err.message, 'error');
        }
      };
    });
  }

  function openObraModal(obra = null) {
    openModal(`
      <div class="modal">
        <div class="modal-header">
          <h2>${obra ? 'Editar obra' : 'Nova obra'}</h2>
          <button class="btn btn-ghost btn-sm" id="closeModal">Fechar</button>
        </div>
        <form id="obraForm" class="form-grid">
          <div class="field"><label>Cliente</label><input name="client" required value="${escapeHtml(obra?.client || '')}" /></div>
          <div class="field"><label>Telemóvel</label><input name="phone" required value="${escapeHtml(obra?.phone || '')}" /></div>
          <div class="field"><label>Marca</label><input name="brand" required value="${escapeHtml(obra?.brand || '')}" /></div>
          <div class="field"><label>Modelo</label><input name="model" required value="${escapeHtml(obra?.model || '')}" /></div>
          <div class="field"><label>Matrícula</label><input name="plate" required value="${escapeHtml(obra?.plate || '')}" /></div>
          <div class="field"><label>Quilometragem</label><input name="mileage" type="number" value="${Number(obra?.mileage) || 0}" /></div>
          <div class="field"><label>Data de entrada</label><input name="entryDate" type="date" required value="${escapeHtml((obra?.entryDate || new Date().toISOString().slice(0, 10)).slice(0, 10))}" /></div>
          <div class="field full"><label>Descrição do serviço</label><textarea name="serviceDescription">${escapeHtml(obra?.serviceDescription || '')}</textarea></div>
          <div class="modal-footer full">
            <button type="button" class="btn btn-ghost" id="cancelObra">Cancelar</button>
            <button class="btn btn-primary" type="submit">Guardar</button>
          </div>
        </form>
      </div>`);
    qs('#closeModal').onclick = closeModal;
    qs('#cancelObra').onclick = closeModal;
    qs('#obraForm').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = Object.fromEntries(fd.entries());
      body.mileage = Number(body.mileage) || 0;
      try {
        if (obra) await api(`/obras/${obra.id}`, { method: 'PUT', body });
        else await api('/obras', { method: 'POST', body });
        toast('Obra guardada.');
        closeModal();
        navigate('obras');
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  }

  function openObraDetail(obra) {
    if (!obra) return;
    const items = state.items || [];
    openModal(`
      <div class="modal wide">
        <div class="modal-header">
          <div>
            <h2>${escapeHtml(obra.client)}</h2>
            <p class="sub">${escapeHtml(`${obra.brand} ${obra.model} · ${obra.plate}`)}</p>
          </div>
          <button class="btn btn-ghost btn-sm" id="closeModal">Fechar</button>
        </div>
        <p style="color:var(--text-muted);margin:0 0 14px;">${escapeHtml(obra.serviceDescription || 'Sem descrição')}</p>
        <div class="section-card" style="margin-bottom:14px;">
          <h3>Nova requisição</h3>
          <form id="reqForm" class="form-grid">
            <div class="field">
              <label>Produto</label>
              <select name="itemId" required>
                ${items.map((it) => `<option value="${it.id}">${escapeHtml(it.name)} (${it.quantity})</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label>Quantidade</label>
              <input name="quantity" type="number" min="1" value="1" required />
            </div>
            <div class="field" style="align-self:end;">
              <button class="btn btn-primary" type="submit">Adicionar</button>
            </div>
          </form>
        </div>
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>Item</th><th>Qtd</th><th>Preço</th><th>Total</th></tr></thead>
            <tbody>
              ${(obra.requisicoes || [])
                .map(
                  (r) => `<tr>
                  <td>${escapeHtml(r.itemName)}</td>
                  <td>${r.quantity}</td>
                  <td>${escapeHtml(money(r.unitPrice))}</td>
                  <td>${escapeHtml(money(r.total))}</td>
                </tr>`
                )
                .join('') || `<tr><td colspan="4"><div class="empty">Sem requisições.</div></td></tr>`}
            </tbody>
          </table>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" id="editObraBtn">Editar obra</button>
        </div>
      </div>`);
    qs('#closeModal').onclick = closeModal;
    qs('#editObraBtn').onclick = () => openObraModal(obra);
    qs('#reqForm').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await api(`/obras/${obra.id}/requisicoes`, {
          method: 'POST',
          body: { itemId: Number(fd.get('itemId')), quantity: Number(fd.get('quantity')) }
        });
        toast('Requisição adicionada.');
        closeModal();
        navigate('obras');
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  }

  /* ——— Document lines helper ——— */
  function linesEditorHtml(items = [{ description: '', quantity: 1, unitPrice: 0 }]) {
    return `
      <div class="lines-editor" id="linesEditor">
        ${items
          .map(
            (it, idx) => `
          <div class="line-row" data-line="${idx}">
            <input class="input" name="description" placeholder="Descrição" value="${escapeHtml(it.description || '')}" required />
            <input class="input" name="quantity" type="number" min="0.01" step="0.01" value="${Number(it.quantity) || 1}" required />
            <input class="input" name="unitPrice" type="number" min="0" step="0.01" value="${Number(it.unitPrice) || 0}" required />
            <button type="button" class="btn btn-danger btn-sm" data-remove-line>✕</button>
          </div>`
          )
          .join('')}
      </div>
      <button type="button" class="btn btn-ghost btn-sm" id="addLineBtn" style="margin-top:8px;">+ Linha</button>`;
  }

  function bindLinesEditor() {
    const editor = qs('#linesEditor');
    qs('#addLineBtn').onclick = () => {
      const row = document.createElement('div');
      row.className = 'line-row';
      row.innerHTML = `
        <input class="input" name="description" placeholder="Descrição" required />
        <input class="input" name="quantity" type="number" min="0.01" step="0.01" value="1" required />
        <input class="input" name="unitPrice" type="number" min="0" step="0.01" value="0" required />
        <button type="button" class="btn btn-danger btn-sm" data-remove-line>✕</button>`;
      editor.appendChild(row);
      row.querySelector('[data-remove-line]').onclick = () => {
        if (editor.children.length > 1) row.remove();
      };
    };
    qsa('[data-remove-line]', editor).forEach((btn) => {
      btn.onclick = () => {
        if (editor.children.length > 1) btn.closest('.line-row').remove();
      };
    });
  }

  function collectLines() {
    return qsa('#linesEditor .line-row').map((row) => ({
      description: row.querySelector('[name=description]').value.trim(),
      quantity: Number(row.querySelector('[name=quantity]').value),
      unitPrice: Number(row.querySelector('[name=unitPrice]').value)
    }));
  }

  /* ——— Cotações ——— */
  async function renderCotacoes() {
    const list = await api('/cotacoes');
    state.cotacoes = list;
    setTopbar(`<button class="btn btn-primary btn-sm" id="addCotBtn">+ Cotação</button>`);
    qs('#addCotBtn').onclick = () => openCotacaoModal();

    content.innerHTML = `
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>Nº</th><th>Cliente</th><th>Veículo</th><th>Estado</th><th>Criada</th><th></th></tr></thead>
          <tbody>
            ${
              list.length
                ? list
                    .map((c) => {
                      const total = (c.items || []).reduce(
                        (s, i) => s + Number(i.quantity) * Number(i.unitPrice),
                        0
                      );
                      return `<tr>
                      <td>${escapeHtml(c.number)}</td>
                      <td>${escapeHtml(c.client)}<br><small style="color:var(--text-muted)">${escapeHtml(money(c.totals?.total ?? total))}</small></td>
                      <td>${escapeHtml(`${c.brand || ''} ${c.model || ''}`.trim() || '—')}</td>
                      <td><span class="badge badge-muted">${escapeHtml(c.status || 'rascunho')}</span></td>
                      <td>${escapeHtml(formatDate(c.created_at))}</td>
                      <td class="row-actions">
                        <button class="btn btn-ghost btn-sm" data-edit-cot="${c.id}">Editar</button>
                        <button class="btn btn-ghost btn-sm" data-pdf-cot="${c.id}">PDF</button>
                        <button class="btn btn-danger btn-sm" data-del-cot="${c.id}">Apagar</button>
                      </td>
                    </tr>`;
                    })
                    .join('')
                : `<tr><td colspan="6"><div class="empty">Sem cotações.</div></td></tr>`
            }
          </tbody>
        </table>
      </div>`;

    qsa('[data-edit-cot]').forEach((btn) => {
      btn.onclick = () => openCotacaoModal(list.find((c) => c.id === Number(btn.dataset.editCot)));
    });
    qsa('[data-pdf-cot]').forEach((btn) => {
      btn.onclick = async () => {
        try {
          const blob = await api(`/cotacoes/${btn.dataset.pdfCot}/report`);
          window.open(URL.createObjectURL(blob), '_blank');
        } catch (err) {
          toast(err.message, 'error');
        }
      };
    });
    qsa('[data-del-cot]').forEach((btn) => {
      btn.onclick = async () => {
        if (!confirm('Apagar cotação?')) return;
        try {
          await api(`/cotacoes/${btn.dataset.delCot}`, { method: 'DELETE' });
          toast('Cotação removida.');
          navigate('cotacao');
        } catch (err) {
          toast(err.message, 'error');
        }
      };
    });
  }

  function openCotacaoModal(doc = null) {
    openModal(`
      <div class="modal wide">
        <div class="modal-header">
          <h2>${doc ? 'Editar cotação' : 'Nova cotação'}</h2>
          <button class="btn btn-ghost btn-sm" id="closeModal">Fechar</button>
        </div>
        <form id="cotForm" class="form-grid">
          <div class="field"><label>Cliente</label><input name="client" required value="${escapeHtml(doc?.client || '')}" /></div>
          <div class="field"><label>Telemóvel</label><input name="phone" value="${escapeHtml(doc?.phone || '')}" /></div>
          <div class="field"><label>Marca</label><input name="brand" value="${escapeHtml(doc?.brand || '')}" /></div>
          <div class="field"><label>Modelo</label><input name="model" value="${escapeHtml(doc?.model || '')}" /></div>
          <div class="field"><label>Matrícula</label><input name="plate" value="${escapeHtml(doc?.plate || '')}" /></div>
          <div class="field"><label>Válida até</label><input name="validUntil" type="date" value="${escapeHtml((doc?.validUntil || '').slice(0, 10))}" /></div>
          <div class="field"><label>Estado</label>
            <select name="status">
              ${['rascunho', 'enviada', 'aprovada', 'rejeitada']
                .map((s) => `<option value="${s}" ${doc?.status === s ? 'selected' : ''}>${s}</option>`)
                .join('')}
            </select>
          </div>
          <div class="field full"><label>Notas</label><textarea name="notes">${escapeHtml(doc?.notes || '')}</textarea></div>
          <div class="field full">
            <label>Linhas</label>
            ${linesEditorHtml(doc?.items?.length ? doc.items : undefined)}
          </div>
          <div class="modal-footer full">
            <button type="button" class="btn btn-ghost" id="cancelCot">Cancelar</button>
            <button class="btn btn-primary" type="submit">Guardar</button>
          </div>
        </form>
      </div>`);
    qs('#closeModal').onclick = closeModal;
    qs('#cancelCot').onclick = closeModal;
    bindLinesEditor();
    qs('#cotForm').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = Object.fromEntries(fd.entries());
      body.items = collectLines();
      try {
        if (doc) await api(`/cotacoes/${doc.id}`, { method: 'PUT', body });
        else await api('/cotacoes', { method: 'POST', body });
        toast('Cotação guardada.');
        closeModal();
        navigate('cotacao');
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  }

  /* ——— Facturas ——— */
  async function renderFacturas() {
    const list = await api('/facturas');
    state.facturas = list;
    setTopbar(`<button class="btn btn-primary btn-sm" id="addFatBtn">+ Factura</button>`);
    qs('#addFatBtn').onclick = () => openFacturaModal();

    content.innerHTML = `
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>Nº</th><th>Cliente</th><th>Estado</th><th>Emissão</th><th></th></tr></thead>
          <tbody>
            ${
              list.length
                ? list
                    .map((f) => {
                      const total = (f.items || []).reduce(
                        (s, i) => s + Number(i.quantity) * Number(i.unitPrice),
                        0
                      );
                      const badge =
                        f.status === 'pago'
                          ? 'badge-ok'
                          : f.status === 'anulado'
                            ? 'badge-danger'
                            : 'badge-warn';
                      return `<tr>
                      <td>${escapeHtml(f.number)}</td>
                      <td>${escapeHtml(f.client)}<br><small style="color:var(--text-muted)">${escapeHtml(money(f.totals?.total ?? total))}</small></td>
                      <td><span class="badge ${badge}">${escapeHtml(f.status || 'pendente')}</span></td>
                      <td>${escapeHtml(formatDay(f.issueDate || f.created_at))}</td>
                      <td class="row-actions">
                        <button class="btn btn-ghost btn-sm" data-edit-fat="${f.id}">Editar</button>
                        <button class="btn btn-ghost btn-sm" data-pdf-fat="${f.id}">PDF</button>
                        <button class="btn btn-danger btn-sm" data-del-fat="${f.id}">Apagar</button>
                      </td>
                    </tr>`;
                    })
                    .join('')
                : `<tr><td colspan="5"><div class="empty">Sem facturas.</div></td></tr>`
            }
          </tbody>
        </table>
      </div>`;

    qsa('[data-edit-fat]').forEach((btn) => {
      btn.onclick = () => openFacturaModal(list.find((f) => f.id === Number(btn.dataset.editFat)));
    });
    qsa('[data-pdf-fat]').forEach((btn) => {
      btn.onclick = async () => {
        try {
          const blob = await api(`/facturas/${btn.dataset.pdfFat}/report`);
          window.open(URL.createObjectURL(blob), '_blank');
        } catch (err) {
          toast(err.message, 'error');
        }
      };
    });
    qsa('[data-del-fat]').forEach((btn) => {
      btn.onclick = async () => {
        if (!confirm('Apagar factura?')) return;
        try {
          await api(`/facturas/${btn.dataset.delFat}`, { method: 'DELETE' });
          toast('Factura removida.');
          navigate('factura');
        } catch (err) {
          toast(err.message, 'error');
        }
      };
    });
  }

  function openFacturaModal(doc = null) {
    openModal(`
      <div class="modal wide">
        <div class="modal-header">
          <h2>${doc ? 'Editar factura' : 'Nova factura'}</h2>
          <button class="btn btn-ghost btn-sm" id="closeModal">Fechar</button>
        </div>
        <form id="fatForm" class="form-grid">
          <div class="field"><label>Cliente</label><input name="client" required value="${escapeHtml(doc?.client || '')}" /></div>
          <div class="field"><label>Telemóvel</label><input name="phone" value="${escapeHtml(doc?.phone || '')}" /></div>
          <div class="field"><label>NUIT</label><input name="nuit" value="${escapeHtml(doc?.nuit || '')}" /></div>
          <div class="field"><label>Morada</label><input name="address" value="${escapeHtml(doc?.address || '')}" /></div>
          <div class="field"><label>Matrícula</label><input name="plate" value="${escapeHtml(doc?.plate || '')}" /></div>
          <div class="field"><label>Data de emissão</label><input name="issueDate" type="date" value="${escapeHtml((doc?.issueDate || new Date().toISOString().slice(0, 10)).slice(0, 10))}" /></div>
          <div class="field"><label>Desconto</label><input name="discount" type="number" min="0" step="0.01" value="${Number(doc?.discount) || 0}" /></div>
          <div class="field"><label>Estado</label>
            <select name="status">
              ${['pendente', 'pago', 'anulado']
                .map((s) => `<option value="${s}" ${doc?.status === s ? 'selected' : ''}>${s}</option>`)
                .join('')}
            </select>
          </div>
          <div class="field full"><label>Notas</label><textarea name="notes">${escapeHtml(doc?.notes || '')}</textarea></div>
          <div class="field full">
            <label>Linhas</label>
            ${linesEditorHtml(doc?.items?.length ? doc.items : undefined)}
          </div>
          <div class="modal-footer full">
            <button type="button" class="btn btn-ghost" id="cancelFat">Cancelar</button>
            <button class="btn btn-primary" type="submit">Guardar</button>
          </div>
        </form>
      </div>`);
    qs('#closeModal').onclick = closeModal;
    qs('#cancelFat').onclick = closeModal;
    bindLinesEditor();
    qs('#fatForm').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = Object.fromEntries(fd.entries());
      body.discount = Number(body.discount) || 0;
      body.items = collectLines();
      try {
        if (doc) await api(`/facturas/${doc.id}`, { method: 'PUT', body });
        else await api('/facturas', { method: 'POST', body });
        toast('Factura guardada.');
        closeModal();
        navigate('factura');
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  }

  /* ——— Diário ——— */
  async function renderDiario() {
    const today = new Date().toISOString().slice(0, 10);
    let date = today;
    const load = async (d) => {
      date = d;
      const data = await api(`/diario?date=${encodeURIComponent(d)}`);
      state.diario = data;
      const movements = data.movements || data.day?.movements || [];
      const initial = Number(data.initialValue ?? data.day?.initialValue ?? 0);
      const entradas = movements.filter((m) => m.type === 'entrada').reduce((s, m) => s + Number(m.amount), 0);
      const saidas = movements.filter((m) => m.type === 'saida').reduce((s, m) => s + Number(m.amount), 0);
      const saldo = initial + entradas - saidas;

      setTopbar(`
        <input class="input" type="date" id="diarioDate" value="${escapeHtml(d)}" />
        <button class="btn btn-ghost btn-sm" id="diarioPdf">PDF</button>
        <button class="btn btn-primary btn-sm" id="addMovBtn">+ Movimento</button>
      `);
      qs('#diarioDate').onchange = (e) => load(e.target.value);
      qs('#diarioPdf').onclick = async () => {
        try {
          const blob = await api(`/diario/report?date=${encodeURIComponent(date)}`);
          window.open(URL.createObjectURL(blob), '_blank');
        } catch (err) {
          toast(err.message, 'error');
        }
      };
      qs('#addMovBtn').onclick = () => openMovimentoModal(date);

      content.innerHTML = `
        <div class="stats">
          <div class="stat"><div class="label">Valor inicial</div><div class="value">${escapeHtml(money(initial))}</div></div>
          <div class="stat"><div class="label">Entradas</div><div class="value ok">${escapeHtml(money(entradas))}</div></div>
          <div class="stat"><div class="label">Saídas</div><div class="value warn">${escapeHtml(money(saidas))}</div></div>
          <div class="stat"><div class="label">Saldo</div><div class="value accent">${escapeHtml(money(saldo))}</div></div>
        </div>
        <div class="section-card" style="margin-bottom:16px;">
          <form id="initialForm" style="display:flex;gap:10px;align-items:end;flex-wrap:wrap;">
            <div class="field" style="margin:0;min-width:180px;">
              <label>Definir valor inicial</label>
              <input class="input" name="initialValue" type="number" step="0.01" value="${initial}" />
            </div>
            <button class="btn btn-ghost" type="submit">Guardar</button>
          </form>
        </div>
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>Tipo</th><th>Valor</th><th>Descrição</th><th>Utilizador</th><th>Hora</th><th></th></tr></thead>
            <tbody>
              ${
                movements.length
                  ? movements
                      .map(
                        (m) => `<tr>
                      <td><span class="badge ${m.type === 'entrada' ? 'badge-ok' : 'badge-warn'}">${escapeHtml(m.type)}</span></td>
                      <td>${escapeHtml(money(m.amount))}</td>
                      <td>${escapeHtml(m.description || '—')}</td>
                      <td>${escapeHtml(m.userName || '—')}</td>
                      <td>${escapeHtml(formatDate(m.created_at))}</td>
                      <td><button class="btn btn-danger btn-sm" data-del-mov="${m.id}">Apagar</button></td>
                    </tr>`
                      )
                      .join('')
                  : `<tr><td colspan="6"><div class="empty">Sem movimentos neste dia.</div></td></tr>`
              }
            </tbody>
          </table>
        </div>`;

      qs('#initialForm').onsubmit = async (e) => {
        e.preventDefault();
        const value = Number(new FormData(e.target).get('initialValue'));
        try {
          await api('/diario/initial', { method: 'PUT', body: { date, initialValue: value } });
          toast('Valor inicial atualizado.');
          load(date);
        } catch (err) {
          toast(err.message, 'error');
        }
      };
      qsa('[data-del-mov]').forEach((btn) => {
        btn.onclick = async () => {
          if (!confirm('Apagar movimento?')) return;
          try {
            await api(`/diario/movements/${btn.dataset.delMov}?date=${encodeURIComponent(date)}`, {
              method: 'DELETE'
            });
            toast('Movimento removido.');
            load(date);
          } catch (err) {
            toast(err.message, 'error');
          }
        };
      });
    };
    await load(today);
  }

  function openMovimentoModal(date) {
    openModal(`
      <div class="modal">
        <div class="modal-header">
          <h2>Novo movimento</h2>
          <button class="btn btn-ghost btn-sm" id="closeModal">Fechar</button>
        </div>
        <form id="movForm" class="form-grid">
          <div class="field">
            <label>Tipo</label>
            <select name="type"><option value="entrada">Entrada</option><option value="saida">Saída</option></select>
          </div>
          <div class="field">
            <label>Valor</label>
            <input name="amount" type="number" min="0.01" step="0.01" required />
          </div>
          <div class="field full">
            <label>Descrição</label>
            <input name="description" required />
          </div>
          <div class="modal-footer full">
            <button type="button" class="btn btn-ghost" id="cancelMov">Cancelar</button>
            <button class="btn btn-primary" type="submit">Registar</button>
          </div>
        </form>
      </div>`);
    qs('#closeModal').onclick = closeModal;
    qs('#cancelMov').onclick = closeModal;
    qs('#movForm').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await api('/diario/movements', {
          method: 'POST',
          body: {
            date,
            type: fd.get('type'),
            amount: Number(fd.get('amount')),
            description: String(fd.get('description') || '').trim()
          }
        });
        toast('Movimento registado.');
        closeModal();
        navigate('diario');
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  }

  /* ——— Histórico ——— */
  async function renderHistorico() {
    const history = await api('/history');
    state.history = history;
    setTopbar(
      isCeo()
        ? `<button class="btn btn-danger btn-sm" id="clearHist">Limpar histórico</button>`
        : ''
    );
    if (isCeo()) {
      qs('#clearHist').onclick = async () => {
        if (!confirm('Limpar todo o histórico?')) return;
        try {
          await api('/history', { method: 'DELETE' });
          toast('Histórico limpo.');
          navigate('historico');
        } catch (err) {
          toast(err.message, 'error');
        }
      };
    }

    content.innerHTML = `
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>Quando</th><th>Tipo</th><th>Ação</th><th>Resumo</th><th>Utilizador</th></tr></thead>
          <tbody>
            ${
              history.length
                ? history
                    .slice()
                    .reverse()
                    .map(
                      (h) => `<tr>
                      <td>${escapeHtml(formatDate(h.created_at))}</td>
                      <td>${escapeHtml(h.type || '—')}</td>
                      <td>${escapeHtml(h.action || '—')}</td>
                      <td style="white-space:normal;max-width:420px;">${escapeHtml(h.summary || '')}</td>
                      <td>${escapeHtml(h.userName || '—')}</td>
                    </tr>`
                    )
                    .join('')
                : `<tr><td colspan="5"><div class="empty">Sem histórico.</div></td></tr>`
            }
          </tbody>
        </table>
      </div>`;
  }

  /* ——— Câmaras ——— */
  async function renderCameras() {
    const cameras = await api('/cameras');
    state.cameras = cameras;
    setTopbar(`<button class="btn btn-primary btn-sm" id="addCamBtn">+ Câmara</button>`);
    qs('#addCamBtn').onclick = () => openCameraModal();

    content.innerHTML = cameras.length
      ? `<div class="grid-3">${cameras
          .map(
            (c) => `<div class="section-card">
            <h3>${escapeHtml(c.name || 'Câmara')}</h3>
            <p style="color:var(--text-muted);font-size:.9rem;word-break:break-all;">${escapeHtml(c.url || c.streamUrl || '—')}</p>
            <div class="row-actions" style="margin-top:12px;">
              ${c.url || c.streamUrl ? `<a class="btn btn-ghost btn-sm" href="${escapeHtml(c.url || c.streamUrl)}" target="_blank" rel="noopener">Abrir</a>` : ''}
              <button class="btn btn-ghost btn-sm" data-edit-cam="${c.id}">Editar</button>
              <button class="btn btn-danger btn-sm" data-del-cam="${c.id}">Apagar</button>
            </div>
          </div>`
          )
          .join('')}</div>`
      : `<div class="empty"><strong>Sem câmaras</strong>Adicione um stream RTSP/HTTP para monitorizar.</div>`;

    qsa('[data-edit-cam]').forEach((btn) => {
      btn.onclick = () => openCameraModal(cameras.find((c) => c.id === Number(btn.dataset.editCam)));
    });
    qsa('[data-del-cam]').forEach((btn) => {
      btn.onclick = async () => {
        if (!confirm('Apagar câmara?')) return;
        try {
          await api(`/cameras/${btn.dataset.delCam}`, { method: 'DELETE' });
          toast('Câmara removida.');
          navigate('cameras');
        } catch (err) {
          toast(err.message, 'error');
        }
      };
    });
  }

  function openCameraModal(cam = null) {
    openModal(`
      <div class="modal">
        <div class="modal-header">
          <h2>${cam ? 'Editar câmara' : 'Nova câmara'}</h2>
          <button class="btn btn-ghost btn-sm" id="closeModal">Fechar</button>
        </div>
        <form id="camForm" class="form-grid">
          <div class="field full"><label>Nome</label><input name="name" required value="${escapeHtml(cam?.name || '')}" /></div>
          <div class="field full"><label>URL do stream</label><input name="url" required value="${escapeHtml(cam?.url || cam?.streamUrl || '')}" placeholder="https://… ou rtsp://…" /></div>
          <div class="field full"><label>Notas</label><textarea name="notes">${escapeHtml(cam?.notes || '')}</textarea></div>
          <div class="modal-footer full">
            <button type="button" class="btn btn-ghost" id="cancelCam">Cancelar</button>
            <button class="btn btn-primary" type="submit">Guardar</button>
          </div>
        </form>
      </div>`);
    qs('#closeModal').onclick = closeModal;
    qs('#cancelCam').onclick = closeModal;
    qs('#camForm').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = Object.fromEntries(fd.entries());
      try {
        if (cam) await api(`/cameras/${cam.id}`, { method: 'PUT', body });
        else await api('/cameras', { method: 'POST', body });
        toast('Câmara guardada.');
        closeModal();
        navigate('cameras');
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  }

  /* ——— Chat ——— */
  async function renderChat() {
    const paint = async () => {
      const messages = await api('/messages');
      state.messages = messages;
      const box = qs('#chatMessages');
      if (!box) return;
      const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
      box.innerHTML = messages
        .map((m) => {
          const mine = Number(m.userId) === Number(user.id);
          return `<div class="chat-bubble ${mine ? 'mine' : ''}" data-id="${m.id}">
            <div class="who">${escapeHtml(m.fullName || m.username)} · ${escapeHtml(formatDate(m.created_at))}</div>
            <div class="text">${escapeHtml(m.text)}</div>
            <div class="meta">
              <span>👁 ${m.viewCount || 0}</span>
              <span>✓ ${m.okCount || 0}</span>
              ${!m.okByMe ? `<button class="btn btn-ghost btn-sm" data-ok="${m.id}">OK</button>` : '<span>Confirmado</span>'}
            </div>
          </div>`;
        })
        .join('');

      qsa('[data-ok]', box).forEach((btn) => {
        btn.onclick = async () => {
          try {
            await api(`/messages/${btn.dataset.ok}/ok`, { method: 'POST' });
            paint();
          } catch (err) {
            toast(err.message, 'error');
          }
        };
      });

      // mark latest as viewed
      const last = messages[messages.length - 1];
      if (last && !last.viewedByMe) {
        api(`/messages/${last.id}/view`, { method: 'POST' }).catch(() => {});
      }
      if (nearBottom) box.scrollTop = box.scrollHeight;
    };

    setTopbar('');
    content.innerHTML = `
      <div class="chat-layout">
        <div class="chat-messages" id="chatMessages"></div>
        <form class="chat-compose" id="chatForm">
          <input class="input" id="chatInput" placeholder="Escreva uma mensagem…" maxlength="2000" required />
          <button class="btn btn-primary" type="submit">Enviar</button>
        </form>
      </div>`;

    qs('#chatForm').onsubmit = async (e) => {
      e.preventDefault();
      const text = qs('#chatInput').value.trim();
      if (!text) return;
      try {
        await api('/messages', { method: 'POST', body: { text } });
        qs('#chatInput').value = '';
        await paint();
        qs('#chatMessages').scrollTop = qs('#chatMessages').scrollHeight;
      } catch (err) {
        toast(err.message, 'error');
      }
    };

    await paint();
    stopChatPoll();
    chatTimer = setInterval(paint, 8000);
  }

  /* ——— Cadastro ——— */
  async function renderCadastro() {
    const [users, clientes, fornecedores, sessions] = await Promise.all([
      api('/users'),
      api('/clientes'),
      api('/fornecedores'),
      api('/sessions').catch(() => [])
    ]);
    state.users = users;
    state.clientes = clientes;
    state.fornecedores = fornecedores;
    state.sessions = sessions;

    setTopbar(`
      <button class="btn btn-primary btn-sm" id="addUserBtn">+ Utilizador</button>
      <button class="btn btn-ghost btn-sm" id="addClienteBtn">+ Cliente</button>
      <button class="btn btn-ghost btn-sm" id="addFornBtn">+ Fornecedor</button>
    `);
    qs('#addUserBtn').onclick = () => openUserModal();
    qs('#addClienteBtn').onclick = () => openClienteModal();
    qs('#addFornBtn').onclick = () => openFornecedorModal();

    content.innerHTML = `
      <div class="section-card" style="margin-bottom:16px;">
        <h3>Sessões ativas (${sessions.length})</h3>
        <div class="table-wrap" style="border:none;background:transparent;">
          <table class="data">
            <thead><tr><th>Nome</th><th>Dispositivo</th><th>Página</th><th>Visto</th></tr></thead>
            <tbody>
              ${
                sessions.length
                  ? sessions
                      .map(
                        (s) => `<tr>
                        <td>${escapeHtml(s.fullName)}</td>
                        <td>${escapeHtml(s.deviceLabel || '—')}</td>
                        <td>${escapeHtml(s.currentPage || '—')}</td>
                        <td>${escapeHtml(formatDate(s.lastSeenAt))}</td>
                      </tr>`
                      )
                      .join('')
                  : `<tr><td colspan="4"><div class="empty">Ninguém online.</div></td></tr>`
              }
            </tbody>
          </table>
        </div>
      </div>

      <div class="grid-2">
        <div class="section-card">
          <h3>Utilizadores</h3>
          <div class="table-wrap" style="border:none;background:transparent;">
            <table class="data">
              <thead><tr><th>Nome</th><th>User</th><th>Cargo</th><th></th></tr></thead>
              <tbody>
                ${users
                  .map(
                    (u) => `<tr>
                    <td>${escapeHtml(u.fullName)}</td>
                    <td>${escapeHtml(u.username)}</td>
                    <td>${escapeHtml(u.role || (Number(u.id) === 1 ? 'CEO' : '—'))}</td>
                    <td class="row-actions">
                      <button class="btn btn-ghost btn-sm" data-edit-user="${u.id}">Editar</button>
                      ${Number(u.id) !== 1 ? `<button class="btn btn-danger btn-sm" data-del-user="${u.id}">Apagar</button>` : ''}
                    </td>
                  </tr>`
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <div class="section-card" style="margin-bottom:16px;">
            <h3>Clientes</h3>
            <div class="table-wrap" style="border:none;background:transparent;">
              <table class="data">
                <thead><tr><th>Nome</th><th>Contacto</th><th></th></tr></thead>
                <tbody>
                  ${
                    clientes.length
                      ? clientes
                          .map(
                            (c) => `<tr>
                            <td>${escapeHtml(c.name)}</td>
                            <td>${escapeHtml(c.phone || c.email || '—')}</td>
                            <td class="row-actions">
                              <button class="btn btn-ghost btn-sm" data-edit-cli="${c.id}">Editar</button>
                              <button class="btn btn-danger btn-sm" data-del-cli="${c.id}">Apagar</button>
                            </td>
                          </tr>`
                          )
                          .join('')
                      : `<tr><td colspan="3"><div class="empty">Sem clientes.</div></td></tr>`
                  }
                </tbody>
              </table>
            </div>
          </div>

          <div class="section-card">
            <h3>Fornecedores</h3>
            <div class="table-wrap" style="border:none;background:transparent;">
              <table class="data">
                <thead><tr><th>Nome</th><th>Contacto</th><th></th></tr></thead>
                <tbody>
                  ${
                    fornecedores.length
                      ? fornecedores
                          .map(
                            (f) => `<tr>
                            <td>${escapeHtml(f.name)}</td>
                            <td>${escapeHtml(f.phone || f.email || '—')}</td>
                            <td class="row-actions">
                              <button class="btn btn-ghost btn-sm" data-edit-forn="${f.id}">Editar</button>
                              <button class="btn btn-danger btn-sm" data-del-forn="${f.id}">Apagar</button>
                            </td>
                          </tr>`
                          )
                          .join('')
                      : `<tr><td colspan="3"><div class="empty">Sem fornecedores.</div></td></tr>`
                  }
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>`;

    qsa('[data-edit-user]').forEach((btn) => {
      btn.onclick = () => openUserModal(users.find((u) => u.id === Number(btn.dataset.editUser)));
    });
    qsa('[data-del-user]').forEach((btn) => {
      btn.onclick = async () => {
        if (!confirm('Apagar utilizador?')) return;
        try {
          await api(`/users/${btn.dataset.delUser}`, { method: 'DELETE' });
          toast('Utilizador removido.');
          navigate('cadastro');
        } catch (err) {
          toast(err.message, 'error');
        }
      };
    });
    qsa('[data-edit-cli]').forEach((btn) => {
      btn.onclick = () => openClienteModal(clientes.find((c) => c.id === Number(btn.dataset.editCli)));
    });
    qsa('[data-del-cli]').forEach((btn) => {
      btn.onclick = async () => {
        if (!confirm('Apagar cliente?')) return;
        try {
          await api(`/clientes/${btn.dataset.delCli}`, { method: 'DELETE' });
          toast('Cliente removido.');
          navigate('cadastro');
        } catch (err) {
          toast(err.message, 'error');
        }
      };
    });
    qsa('[data-edit-forn]').forEach((btn) => {
      btn.onclick = () =>
        openFornecedorModal(fornecedores.find((f) => f.id === Number(btn.dataset.editForn)));
    });
    qsa('[data-del-forn]').forEach((btn) => {
      btn.onclick = async () => {
        if (!confirm('Apagar fornecedor?')) return;
        try {
          await api(`/fornecedores/${btn.dataset.delForn}`, { method: 'DELETE' });
          toast('Fornecedor removido.');
          navigate('cadastro');
        } catch (err) {
          toast(err.message, 'error');
        }
      };
    });
  }

  function openUserModal(u = null) {
    openModal(`
      <div class="modal">
        <div class="modal-header">
          <h2>${u ? 'Editar utilizador' : 'Novo utilizador'}</h2>
          <button class="btn btn-ghost btn-sm" id="closeModal">Fechar</button>
        </div>
        <form id="userForm" class="form-grid">
          <div class="field"><label>Nome completo</label><input name="fullName" required value="${escapeHtml(u?.fullName || '')}" /></div>
          <div class="field"><label>Email</label><input name="email" type="email" required value="${escapeHtml(u?.email || '')}" /></div>
          <div class="field"><label>Utilizador</label><input name="username" required value="${escapeHtml(u?.username || '')}" /></div>
          <div class="field"><label>Senha ${u ? '(opcional)' : ''}</label><input name="password" type="password" ${u ? '' : 'required'} /></div>
          <div class="field"><label>Telemóvel</label><input name="phone" value="${escapeHtml(u?.phone || '')}" /></div>
          <div class="field"><label>Cargo</label><input name="role" value="${escapeHtml(u?.role || '')}" /></div>
          <div class="field"><label>Departamento</label><input name="department" value="${escapeHtml(u?.department || '')}" /></div>
          <div class="field"><label>Cidade</label><input name="city" value="${escapeHtml(u?.city || '')}" /></div>
          <div class="modal-footer full">
            <button type="button" class="btn btn-ghost" id="cancelUser">Cancelar</button>
            <button class="btn btn-primary" type="submit">Guardar</button>
          </div>
        </form>
      </div>`);
    qs('#closeModal').onclick = closeModal;
    qs('#cancelUser').onclick = closeModal;
    qs('#userForm').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = Object.fromEntries(fd.entries());
      if (!body.password) delete body.password;
      try {
        if (u) await api(`/users/${u.id}`, { method: 'PUT', body });
        else await api('/users', { method: 'POST', body });
        toast('Utilizador guardado.');
        closeModal();
        navigate('cadastro');
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  }

  function openClienteModal(c = null) {
    openModal(`
      <div class="modal">
        <div class="modal-header">
          <h2>${c ? 'Editar cliente' : 'Novo cliente'}</h2>
          <button class="btn btn-ghost btn-sm" id="closeModal">Fechar</button>
        </div>
        <form id="cliForm" class="form-grid">
          <div class="field"><label>Nome</label><input name="name" required value="${escapeHtml(c?.name || '')}" /></div>
          <div class="field"><label>Telemóvel</label><input name="phone" value="${escapeHtml(c?.phone || '')}" /></div>
          <div class="field"><label>Email</label><input name="email" type="email" value="${escapeHtml(c?.email || '')}" /></div>
          <div class="field"><label>Documento / NUIT</label><input name="document" value="${escapeHtml(c?.document || '')}" /></div>
          <div class="field full"><label>Morada</label><input name="address" value="${escapeHtml(c?.address || '')}" /></div>
          <div class="field full"><label>Notas</label><textarea name="notes">${escapeHtml(c?.notes || '')}</textarea></div>
          <div class="modal-footer full">
            <button type="button" class="btn btn-ghost" id="cancelCli">Cancelar</button>
            <button class="btn btn-primary" type="submit">Guardar</button>
          </div>
        </form>
      </div>`);
    qs('#closeModal').onclick = closeModal;
    qs('#cancelCli').onclick = closeModal;
    qs('#cliForm').onsubmit = async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target).entries());
      try {
        if (c) await api(`/clientes/${c.id}`, { method: 'PUT', body });
        else await api('/clientes', { method: 'POST', body });
        toast('Cliente guardado.');
        closeModal();
        navigate('cadastro');
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  }

  function openFornecedorModal(f = null) {
    openModal(`
      <div class="modal">
        <div class="modal-header">
          <h2>${f ? 'Editar fornecedor' : 'Novo fornecedor'}</h2>
          <button class="btn btn-ghost btn-sm" id="closeModal">Fechar</button>
        </div>
        <form id="fornForm" class="form-grid">
          <div class="field"><label>Nome</label><input name="name" required value="${escapeHtml(f?.name || '')}" /></div>
          <div class="field"><label>Telemóvel</label><input name="phone" value="${escapeHtml(f?.phone || '')}" /></div>
          <div class="field"><label>Email</label><input name="email" type="email" value="${escapeHtml(f?.email || '')}" /></div>
          <div class="field"><label>Documento</label><input name="document" value="${escapeHtml(f?.document || '')}" /></div>
          <div class="field full"><label>Morada</label><input name="address" value="${escapeHtml(f?.address || '')}" /></div>
          <div class="field full"><label>Notas</label><textarea name="notes">${escapeHtml(f?.notes || '')}</textarea></div>
          <div class="modal-footer full">
            <button type="button" class="btn btn-ghost" id="cancelForn">Cancelar</button>
            <button class="btn btn-primary" type="submit">Guardar</button>
          </div>
        </form>
      </div>`);
    qs('#closeModal').onclick = closeModal;
    qs('#cancelForn').onclick = closeModal;
    qs('#fornForm').onsubmit = async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target).entries());
      try {
        if (f) await api(`/fornecedores/${f.id}`, { method: 'PUT', body });
        else await api('/fornecedores', { method: 'POST', body });
        toast('Fornecedor guardado.');
        closeModal();
        navigate('cadastro');
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  }

  /* ——— Boot ——— */
  qs('#navList').addEventListener('click', (e) => {
    const btn = e.target.closest('.nav-item');
    if (!btn) return;
    navigate(btn.dataset.page);
  });

  qs('#menuToggle').addEventListener('click', () => {
    sidebar.classList.toggle('open');
  });

  qs('#logoutBtn').addEventListener('click', async () => {
    try {
      await api('/logout', { method: 'POST' });
    } catch {
      /* ignore */
    }
    clearSession();
    window.location.href = '/login.html';
  });

  async function boot() {
    try {
      const me = await api('/me');
      user = me;
      setSession(Isoft.getToken(), user);
    } catch {
      clearSession();
      window.location.href = '/login.html';
      return;
    }
    renderUser();
    applyRoleVisibility();
    startHeartbeat();
    const hash = (location.hash || '').replace('#', '');
    await navigate(PAGE_META[hash] ? hash : 'inventario');
  }

  window.addEventListener('hashchange', () => {
    const hash = (location.hash || '').replace('#', '');
    if (PAGE_META[hash] && hash !== currentPage) navigate(hash);
  });

  boot();
})();
