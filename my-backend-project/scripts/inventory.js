#!/usr/bin/env node
// Salt-okur envanter: koleksiyon belge sayıları, dizin tanımları, ortam işareti, eski-yeni şema farkı.
// Kişisel veri YAZMAZ: belge içeriği okunmaz, yalnız sayılar ve dizin tanımları.
// Kullanım: node scripts/inventory.js --target=local|staging|production [--json=dosya]
// Üretimde de yalnız okur; dbTarget üretim için yine PRODUCTION_MONGODB_URI + ALLOW_PRODUCTION=1 ister.
'use strict';
const fs = require('fs');
const { connectTarget } = require('./lib/dbTarget');
const { REQUIRED_INDEXES, checkIndexes } = require('../services/deploymentInfo');

const jsonArg = (process.argv.find((a) => a.startsWith('--json=')) || '').split('=').slice(1).join('=');

async function main() {
  const { conn, db, target, host, marker } = await connectTarget({ readOnly: true });
  try {
    const cols = (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name).sort();
    const collections = {};
    let totalDocs = 0;
    for (const name of cols) {
      const col = db.collection(name);
      const count = await col.countDocuments({});
      totalDocs += count;
      const indexes = (await col.indexes()).map((i) => {
        const o = { name: i.name, key: i.key };
        for (const k of ['unique', 'sparse', 'partialFilterExpression', 'expireAfterSeconds']) if (i[k] !== undefined) o[k] = i[k];
        return o;
      });
      collections[name] = { count, indexes };
    }
    // Çok kurumlu yapıdan önceki kayıtlar: hospitalId alanı olmayanlar (yalnız sayı)
    const missingHospital = {};
    for (const name of cols) {
      if (name.startsWith('system.') || name === 'ops_meta') continue;
      const n = await db.collection(name).countDocuments({ $or: [{ hospitalId: { $exists: false } }, { hospitalId: null }] });
      if (n > 0 && collections[name].count > 0) missingHospital[name] = n;
    }
    const required = await checkIndexes(db).catch((e) => ({ error: e.message }));
    const backup = await db.collection('ops_meta').findOne({ _id: 'backupStatus' }, { projection: { _id: 0, 'lastSuccess.runner': 1, 'lastSuccess.backupAt': 1 } });
    const out = {
      at: new Date().toISOString(), target, host, marker,
      collections: cols.length, totalDocs, hospitals: collections.hospitals?.count ?? 0,
      requiredIndexes: required, requiredIndexCount: REQUIRED_INDEXES.length,
      missingHospitalId: missingHospital, backupStatus: backup || null, detail: collections,
    };
    console.log(`[envanter] hedef ${target} (${host}) · işaret: ${marker || 'YOK'} · ${cols.length} koleksiyon · ${totalDocs} belge · hastane ${out.hospitals}`);
    console.log(`[envanter] güvence dizinleri: ${JSON.stringify(required)}`);
    console.log(`[envanter] hospitalId'siz kayıt: ${JSON.stringify(missingHospital)}`);
    if (jsonArg) { fs.writeFileSync(jsonArg, JSON.stringify(out, null, 2), { mode: 0o600 }); console.log(`[envanter] ayrıntı: ${jsonArg}`); }
  } finally {
    await conn.close();
  }
}

main().catch((e) => { console.error('[envanter] HATA:', e.message); process.exit(1); });
