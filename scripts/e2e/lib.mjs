// Uçtan uca (E2E) API senaryoları için ortak yardımcılar.
// YALNIZCA yerel deneme ortamında çalışır: API localhost, MongoDB localhost.
// Kullanım: node scripts/e2e/run.mjs   (bkz. docs/COMMERCIAL_READINESS.md → "E2E")
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '../../my-backend-project/package.json'));

export const API = process.env.E2E_API || 'http://localhost:3100';
export const MONGO = process.env.E2E_MONGODB_URI || 'mongodb://127.0.0.1:27018';
const CRED_FILE = process.env.E2E_CRED_FILE || path.join(os.homedir(), 'nöbet/.prova-db/prova-giris.txt');

if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(API)) throw new Error(`E2E yalnız yerel API ile çalışır: ${API}`);
if (!/^mongodb:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(MONGO)) throw new Error('E2E yalnız yerel MongoDB ile çalışır.');

export function credentials(label) {
  const txt = fs.readFileSync(CRED_FILE, 'utf8');
  const m = txt.match(new RegExp(`${label}\\s*:\\s*(\\S+)\\s*/\\s*(\\S+)`));
  if (!m) throw new Error(`Giriş bilgisi bulunamadı: ${label}`);
  return { id: m[1], pw: m[2] };
}

export async function login({ id, pw }) {
  const r = await fetch(`${API}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: id, email: id, password: pw }),
  });
  const j = await r.json().catch(() => ({}));
  const token = j.token || j.accessToken || j?.data?.token;
  if (!token) throw new Error(`giriş başarısız (${r.status})`);
  return token;
}

export async function req(token, method, p, body, headers = {}) {
  const r = await fetch(`${API}${p}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = null;
  try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
}

export const results = [];
export function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
}
export const short = (v) => (v ? String(v).replace(/^kv-/, '').slice(0, 6) : String(v));

let mongoose;
export async function db() {
  if (!mongoose) {
    mongoose = require('mongoose');
    await mongoose.connect(MONGO, { dbName: 'hastane' });
  }
  return mongoose.connection.db;
}
export async function closeDb() {
  if (mongoose) await mongoose.disconnect();
}
