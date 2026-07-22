(() => {
  const TOKEN_KEY = "sisoft_token";
  const USER_KEY = "sisoft_user";
  const DEVICE_KEY = "sisoft_device_id";

  function getOrCreateDeviceId() {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = `web-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  }

  const existing = localStorage.getItem(TOKEN_KEY);
  if (existing) {
    window.location.replace("/app.html");
    return;
  }

  const form = document.getElementById("login-form");
  const msg = document.getElementById("form-msg");
  const submitBtn = document.getElementById("submit-btn");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    msg.textContent = "";
    msg.classList.remove("is-ok");
    submitBtn.disabled = true;
    submitBtn.textContent = "A entrar…";

    const username = String(form.username.value || "").trim();
    const password = String(form.password.value || "");
    const deviceId = getOrCreateDeviceId();

    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Device-Id": deviceId,
          "X-Device-Label": encodeURIComponent("Navegador web")
        },
        body: JSON.stringify({ username, password, deviceId, deviceLabel: "Navegador web" })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Não foi possível entrar.");
      }
      localStorage.setItem(TOKEN_KEY, data.token);
      localStorage.setItem(USER_KEY, JSON.stringify(data.user || {}));
      msg.classList.add("is-ok");
      msg.textContent = "Sessão iniciada.";
      window.location.href = "/app.html";
    } catch (err) {
      msg.textContent = err.message || "Erro de ligação.";
      submitBtn.disabled = false;
      submitBtn.textContent = "Entrar";
    }
  });
})();
