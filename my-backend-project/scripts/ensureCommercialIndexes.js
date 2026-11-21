#!/usr/bin/env node
// scripts/ensureCommercialIndexes.js — ticari hazırlık (A–F) dizinleri.
// Üretimde autoIndex kapalı (index.js) → yeni dizinler kendiliğinden oluşmaz. Bu betik:
//   • Request {fromUserId, clientRequestId} tekil (kısmi) — talep tekrar gönderiminde çoğaltma yok (F)
//   • ScheduleChange sorgu dizinleri — işlem geçmişi ve yayın sürümü (E)
// Yalnız OLUŞTURUR, hiçbir dizini silmez. Varsayılan kuru çalıştırma; --apply ile uygular.
// Kullanım: MONGODB_URI=... node scripts/ensureCommercialIndexes.js [--apply]
//           Üretim kümesi için MIGRATION_ALLOW_PROD=1 gerekir (onaylı plan ile).
'use strict';
const mongoose = require('mongoose');
const { assertAllowed } = require('./backupLib');

const APPLY = process.argv.includes('--apply');

async function main() {
  const uri = process.env.MONGODB_URI;
  assertAllowed(uri, { label: 'dizin taşıması', allowProdEnv: 'MIGRATION_ALLOW_PROD' });
  await mongoose.connect(uri, { dbName: process.env.MIGRATION_DB_NAME || 'hastane', serverSelectionTimeoutMS: 10000, autoIndex: false });
  const Request = require('../models/Request');
  const ScheduleChange = require('../models/ScheduleChange');

  // Tekil dizin öncesi çift kayıt kontrolü (varsa dizin kurulamaz; elle çözülmeli).
  const dups = await Request.collection.aggregate([
    { $match: { clientRequestId: { $type: 'string' } } },
    { $group: { _id: { u: '$fromUserId', c: '$clientRequestId' }, n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } }, { $count: 'n' },
  ]).toArray();
  const dupCount = dups[0]?.n || 0;

  let planned = 0;
  for (const Model of [Request, ScheduleChange]) {
    await Model.createCollection().catch(() => {});
    const { toCreate } = await Model.diffIndexes();
    for (const spec of toCreate) {
      planned += 1;
      console.log(`[dizin] ${Model.collection.name}: oluşturulacak ${JSON.stringify(spec)}`);
    }
    if (APPLY && toCreate.length) {
      if (Model === Request && dupCount) throw new Error(`requests: ${dupCount} çift clientRequestId grubu var; tekil dizin kurulmadı`);
      await Model.createIndexes();
      console.log(`[dizin] ${Model.collection.name}: oluşturuldu`);
    }
  }
  console.log(`[dizin] ${APPLY ? 'uygulandı' : 'kuru çalıştırma'}: ${planned} dizin; çift talep kimliği grubu ${dupCount}`);
  await mongoose.disconnect();
}

main().catch(async (e) => { console.error('[dizin] HATA:', e.message); await mongoose.disconnect().catch(() => {}); process.exit(1); });
