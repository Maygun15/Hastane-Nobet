#!/usr/bin/env node
// scripts/restore-verify.js — yedeği AYRI bir veritabanına geri yükler ve manifest ile karşılaştırır.
// Kullanım: RESTORE_URI=mongodb://127.0.0.1:27018 node scripts/restore-verify.js <arşiv.archive.gz> [hedefDb]
//   hedefDb varsayılan: <kaynakDb>_restore_<zaman>. Kaynak veritabanının ÜZERİNE YAZMAZ (aynı ad reddedilir).
//   --keep: doğrulamadan sonra hedef veritabanını silme (gerçek geri dönüşte kullanılır).
//   Üretim kümesine geri yükleme için RESTORE_ALLOW_PROD=1 gerekir (yalnız onaylı geri dönüş planında).
'use strict';
const fs = require('fs');
const { assertAllowed, runTool, collectionManifest } = require('./backupLib');

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const keep = process.argv.includes('--keep');
  const [archive, target] = args;
  if (!archive || !fs.existsSync(archive)) throw new Error('arşiv dosyası bulunamadı');
  const manifest = JSON.parse(fs.readFileSync(`${archive}.manifest.json`, 'utf8'));
  const uri = process.env.RESTORE_URI;
  assertAllowed(uri, { label: 'geri yükleme', allowProdEnv: 'RESTORE_ALLOW_PROD' });
  const dbName = target || `${manifest.db}_restore_${Date.now().toString(36)}`;
  if (dbName === manifest.db && !keep) throw new Error('hedef veritabanı kaynakla aynı; doğrulama için farklı ad verin');

  console.log(`[geri-yükle] ${manifest.archive} → ${dbName}`);
  runTool('mongorestore', uri, [`--archive=${archive}`, '--gzip', `--nsFrom=${manifest.db}.*`, `--nsTo=${dbName}.*`, '--drop']);
  const got = await collectionManifest(uri, dbName);
  const diffs = [];
  for (const [name, exp] of Object.entries(manifest.collections)) {
    const g = got[name];
    if (!g) diffs.push(`${name}: eksik`);
    else if (g.count !== exp.count || g.idHash !== exp.idHash) diffs.push(`${name}: beklenen ${exp.count}/${exp.idHash}, gelen ${g.count}/${g.idHash}`);
  }
  const total = Object.values(got).reduce((s, c) => s + c.count, 0);
  if (!keep) {
    const mongoose = require('mongoose');
    const conn = await mongoose.createConnection(uri, { dbName }).asPromise();
    await conn.db.dropDatabase();
    await conn.close();
  }
  if (diffs.length) { console.error(`[geri-yükle] UYUŞMAZLIK (${diffs.length}):\n  ${diffs.join('\n  ')}`); process.exit(2); }
  console.log(`[geri-yükle] DOĞRULANDI: ${Object.keys(got).length} koleksiyon, ${total} belge; sayı ve kimlik özeti yedekle aynı${keep ? '' : ' (doğrulama veritabanı silindi)'}`);
}

main().catch((e) => { console.error('[geri-yükle] HATA:', e.message); process.exit(1); });
