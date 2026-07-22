(() => {
  const TOKEN_KEY = "sisoft_ctrl_token";
  const USER_KEY = "sisoft_ctrl_user";

  if (localStorage.getItem(TOKEN_KEY)) {
    window.location.replace("/painel.html");
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

    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: form.username.value.trim(),
          password: form.password.value
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Não foi possível entrar.");
      localStorage.setItem(TOKEN_KEY, data.token);
      localStorage.setItem(USER_KEY, JSON.stringify(data.user || {}));
      window.location.href = "/painel.html";
    } catch (err) {
      msg.textContent = err.message || "Erro de ligação.";
      submitBtn.disabled = false;
      submitBtn.textContent = "Entrar no painel";
    }
  });
})();
