(() => {
  const TOKEN_KEY = "sisoft_ctrl_token";
  const USER_KEY = "sisoft_ctrl_user";
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

  const userLabel = document.getElementById("user-label");
  const logoutBtn = document.getElementById("logout-btn");
  const viewTitle = document.getElementById("view-title");
  const viewLead = document.getElementById("view-lead");
  const viewContent = document.getElementById("view-content");
  const navLinks = document.querySelectorAll(".app-nav a");

  userLabel.textContent = user.fullName || user.username || "Utilizador";

  async function api(path, options = {}) {
    const res = await fetch(path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(options.headers || {})
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

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  const views = {
    resumo: {
      title: "Resumo",
      lead: "Visão geral do controlo Sisoft.",
      async render() {
        const summary = await api("/api/summary");
        viewContent.innerHTML = `
          <div class="stats">
            <div class="stat"><span>Pedidos novos</span><strong>${escapeHtml(
              summary.leadsNew
            )}</strong></div>
            <div class="stat"><span>Total de pedidos</span><strong>${escapeHtml(
              summary.leadsTotal
            )}</strong></div>
            <div class="stat"><span>Clientes</span><strong>${escapeHtml(
              summary.clientsTotal
            )}</strong></div>
          </div>
          <p class="lead">Este painel é exclusivo da Sisoft e não está ligado ao Isoft.</p>
        `;
      }
    },
    pedidos: {
      title: "Pedidos",
      lead: "Pedidos recebidos pelo site.",
      async render() {
        const list = await api("/api/leads");
        if (!list.length) {
          viewContent.innerHTML = `<div class="empty">Ainda não há pedidos.</div>`;
          return;
        }
        viewContent.innerHTML = `
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Serviço</th>
                  <th>Contacto</th>
                  <th>Estado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                ${list
                  .map(
                    (lead) => `
                  <tr>
                    <td>
                      <strong>${escapeHtml(lead.name)}</strong><br />
                      <small>${escapeHtml(lead.message)}</small>
                    </td>
                    <td>${escapeHtml(lead.service || "—")}</td>
                    <td>${escapeHtml(lead.phone || lead.email || "—")}</td>
                    <td>
                      <select data-lead-status="${lead.id}">
                        ${["novo", "em análise", "contactado", "fechado"]
                          .map(
                            (status) =>
                              `<option value="${status}" ${
                                lead.status === status ? "selected" : ""
                              }>${status}</option>`
                          )
                          .join("")}
                      </select>
                    </td>
                    <td><button type="button" data-del-lead="${lead.id}">Apagar</button></td>
                  </tr>`
                  )
                  .join("")}
              </tbody>
            </table>
          </div>`;

        viewContent.querySelectorAll("[data-lead-status]").forEach((select) => {
          select.addEventListener("change", async () => {
            await api(`/api/leads/${select.dataset.leadStatus}`, {
              method: "PUT",
              body: JSON.stringify({ status: select.value })
            });
          });
        });
        viewContent.querySelectorAll("[data-del-lead]").forEach((btn) => {
          btn.addEventListener("click", async () => {
            if (!confirm("Apagar este pedido?")) return;
            await api(`/api/leads/${btn.dataset.delLead}`, { method: "DELETE" });
            showView("pedidos");
          });
        });
      }
    },
    clientes: {
      title: "Clientes",
      lead: "Clientes registados no controlo Sisoft.",
      async render() {
        const list = await api("/api/clients");
        viewContent.innerHTML = `
          <form class="inline-form" id="client-form">
            <input name="name" placeholder="Nome" required />
            <input name="phone" placeholder="Telefone" />
            <input name="email" placeholder="Email" />
            <button class="btn btn-signal" type="submit">Adicionar</button>
          </form>
          <div class="table-wrap" style="margin-top:1rem">
            <table>
              <thead><tr><th>Nome</th><th>Telefone</th><th>Email</th><th></th></tr></thead>
              <tbody>
                ${
                  list.length
                    ? list
                        .map(
                          (c) => `<tr>
                      <td>${escapeHtml(c.name)}</td>
                      <td>${escapeHtml(c.phone || "—")}</td>
                      <td>${escapeHtml(c.email || "—")}</td>
                      <td><button type="button" data-del-client="${c.id}">Apagar</button></td>
                    </tr>`
                        )
                        .join("")
                    : `<tr><td colspan="4" class="empty">Sem clientes.</td></tr>`
                }
              </tbody>
            </table>
          </div>`;

        document.getElementById("client-form").addEventListener("submit", async (event) => {
          event.preventDefault();
          const form = event.target;
          await api("/api/clients", {
            method: "POST",
            body: JSON.stringify({
              name: form.name.value.trim(),
              phone: form.phone.value.trim(),
              email: form.email.value.trim()
            })
          });
          showView("clientes");
        });
        viewContent.querySelectorAll("[data-del-client]").forEach((btn) => {
          btn.addEventListener("click", async () => {
            if (!confirm("Apagar este cliente?")) return;
            await api(`/api/clients/${btn.dataset.delClient}`, { method: "DELETE" });
            showView("clientes");
          });
        });
      }
    },
    servicos: {
      title: "Serviços",
      lead: "Catálogo de serviços Sisoft.",
      async render() {
        const list = await api("/api/services");
        viewContent.innerHTML = `
          <div class="table-wrap">
            <table>
              <thead><tr><th>Serviço</th><th>Descrição</th></tr></thead>
              <tbody>
                ${list
                  .map(
                    (s) =>
                      `<tr><td>${escapeHtml(s.name)}</td><td>${escapeHtml(
                        s.description || "—"
                      )}</td></tr>`
                  )
                  .join("")}
              </tbody>
            </table>
          </div>`;
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
      await api("/api/logout", { method: "POST" });
    } catch {
      /* ignore */
    }
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    window.location.href = "/login.html";
  });

  const initial = (location.hash || "#resumo").replace("#", "") || "resumo";
  showView(views[initial] ? initial : "resumo");
})();
