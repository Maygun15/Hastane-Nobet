// src/api/client.js
const BASE_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const TOKEN_KEY = 'token';

export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
}

export function setToken(t) {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {}
}

async function request(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'include',
    mode: 'cors',
  });

  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }

  if (!res.ok) {
    const msg = (data && data.message) || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

export const api = {
  register: (payload) => request('/api/auth/register', { method: 'POST', body: payload }),
  login: (payload) => request('/api/auth/login', { method: 'POST', body: payload }),
  me: () => request('/api/auth/me'),
  acceptInvite: (code) =>
    request('/api/auth/admin/accept-invite', { method: 'POST', body: { code } }),
  acceptStaffInvite: (code) =>
    request('/api/auth/staff/accept-invite', { method: 'POST', body: { code } }),

  // Çıkış
  logout:   ()         => { setToken(''); return Promise.resolve(); },
};
