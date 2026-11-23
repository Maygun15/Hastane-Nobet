'use strict';
const { presentStatus } = require('../scripts/lib/backupResult');
// Dağıtım kimliği ve hazırlık durumu — hassas bilgi içermez (adres, kullanıcı, sır yok).
//   commit: Render'ın derleme ortamındaki RENDER_GIT_COMMIT (yoksa .build-commit / git)
//   environment: veritabanındaki ops_meta {_id:'environment'} işareti (local/staging/production)
//   ready: güvence veren dizinler veritabanında var mı (üretimde autoIndex kapalı)
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const mongoose = require('mongoose');

let cachedCommit;
function buildCommit() {
  if (cachedCommit !== undefined) return cachedCommit;
  let c = process.env.RENDER_GIT_COMMIT || process.env.SOURCE_COMMIT || process.env.GIT_COMMIT || '';
  if (!c) {
    try { c = fs.readFileSync(path.join(__dirname, '..', '.build-commit'), 'utf8').trim(); } catch { /* yok */ }
  }
  if (!c) {
    try { c = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: __dirname, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* git yok */ }
  }
  cachedCommit = /^[0-9a-f]{7,40}$/i.test(c) ? c.slice(0, 12) : null;
  return cachedCommit;
}

// Uygulamanın verdiği güvenceler ve dayandıkları dizinler.
const REQUIRED_INDEXES = [
  { guarantee: 'requestIdempotency', label: 'Talep tekrar gönderiminde tek kayıt', collection: 'requests', key: { fromUserId: 1, clientRequestId: 1 }, unique: true },
  { guarantee: 'scheduleHistory', label: 'İşlem geçmişi sorgusu', collection: 'schedulechanges', key: { hospitalId: 1, sectionId: 1, serviceId: 1, role: 1, year: 1, month: 1, at: -1 } },
  { guarantee: 'scheduleHistory', label: 'Yayın sürümü sorgusu', collection: 'schedulechanges', key: { hospitalId: 1, sectionId: 1, serviceId: 1, role: 1, year: 1, month: 1, kind: 1, publishVersion: -1 } },
  { guarantee: 'publishOnce', label: 'Aynı yayın sürümü bir kez', collection: 'schedulechanges', key: { hospitalId: 1, sectionId: 1, serviceId: 1, role: 1, year: 1, month: 1, publishVersion: 1 }, unique: true },
  { guarantee: 'revisionNotificationOnce', label: 'Revizyon bildirimi bir kez', collection: 'notifications', key: { dedupeKey: 1 }, unique: true },
];

const sameKey = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function checkIndexes(db = mongoose.connection?.db) {
  if (!db) return { ok: false, error: 'veritabanı bağlı değil', missing: REQUIRED_INDEXES.map((r) => r.label) };
  const byCol = {};
  const missing = [];
  for (const req of REQUIRED_INDEXES) {
    if (!byCol[req.collection]) byCol[req.collection] = await db.collection(req.collection).indexes().catch(() => []);
    const found = byCol[req.collection].find((ix) => sameKey(ix.key, req.key));
    if (!found || (req.unique && !found.unique)) missing.push({ guarantee: req.guarantee, label: req.label, collection: req.collection });
  }
  const guarantees = {};
  for (const req of REQUIRED_INDEXES) {
    if (guarantees[req.guarantee] === 'eksik') continue;
    guarantees[req.guarantee] = missing.some((m) => m.guarantee === req.guarantee) ? 'eksik' : 'tam';
  }
  return { ok: missing.length === 0, missing, guarantees };
}

let readyCache = { at: 0, value: null };
async function readiness({ maxAgeMs = 60000 } = {}) {
  if (readyCache.value && Date.now() - readyCache.at < maxAgeMs) return readyCache.value;
  const value = await checkIndexes();
  readyCache = { at: Date.now(), value };
  return value;
}
function invalidateReadiness() { readyCache = { at: 0, value: null }; }

async function environmentMarker(db = mongoose.connection?.db) {
  if (!db) return null;
  const doc = await db.collection('ops_meta').findOne({ _id: 'environment' }).catch(() => null);
  return doc?.name || null;
}

async function backupStatus(db = mongoose.connection?.db) {
  if (!db) return null;
  const d = await db.collection('ops_meta').findOne({ _id: 'backupStatus' }).catch(() => null);
  return presentStatus(d);
}

async function versionInfo() {
  const connected = mongoose.connection?.readyState === 1;
  return {
    backup: connected ? await backupStatus() : null,
    commit: buildCommit(),
    branch: process.env.RENDER_GIT_BRANCH || null,
    nodeEnv: process.env.NODE_ENV || 'development',
    db: { connected, name: connected ? mongoose.connection.name : null, environment: connected ? await environmentMarker() : null },
    ready: connected ? await readiness() : { ok: false, error: 'veritabanı bağlı değil' },
  };
}

module.exports = { backupStatus, buildCommit, REQUIRED_INDEXES, checkIndexes, readiness, invalidateReadiness, environmentMarker, versionInfo };
