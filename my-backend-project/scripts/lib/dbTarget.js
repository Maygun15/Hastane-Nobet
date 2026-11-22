'use strict';
// Veritabanına yazan betikler için hedef doğrulaması.
//  1) Hedef açıkça verilir: --target=local | staging | production (varsayılan yok).
//  2) Adres hedefe göre ayrı kaynaktan okunur; .env OKUNMAZ (yerel .env üretimi gösteriyor):
//       local      → LOCAL_MONGODB_URI (varsayılan mongodb://127.0.0.1:27018)
//       staging    → STAGING_MONGODB_URI ya da ~/nöbet/.staging-erisim.env (izin 600)
//       production → PRODUCTION_MONGODB_URI + ALLOW_PRODUCTION=1 (onaylı plan)
//  3) BAĞLANTIDAN ÖNCE: adres hedefle uyuşmalı (yerel = localhost; deneme ≠ üretim kümesi).
//  4) BAĞLANTIDAN SONRA, YAZMADAN ÖNCE: ops_meta.environment işareti hedefle aynı olmalı.
// Adresler hiçbir çıktıda görünmez (maskeleme: describe()).
const fs = require('fs');
const os = require('os');
const path = require('path');

const PROD_MARKERS = (process.env.PROD_HOST_MARKERS || 'gqsquu8').split(',').filter(Boolean);
const ACCESS_FILE = process.env.STAGING_ACCESS_FILE || path.join(os.homedir(), 'nöbet', '.staging-erisim.env');
const TARGETS = ['local', 'staging', 'production'];

function hostOf(uri) {
  const m = String(uri || '').match(/^mongodb(?:\+srv)?:\/\/(?:[^@/]*@)?([^/?]+)/);
  return m ? m[1] : '';
}
function maskedHost(uri) {
  const h = hostOf(uri);
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(h)) return h;
  return h.replace(/^[^.]+/, '<küme>');
}
function readAccessFile(file = ACCESS_FILE) {
  if (!fs.existsSync(file)) return {};
  const st = fs.statSync(file);
  if ((st.mode & 0o077) !== 0) throw new Error(`erişim dosyası başkalarınca okunabilir (izin ${(st.mode & 0o777).toString(8)}); chmod 600 ${file}`);
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return out;
}

function parseTarget(argv = process.argv) {
  const a = argv.find((x) => x.startsWith('--target='));
  const t = a ? a.split('=')[1] : process.env.DB_TARGET;
  if (!TARGETS.includes(t)) throw new Error(`hedef belirtilmeli: --target=${TARGETS.join('|')}`);
  return t;
}

function uriFor(target) {
  if (target === 'local') return process.env.LOCAL_MONGODB_URI || 'mongodb://127.0.0.1:27018';
  if (target === 'staging') return process.env.STAGING_MONGODB_URI || readAccessFile().STAGING_MONGODB_URI || '';
  if (target === 'production') return process.env.PRODUCTION_MONGODB_URI || '';
  return '';
}

/** Bağlantı öncesi kontrol. Uyuşmazlıkta hata fırlatır. */
function preflight(target, uri) {
  if (!uri) throw new Error(`${target}: bağlantı adresi yok (${target === 'staging' ? ACCESS_FILE + ' → STAGING_MONGODB_URI' : target.toUpperCase() + '_MONGODB_URI'})`);
  const h = hostOf(uri);
  const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(h.split(',')[0]);
  const isProd = PROD_MARKERS.some((m) => h.includes(m));
  if (target === 'local' && !isLocal) throw new Error('local hedefi yalnız localhost olabilir');
  if (target === 'staging' && (isLocal || isProd)) throw new Error(`staging hedefi ${isProd ? 'üretim kümesini' : 'yerel sunucuyu'} gösteriyor (${maskedHost(uri)})`);
  if (target === 'production') {
    if (!isProd) throw new Error('production hedefi üretim kümesi değil');
    if (process.env.ALLOW_PRODUCTION !== '1') throw new Error('üretim için ALLOW_PRODUCTION=1 ve onaylı plan gerekir');
  }
  return { target, host: maskedHost(uri) };
}

/** Bağlantı sonrası, yazmadan önce: veritabanı ortam işareti hedefle aynı mı. */
async function assertMarker(db, target, { initIfMissing = false } = {}) {
  const col = db.collection('ops_meta');
  const doc = await col.findOne({ _id: 'environment' });
  if (!doc) {
    if (!initIfMissing) throw new Error(`veritabanında ortam işareti yok; önce: node scripts/setEnvironmentMarker.js --target=${target}`);
    await col.insertOne({ _id: 'environment', name: target, setAt: new Date(), setBy: 'setEnvironmentMarker' });
    return { marker: target, created: true };
  }
  if (doc.name !== target) throw new Error(`ortam işareti "${doc.name}", hedef "${target}" — yazma iptal`);
  return { marker: doc.name, created: false };
}

/** Hedefi çözer, ön kontrolü yapar, bağlanır, işareti doğrular. */
async function connectTarget({ argv = process.argv, dbName = process.env.DB_NAME_OVERRIDE || 'hastane', initMarker = false, readOnly = false } = {}) {
  const mongoose = require('mongoose');
  const target = parseTarget(argv);
  const uri = uriFor(target);
  const info = preflight(target, uri);
  const conn = await mongoose.createConnection(uri, { dbName, serverSelectionTimeoutMS: 15000, autoIndex: false }).asPromise();
  let marker = null;
  try {
    marker = readOnly
      ? { marker: (await conn.db.collection('ops_meta').findOne({ _id: 'environment' }))?.name || null }
      : await assertMarker(conn.db, target, { initIfMissing: initMarker });
  } catch (e) { await conn.close(); throw e; }
  return { conn, db: conn.db, target, host: info.host, marker: marker.marker, markerCreated: !!marker.created, uri };
}

module.exports = { TARGETS, hostOf, maskedHost, readAccessFile, parseTarget, uriFor, preflight, assertMarker, connectTarget, ACCESS_FILE };
