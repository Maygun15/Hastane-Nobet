// src/lib/api.js — Vite uyumlu, sağlamlaştırılmış

/* ========= BASE ========= */
export const REQUIRE_BACKEND = (import.meta.env.VITE_REQUIRE_BACKEND || 'true') === 'true';
const API_BASE = (import.meta.env.VITE_API_BASE || 'https://hastane-backend-production.up.railway.app')
  .replace(/\/+$/, ''); // sondaki /'ları sil

// Route prefix — admin/invite gibi kök yollar için boş
const AUTH_PREFIX = ''; // admin/invite gibi kök yollar için

let inMemoryToken = '';

/* ========= TOKEN ========= */
export function getToken() {
  try {
    return (
      inMemoryToken ||
      localStorage.getItem('authToken') ||
      localStorage.getItem('token') ||
      ''
    );
  } catch {
    return inMemoryToken || '';
  }
}
export function setToken(token) {
  inMemoryToken = token || '';
  try {
    if (token) {
      localStorage.setItem('authToken', token);
      localStorage.setItem('token', token); // eski client uyumu
    } else {
      localStorage.removeItem('authToken');
      localStorage.removeItem('token');
    }
  } catch {}
}

/* ========= FETCH HELPERS ========= */
async function safeJson(resp) {
  const text = await resp.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}
async function okOrThrow(resp) {
  const data = await safeJson(resp);
  if (!resp.ok) {
    const msg = (data && (data.message || data.error)) || `HTTP ${resp.status}`;
    throw new Error(msg);
  }
  return data;
}
function authHeaders() {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

// basit timeout (opsiyonel)
function withTimeout(promise, ms = 20000) {
  let t;
  const timeout = new Promise((_res, rej) => {
    t = setTimeout(() => rej(new Error('İstek zaman aşımına uğradı')), ms);
  });
  return Promise.race([promise.finally(() => clearTimeout(t)), timeout]);
}

// tek path için istek
function req(path, { method = 'GET', body, headers, timeoutMs } = {}) {
  const f = fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...(headers || {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return withTimeout(f, timeoutMs).then(okOrThrow);
}

// dışarı da ver (bazı bileşenlerde kullanışlı)
export const http = {
  req,
  get: (p, opt) => req(p, { method: 'GET', ...(opt || {}) }),
  post: (p, body, opt) => req(p, { method: 'POST', body, ...(opt || {}) }),
};

/* ========= Çoklu path dene (fallback) ========= */
async function postTry(paths, body, opts = {}) {
  let lastErr;
  for (const p of paths) {
    try {
      return await req(p, { method: 'POST', body, ...opts });
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('Uygun uç bulunamadı');
}

/* ========= HEALTH ========= */
export const apiHealth = () => req('/health');

/* ========= AUTH ========= */
// Kayıt: name, tc, phone, email, password
export async function apiRegister({ email, phone, tc, name, password }) {
  const data = await req(`/api/auth/register`, {
    method: 'POST',
    body: { email, phone, tc, name, password }
  });
  if (data?.token) setToken(data.token);
  return data;
}

// Giriş: identifier (e-posta / telefon / TCKN / ad) + password
export async function apiLogin({ identifier, password }) {
  const data = await req(`/api/auth/login`, {
    method: 'POST',
    body: { identifier, password }
  });
  if (data?.token) setToken(data.token);
  return data;
}

// /me → backend doğrudan user döndürüyor (wrapper yok)
export const apiMe     = () => req(`/api/auth/me`);
export const apiLogout = () => { setToken(''); return Promise.resolve({ ok: true }); };

/* ========= PASSWORD RESET ========= */
export const apiRequestReset  = (email) =>
  req(`/api/auth/password/request-reset`, { method: 'POST', body: { email } });
export const apiResetPassword = (token, newPassword) =>
  req(`/api/auth/password/reset`, { method: 'POST', body: { token, newPassword } });

export const apiChangePassword = (oldPassword, newPassword) =>
  req('/api/auth/password/change', { method: 'POST', body: { oldPassword, newPassword } });

/* ========= INVITES (iki farklı backend yolu için tolerans) ========= */
// Önce /api/... dener, yoksa köke düşer (veya tersi). AUTH_PREFIX boş olduğu için
// ikinci path doğrudan '/admin/accept-invite' vb. olacaktır.
export const apiAdminAcceptInvite = (code) =>
  postTry([`${AUTH_PREFIX}/admin/accept-invite`, '/api/admin/accept-invite'], { code });

export const apiStaffAcceptInvite = (code) =>
  postTry([`${AUTH_PREFIX}/staff/accept-invite`, '/api/staff/accept-invite'], { code });

/* ========= ADMIN (opsiyonel örnek) ========= */
export const apiSetUserServices = (userId, serviceIds) =>
  req(`/api/users/${userId}/services`, { method: 'PATCH', body: { serviceIds } });

/* ========= AI (opsiyonel) ========= */
export const apiAiPing = () => req('/api/ai/ping');

/* ========= Convenience ========= */
export const API = {
  base: API_BASE,
  health: apiHealth,
  register: apiRegister,
  login: apiLogin,
  me: apiMe,
  logout: apiLogout,
  requestReset: apiRequestReset,
  resetPassword: apiResetPassword,
  changePassword: apiChangePassword,
  adminAcceptInvite: apiAdminAcceptInvite,
  staffAcceptInvite: apiStaffAcceptInvite,
  setUserServices: apiSetUserServices,
  aiPing: apiAiPing,
  http,
};
