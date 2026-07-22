(function (global) {
  const TOKEN_KEY = 'isoft_token';
  const USER_KEY = 'isoft_user';
  const DEVICE_ID_KEY = 'isoft_device_id';
  const DEVICE_LABEL_KEY = 'isoft_device_label';

  function getDeviceId() {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = `web-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  }

  function getDeviceLabel() {
    let label = localStorage.getItem(DEVICE_LABEL_KEY);
    if (!label) {
      const ua = navigator.userAgent || 'Browser';
      if (/Android/i.test(ua)) label = 'Android';
      else if (/iPhone|iPad|iPod/i.test(ua)) label = 'iOS';
      else if (/Windows/i.test(ua)) label = 'Windows';
      else if (/Mac/i.test(ua)) label = 'Mac';
      else if (/Linux/i.test(ua)) label = 'Linux';
      else label = 'Navegador';
      localStorage.setItem(DEVICE_LABEL_KEY, label);
    }
    return label;
  }

  function getToken() {
    return localStorage.getItem(TOKEN_KEY) || '';
  }

  function getUser() {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
    } catch {
      return null;
    }
  }

  function setSession(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }

  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  function requireAuth() {
    const token = getToken();
    if (!token) {
      window.location.href = '/login.html';
      return false;
    }
    return true;
  }

  async function api(path, options = {}) {
    const headers = Object.assign(
      {
        'Content-Type': 'application/json',
        'X-Device-Id': getDeviceId(),
        'X-Device-Label': encodeURIComponent(getDeviceLabel())
      },
      options.headers || {}
    );

    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    const config = Object.assign({}, options, { headers });
    if (config.body && typeof config.body === 'object' && !(config.body instanceof FormData)) {
      config.body = JSON.stringify(config.body);
    }

    const res = await fetch(`/api${path}`, config);
    const contentType = res.headers.get('content-type') || '';
    let data = null;

    if (contentType.includes('application/json')) {
      data = await res.json().catch(() => null);
    } else if (contentType.includes('application/pdf') || contentType.includes('octet-stream')) {
      data = await res.blob();
    } else {
      data = await res.text().catch(() => null);
    }

    if (res.status === 401 && !String(path).startsWith('/login') && !String(path).startsWith('/recover')) {
      clearSession();
      if (!window.location.pathname.includes('login.html')) {
        window.location.href = '/login.html';
      }
      throw new Error((data && data.error) || 'Sessão expirada.');
    }

    if (!res.ok) {
      const err = new Error((data && data.error) || `Erro ${res.status}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }

    return data;
  }

  function money(value) {
    const n = Number(value) || 0;
    return `${n.toLocaleString('pt-MZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MT`;
  }

  function formatDate(value) {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString('pt-MZ', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function formatDay(value) {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
    return d.toLocaleDateString('pt-MZ');
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function toast(message, type = 'ok') {
    let stack = document.querySelector('.toast-stack');
    if (!stack) {
      stack = document.createElement('div');
      stack.className = 'toast-stack';
      document.body.appendChild(stack);
    }
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    stack.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transition = 'opacity .25s';
      setTimeout(() => el.remove(), 250);
    }, 3200);
  }

  function qs(sel, root = document) {
    return root.querySelector(sel);
  }

  function qsa(sel, root = document) {
    return [...root.querySelectorAll(sel)];
  }

  global.Isoft = {
    api,
    getToken,
    getUser,
    setSession,
    clearSession,
    requireAuth,
    getDeviceId,
    getDeviceLabel,
    money,
    formatDate,
    formatDay,
    escapeHtml,
    toast,
    qs,
    qsa
  };
})(window);
