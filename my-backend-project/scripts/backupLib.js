'use strict';
// Yedek / geri yükleme ortak yardımcıları: bağlantı adresi komut satırına yazılmaz (süreç
// listesinde görünmesin), hata metinleri maskelenir, üretim kümesi açık izin olmadan reddedilir.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { redactText } = require('../utils/safeLog');

const PROD_HOST_MARKERS = (process.env.PROD_HOST_MARKERS || 'gqsquu8').split(',').filter(Boolean);

function hostOf(uri) {
  const m = String(uri || '').match(/^mongodb(?:\+srv)?:\/\/(?:[^@/]*@)?([^/?]+)/);
  return m ? m[1] : '';
}
function dbNameOf(uri, fallback) {
  const m = String(uri || '').match(/^mongodb(?:\+srv)?:\/\/[^/]+\/([^?]+)/);
  return (m && decodeURIComponent(m[1])) || fallback;
}
function isProduction(uri) {
  const h = hostOf(uri);
  return PROD_HOST_MARKERS.some((mk) => h.includes(mk));
}
function assertAllowed(uri, { label, allowProdEnv }) {
  if (!uri) throw new Error(`${label}: bağlantı adresi tanımlı değil`);
  if (isProduction(uri) && process.env[allowProdEnv] !== '1') {
    throw new Error(`${label}: üretim kümesi (${hostOf(uri).replace(/^[^.]*/, '<küme>')}) — ${allowProdEnv}=1 olmadan çalışmaz`);
  }
}

/** mongodump/mongorestore'u adres komut satırında görünmeden çalıştırır (--config, 0600). */
function runTool(tool, uri, args) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nobet-yedek-'));
  const cfg = path.join(dir, 'cfg.yaml');
  fs.writeFileSync(cfg, `uri: ${JSON.stringify(uri)}\n`, { mode: 0o600 });
  try {
    const r = spawnSync(tool, [`--config=${cfg}`, ...args], { encoding: 'utf8', timeout: 15 * 60 * 1000 });
    if (r.error) throw new Error(`${tool} çalıştırılamadı: ${redactText(r.error.message)}`);
    if (r.status !== 0) throw new Error(`${tool} hata (${r.status}): ${redactText((r.stderr || '').split('\n').slice(-5).join(' '))}`);
    return redactText(r.stderr || '');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Koleksiyon başına belge sayısı + sıralı _id özetinden SHA-256 (içerik değil, kimlik kümesi). */
async function collectionManifest(uri, dbName) {
  const mongoose = require('mongoose');
  const conn = await mongoose.createConnection(uri, { dbName, serverSelectionTimeoutMS: 10000 }).asPromise();
  try {
    const out = {};
    const cols = (await conn.db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name).filter((n) => !n.startsWith('system.')).sort();
    for (const name of cols) {
      const col = conn.db.collection(name);
      const count = await col.countDocuments();
      const h = crypto.createHash('sha256');
      for await (const d of col.find({}, { projection: { _id: 1 } }).sort({ _id: 1 })) h.update(String(d._id));
      const indexes = (await col.indexes()).map((ix) => `${JSON.stringify(ix.key)}${ix.unique ? ' tekil' : ''}`).sort();
      out[name] = { count, idHash: h.digest('hex').slice(0, 16), indexes };
    }
    return out;
  } finally {
    await conn.close();
  }
}

module.exports = { hostOf, dbNameOf, isProduction, assertAllowed, runTool, collectionManifest };
