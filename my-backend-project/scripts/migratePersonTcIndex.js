#!/usr/bin/env node
'use strict';

/**
 * Person TC indeksi taşıması.
 *
 * Sorun: eski 'hospitalId_1_tc_1' indeksi { unique: true, sparse: true } idi.
 * Birleşik indekste sparse işe yaramadığı için bir hastanede TC'si boş ('' / null)
 * ikinci kişi eklenemiyordu (E11000). Yeni tanım (models/Person.js):
 *   'hospitalId_1_tc_1_nonempty' — sadece dolu TC'lerde benzersiz.
 *
 * Bu betik:
 *   1) Dolu TC'lerde gerçek kopya var mı kontrol eder (varsa durur).
 *   2) Yeni indeksi oluşturur.
 *   3) Eski indeksi kaldırır.
 *
 * Varsayılan KURU ÇALIŞMA: sadece ne yapacağını yazar. Uygulamak için --apply.
 * .env OKUMAZ; MONGODB_URI açıkça verilmelidir.
 *
 *   MONGODB_URI=... node scripts/migratePersonTcIndex.js            # kuru çalışma
 *   MONGODB_URI=... node scripts/migratePersonTcIndex.js --apply    # uygula
 */

const mongoose = require('mongoose');

const OLD_NAME = 'hospitalId_1_tc_1';
const NEW_NAME = 'hospitalId_1_tc_1_nonempty';
const NEW_SPEC = { hospitalId: 1, tc: 1 };
const NEW_OPTS = { name: NEW_NAME, unique: true, partialFilterExpression: { tc: { $type: 'string', $gt: '' } } };

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI açıkça verilmeli.');
  const apply = process.argv.includes('--apply');
  const dbName = process.env.MONGODB_DB || 'hastane';

  await mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: 10000 });
  const coll = mongoose.connection.db.collection('people');
  const host = (() => { try { return new URL(uri).host; } catch { return '?'; } })();
  console.log(`[tc-index] veritabanı: ${host}/${dbName} — mod: ${apply ? 'UYGULA' : 'KURU ÇALIŞMA'}`);

  const indexes = await coll.indexes();
  const oldIdx = indexes.find((i) => i.name === OLD_NAME);
  const newIdx = indexes.find((i) => i.name === NEW_NAME);
  console.log(`[tc-index] eski indeks: ${oldIdx ? JSON.stringify({ unique: oldIdx.unique, sparse: oldIdx.sparse }) : 'yok'}`);
  console.log(`[tc-index] yeni indeks: ${newIdx ? 'var' : 'yok'}`);

  const dupes = await coll.aggregate([
    { $match: { tc: { $type: 'string', $gt: '' } } },
    { $group: { _id: { h: '$hospitalId', tc: '$tc' }, n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
    { $count: 'n' },
  ]).toArray();
  const dupeCount = dupes[0]?.n || 0;
  const emptyTc = await coll.countDocuments({ $or: [{ tc: '' }, { tc: null }, { tc: { $exists: false } }] });
  console.log(`[tc-index] TC'si boş kişi: ${emptyTc}, aynı hastanede kopya dolu TC grubu: ${dupeCount}`);
  if (dupeCount > 0) throw new Error('Dolu TC kopyaları var; önce bunlar temizlenmeli. Hiçbir değişiklik yapılmadı.');

  if (!apply) {
    console.log(`[tc-index] Yapılacaklar: ${newIdx ? '' : `"${NEW_NAME}" oluştur; `}${oldIdx ? `"${OLD_NAME}" kaldır` : ''}`.trim());
    console.log('[tc-index] Uygulamak için --apply ile çalıştırın.');
    return;
  }
  if (!newIdx) {
    await coll.createIndex(NEW_SPEC, NEW_OPTS);
    console.log(`[tc-index] "${NEW_NAME}" oluşturuldu.`);
  }
  if (oldIdx) {
    await coll.dropIndex(OLD_NAME);
    console.log(`[tc-index] "${OLD_NAME}" kaldırıldı.`);
  }
  console.log('[tc-index] Tamam.');
}

main()
  .catch((err) => { console.error('[tc-index]', err.message || err); process.exitCode = 1; })
  .finally(() => mongoose.disconnect().catch(() => {}));
