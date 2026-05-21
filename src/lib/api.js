// src/lib/api.js — Vite uyumlu, sağlamlaştırılmış

/* ========= BASE ========= */
import { getApiBase, assertProdWriteAllowed } from "./apiConfig.js";
export const REQUIRE_BACKEND = (import.meta?.env?.VITE_REQUIRE_BACKEND || "true") === "true";

// Route prefix — admin/invite gibi kök yollar için boş
const AUTH_PREFIX = ''; // admin/invite gibi kök yollar için

let inMemoryToken = '';
let inMemoryRefreshToken = '';

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
export function getRefreshToken() {
  try {
    return inMemoryRefreshToken || localStorage.getItem('refreshToken') || '';
  } catch {
    return inMemoryRefreshToken || '';
  }
}
export function setRefreshToken(token) {
  inMemoryRefreshToken = token || '';
  try {
    if (token) localStorage.setItem('refreshToken', token);
    else localStorage.removeItem('refreshToken');
  } catch {}
}

/* ========= FETCH HELPERS ========= */
async function safeJson(resp) {
  const text = await resp.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (e) {
    throw e;
  }
}
async function okOrThrow(resp) {
  const data = await safeJson(resp);
  if (!resp.ok) {
    const msg = resp.status === 429
      ? "Çok fazla istek, lütfen daha sonra tekrar deneyin"
      : (data && (data.message || data.error)) || `HTTP ${resp.status}`;
    const err = new Error(msg);
    err.status = resp.status;
    err.data = data;
    err.originalMessage = msg;
    throw err;
  }
  return data;
}

async function attemptTokenRefresh() {
  const rt = getRefreshToken();
  if (!rt) return false;
  try {
    const base = getApiBase().replace(/\/+$/, "");
    const resp = await fetch(`${base}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: rt }),
    });
    if (!resp.ok) return false;
    const data = await resp.json();
    if (data?.accessToken) {
      setToken(data.accessToken);
      return true;
    }
    return false;
  } catch {
    return false;
  }
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

function normalizeCompatPath(path = '') {
  const raw = String(path || '');
  if (!raw.startsWith('/api/schedules?')) return raw;
  try {
    const url = new URL(raw, 'http://localhost');
    if (!url.searchParams.get('sectionId')) {
      url.searchParams.set('sectionId', 'calisma-cizelgesi');
    }
    return `${url.pathname}${url.search}`;
  } catch {
    return raw;
  }
}

// tek path için istek
async function req(path, { method = 'GET', body, headers, timeoutMs, retries, signal, credentials } = {}) {
  const normalizedPath = normalizeCompatPath(path);
  const effectiveRetries = retries ?? (method === 'GET' ? 2 : 0);
  const base = getApiBase().replace(/\/+$/, "");
  assertProdWriteAllowed(normalizedPath, method);
  const url = `${base}${normalizedPath}`;
  const isAuthPath = normalizedPath.includes('/auth/refresh') || normalizedPath.includes('/auth/login') || normalizedPath.includes('/auth/me');

  function buildOpts() {
    return {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
        ...(headers || {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      ...(credentials ? { credentials } : {}),
      ...(signal ? { signal } : {}),
    };
  }

  let lastErr;
  for (let i = 0; i <= effectiveRetries; i++) {
    try {
      return await withTimeout(fetch(url, buildOpts()), timeoutMs).then(okOrThrow);
    } catch (err) {
      if (err?.status === 401 && !isAuthPath) {
        const refreshed = await attemptTokenRefresh();
        if (refreshed) {
          try {
            return await withTimeout(fetch(url, buildOpts()), timeoutMs).then(okOrThrow);
          } catch (retryErr) {
            if (retryErr?.status === 401) {
              try { window.dispatchEvent(new Event("auth:logout")); } catch {}
            }
            throw retryErr;
          }
        }
        try { window.dispatchEvent(new Event("auth:logout")); } catch {}
        throw err;
      }

      if (!err?.status) {
        const raw = String(err?.message || "").trim();
        const networkLike =
          err?.name === "TypeError" ||
          /fetch/i.test(raw) ||
          /network/i.test(raw) ||
          /load failed/i.test(raw) ||
          /failed to fetch/i.test(raw);
        if (networkLike) {
          const wrapped = new Error("Sunucuya bağlanılamadı");
          wrapped.cause = err;
          lastErr = wrapped;
        } else {
          lastErr = err;
        }
      } else {
        lastErr = err;
      }
      // 4xx hatalarında tekrar deneme yapma; 429'u tekrar etmek rate limit'i daha da kötüleştirir
      if (err.status && err.status >= 400 && err.status < 500 && err.status !== 408) {
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
  if (data?.accessToken) {
    setToken(data.accessToken);
    setRefreshToken(data.refreshToken || '');
  } else if (data?.token) {
    setToken(data.token);
  }
  return data;
}

// Giriş: identifier (e-posta / telefon / TCKN / ad) + password
export async function apiLogin({ identifier, password }) {
  const data = await req(`/api/auth/login`, {
    method: 'POST',
    body: { identifier, password }
  });
  if (data?.accessToken) {
    setToken(data.accessToken);
    setRefreshToken(data.refreshToken || '');
  } else if (data?.token) {
    setToken(data.token);
  }
  return data;
}

// /me → backend doğrudan user döndürüyor (wrapper yok)
export const apiMe     = () => req(`/api/auth/me`);
export const apiLogout = async () => {
  const token = getToken();
  if (token) {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: getRefreshToken() }),
      });
    } catch {}
  }
  setToken('');
  setRefreshToken('');
  return { ok: true };
};
export const apiRefreshToken = () => req('/api/auth/refresh', { method: 'POST', body: { refreshToken: getRefreshToken() } });

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
  postTry(
    ['/api/auth/admin/accept-invite', '/api/admin/accept-invite', `${AUTH_PREFIX}/admin/accept-invite`],
    { code }
  );

export const apiStaffAcceptInvite = (code) =>
  postTry(
    ['/api/auth/staff/accept-invite', '/api/staff/accept-invite', `${AUTH_PREFIX}/staff/accept-invite`],
    { code }
  );

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
