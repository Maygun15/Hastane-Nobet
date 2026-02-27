// src/lib/api.js — Vite uyumlu, sağlamlaştırılmış

/* ========= BASE ========= */
import { getApiBase, assertProdWriteAllowed } from "./apiConfig.js";
export const REQUIRE_BACKEND = (import.meta.env.VITE_REQUIRE_BACKEND || "true") === "true";

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
    const err = new Error(msg);
    err.status = resp.status;
    throw err;
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
async function req(path, { method = 'GET', body, headers, timeoutMs, retries } = {}) {
  const effectiveRetries = retries ?? (method === 'GET' ? 2 : 0);
  assertProdWriteAllowed(path, method);
  const base = getApiBase().replace(/\/+$/, "");
  const url = `${base}${path}`;
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...(headers || {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  };

  let lastErr;
  for (let i = 0; i <= effectiveRetries; i++) {
    try {
      const f = fetch(url, opts);
      return await withTimeout(f, timeoutMs).then(okOrThrow);
    } catch (err) {
      lastErr = err;
      // 4xx hatalarında (429 ve 408 hariç) tekrar deneme yapma
      if (err.status && err.status >= 400 && err.status < 500 && err.status !== 429 && err.status !== 408) {
        throw err;
      }
      if (i === effectiveRetries) break;
      // Exponential backoff: 500ms, 1000ms, 2000ms...
      await new Promise((r) => setTimeout(r, 500 * Math.pow(2, i)));
    }
  }
  throw lastErr;
}

// dışarı da ver (bazı bileşenlerde kullanışlı)
export const http = {
  req,
  get: (p, opt) => req(p, { method: 'GET', ...(opt || {}) }),
  post: (p, body, opt) => req(p, { method: 'POST', body, ...(opt || {}) }),
  put: (p, body, opt) => req(p, { method: 'PUT', body, ...(opt || {}) }),
  patch: (p, body, opt) => req(p, { method: 'PATCH', body, ...(opt || {}) }),
  delete: (p, opt) => req(p, { method: 'DELETE', ...(opt || {}) }),
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
  base: getApiBase(),
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
