(() => {
  const TOKEN_KEY = "sisoft_token";
  const USER_KEY = "sisoft_user";
  const DEVICE_KEY = "sisoft_device_id";

  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) {
    window.location.replace("/login.html");
    return;
  }

  const user = (() => {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY) || "{}");
    } catch {
      return {};
    }
  })();

  const deviceId = localStorage.getItem(DEVICE_KEY) || "unknown";
  const userLabel = document.getElementById("user-label");
  const logoutBtn = document.getElementById("logout-btn");
  const viewTitle = document.getElementById("view-title");
  const viewLead = document.getElementById("view-lead");
  const viewContent = document.getElementById("view-content");
  const navLinks = document.querySelectorAll(".app-nav a");

  userLabel.textContent = user.fullName || user.username || "Utilizador";

  async function api(path) {
    const res = await fetch(path, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Device-Id": deviceId,
        "X-Device-Label": encodeURIComponent("Navegador web")
      }
    });
    if (res.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      window.location.replace("/login.html");
      throw new Error("Sessão expirada");
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Erro ao carregar dados.");
    return data;
  }

  function money(value) {
    const n = Number(value || 0);
    return n.toLocaleString("pt-PT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function table(headers, rows) {
    if (!rows.length) {
      return `<div class="empty">Sem registos para mostrar.</div>`;
    }
    return `
      <div class="table-wrap">
        <table>
          <thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
          <tbody>
            ${rows
              .map(
                (cols) =>
                  `<tr>${cols.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>`;
  }

  const views = {
    resumo: {
      title: "Resumo",
      lead: "Visão geral da operação.",
      async render() {
        const summary = await api("/api/summary");
        viewContent.innerHTML = `
          <div class="stats">
            <div class="stat"><span>Produtos</span><strong>${escapeHtml(
              summary.totalItems ?? 0
            )}</strong></div>
            <div class="stat"><span>Valor de venda</span><strong>${money(
              summary.saleTotal ?? summary.totalValue
            )} MT</strong></div>
            <div class="stat"><span>Lucro estimado</span><strong>${money(
              summary.profitTotal
            )} MT</strong></div>
          </div>
          <p class="lead">Use o menu para consultar stock, obras, clientes e documentos.</p>
        `;
      }
    },
    stock: {
      title: "Stock",
      lead: "Inventário de materiais.",
      async render() {
        const data = await api("/api/items");
        const list = Array.isArray(data) ? data : data.items || [];
        viewContent.innerHTML = table(
          ["Nome", "Qtd", "Preço", "Fornecedor"],
          list.map((item) => [
            item.name || "—",
            item.quantity ?? "—",
            item.price != null ? `${money(item.price)} MT` : "—",
            item.supplierName || "—"
          ])
        );
      }
    },
    obras: {
      title: "Obras",
      lead: "Projectos e acompanhamento.",
      async render() {
        const data = await api("/api/obras");
        const list = Array.isArray(data) ? data : data.obras || [];
        viewContent.innerHTML = table(
          ["Cliente", "Viatura", "Matrícula", "Serviço"],
          list.map((o) => [
            o.client || o.name || "—",
            [o.brand, o.model].filter(Boolean).join(" ") || "—",
            o.plate || "—",
            o.serviceDescription || "—"
          ])
        );
      }
    },
    clientes: {
      title: "Clientes",
      lead: "Cadastro de clientes.",
      async render() {
        const data = await api("/api/clientes");
        const list = Array.isArray(data) ? data : data.clientes || [];
        viewContent.innerHTML = table(
          ["Nome", "Telefone", "Email", "Morada"],
          list.map((c) => [c.name || "—", c.phone || "—", c.email || "—", c.address || "—"])
        );
      }
    },
    facturas: {
      title: "Facturas",
      lead: "Documentos de faturação.",
      async render() {
        const data = await api("/api/facturas");
        const list = Array.isArray(data) ? data : data.facturas || [];
        viewContent.innerHTML = table(
          ["Número", "Cliente", "Total", "Estado"],
          list.map((f) => [
            f.number || f.id || "—",
            f.client || "—",
            f.totals?.total != null ? `${money(f.totals.total)} MT` : "—",
            f.status || f.issueDate || "—"
          ])
        );
      }
    },
    cotacoes: {
      title: "Cotações",
      lead: "Propostas comerciais.",
      async render() {
        const data = await api("/api/cotacoes");
        const list = Array.isArray(data) ? data : data.cotacoes || [];
        viewContent.innerHTML = table(
          ["Número", "Cliente", "Total", "Estado"],
          list.map((c) => [
            c.number || c.id || "—",
            c.client || "—",
            c.totals?.total != null ? `${money(c.totals.total)} MT` : "—",
            c.status || "—"
          ])
        );
      }
    }
  };

  async function showView(name) {
    const view = views[name] || views.resumo;
    navLinks.forEach((link) => {
      link.classList.toggle("is-active", link.dataset.view === name);
    });
    viewTitle.textContent = view.title;
    viewLead.textContent = view.lead;
    viewContent.innerHTML = `<div class="empty">A carregar…</div>`;
    try {
      await view.render();
    } catch (err) {
      viewContent.innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`;
    }
  }

  navLinks.forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const name = link.dataset.view;
      history.replaceState(null, "", `#${name}`);
      showView(name);
    });
  });

  logoutBtn.addEventListener("click", async () => {
    try {
      await fetch("/api/logout", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Device-Id": deviceId
        }
      });
    } catch {
      /* ignore */
    }
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    window.location.href = "/login.html";
  });

  const initial = (location.hash || "#resumo").replace("#", "") || "resumo";
  showView(views[initial] ? initial : "resumo");

  // Keep session alive
  setInterval(() => {
    fetch("/api/heartbeat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "X-Device-Id": deviceId,
        "X-Device-Label": encodeURIComponent("Navegador web")
      },
      body: JSON.stringify({ currentPage: "historico" })
    }).catch(() => {});
  }, 60000);
})();
