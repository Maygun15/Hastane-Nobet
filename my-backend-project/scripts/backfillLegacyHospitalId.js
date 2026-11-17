#!/usr/bin/env node
// Eski (çok-hastane öncesi) kayıtlara hospitalId ekler.
//
// Neden: yeni sürüm sorguları hospitalId ile süzüyor. hospitalId'si olmayan eski
// kayıtlar görünmüyor (talepler, kurallar, ayarlar) ve eski benzersiz indeksler
// (ör. settings.key_1_serviceId_1) yüzünden aynı kaydın hastaneli kopyası
// oluşturulamıyor → izin onayı "bakiye güncellenemedi" hatasıyla geri alınıyor.
//
// Kullanım (varsayılan KURU çalıştırma, hiçbir şey yazmaz):
//   MONGODB_URI=<uri> node scripts/backfillLegacyHospitalId.js
//   MONGODB_URI=<uri> node scripts/backfillLegacyHospitalId.js --apply
//
// Güvenlik:
//   - .env OKUNMAZ; MONGODB_URI açıkça verilmelidir.
//   - Veritabanında tam olarak 1 hastane yoksa durur.
//   - Bir kayda hospitalId eklemek, aynı benzersiz anahtarla zaten hastaneli bir
//     kayıt varken çakışma yaratacaksa o koleksiyonu ATLAR ve raporlar.
//   - hospitalId'si metin olarak kaydedilmiş kayıtları da gerçek kimlik tipine çevirir
//     (izin türleri, kullanıcılar, vardiya tanımları); bkz. bölüm 2.
//   - holidays bilerek dahil değil (2026–2027 için hastaneli kopyalar zaten var;
//     eklemek (hospitalId,date) benzersizliğinde çakışır).
'use strict';

const path = require('path');
const mongoose = require(path.join(__dirname, '..', 'node_modules', 'mongoose'));

const APPLY = process.argv.includes('--apply');
const MISSING = { $or: [{ hospitalId: { $exists: false } }, { hospitalId: null }] };

// koleksiyon → hastane içinde benzersiz olması gereken alanlar (null = benzersizlik yok)
const TARGETS = {
  requests: null,
  settings: ['key', 'serviceId'],
  dutyrules: ['sectionId', 'serviceId', 'role'],
  schedulerules: ['sectionId', 'serviceId', 'role'],
  generatedschedules: null,
};

function maskHost(uri) {
  const m = String(uri).match(/@([^/?]+)/);
  return m ? m[1] : '(bilinmiyor)';
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI açıkça verilmeli (.env okunmaz).');
  console.log(`[backfill] hedef sunucu: ${maskHost(uri)} · mod: ${APPLY ? 'UYGULA' : 'KURU (yazmaz)'}`);

  await mongoose.connect(uri, { dbName: 'hastane', serverSelectionTimeoutMS: 15000 });
  const db = mongoose.connection.db;

  const hospitals = await db.collection('hospitals').find({}, { projection: { name: 1 } }).toArray();
  if (hospitals.length !== 1) {
    throw new Error(`Tam 1 hastane bekleniyordu, ${hospitals.length} bulundu. Elle karar gerekli.`);
  }
  const hospitalId = hospitals[0]._id;
  console.log(`[backfill] hastane: ${hospitals[0].name} (${hospitalId})`);

  const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
  let total = 0;

  for (const [name, uniqueFields] of Object.entries(TARGETS)) {
    if (!existing.has(name)) { console.log(`  ${name}: koleksiyon yok`); continue; }
    const col = db.collection(name);
    const legacy = await col.find(MISSING).toArray();
    if (!legacy.length) { console.log(`  ${name}: eksik yok`); continue; }

    if (uniqueFields) {
      const conflicts = [];
      for (const doc of legacy) {
        const q = { hospitalId };
        for (const f of uniqueFields) q[f] = doc[f] === undefined ? null : doc[f];
        if (await col.findOne(q, { projection: { _id: 1 } })) {
          conflicts.push(uniqueFields.map((f) => `${f}=${JSON.stringify(doc[f] ?? '')}`).join(' '));
        }
      }
      if (conflicts.length) {
        console.log(`  ${name}: ATLANDI — ${conflicts.length} kayıtta hastaneli eşi zaten var: ${conflicts.join('; ')}`);
        continue;
      }
    }

    const label = (d) => {
      if (name === 'settings') return d.key;
      if (name === 'requests') return `${d.type}/${d.status}`;
      return [d.sectionId, d.serviceId, d.role].filter(Boolean).join('/') || String(d._id);
    };
    console.log(`  ${name}: ${legacy.length} kayıt → ${legacy.map(label).join(', ')}`);
    if (APPLY) {
      const res = await col.updateMany(
        { _id: { $in: legacy.map((d) => d._id) }, ...MISSING },
        { $set: { hospitalId } }
      );
      console.log(`    yazıldı: ${res.modifiedCount}`);
      total += res.modifiedCount;
    } else {
      total += legacy.length;
    }
  }

  // 2) Tip düzeltmesi: hospitalId metin (string) olarak kaydedilmiş kayıtlar.
  // Sorgular ObjectId ile yapıldığından bu kayıtlar hiç bulunmuyordu
  // (ör. izin türleri → izin onayında tür bulunamıyor; 55 kullanıcı ekranda yok).
  // Değer bu hastanenin kimliğiyle aynıysa ObjectId'ye çevrilir. Farklıysa (geçersiz,
  // ör. bir kullanıcı kimliği) yalnızca INVALID_FIX listesindeki koleksiyonlarda
  // hastaneye bağlanır; diğerleri raporlanır.
  const INVALID_FIX = new Set(['working_hours']);
  const hidStr = String(hospitalId);
  for (const name of [...existing].sort()) {
    if (name === 'hospitals' || name.startsWith('system.')) continue;
    const col = db.collection(name);
    const sameStr = await col.countDocuments({ hospitalId: hidStr });
    const otherStr = await col.countDocuments({ hospitalId: { $type: 'string', $ne: hidStr } });
    if (!sameStr && !otherStr) continue;
    if (sameStr) {
      console.log(`  ${name}: ${sameStr} kayıtta hospitalId metin → ObjectId`);
      if (APPLY) {
        const res = await col.updateMany({ hospitalId: hidStr }, { $set: { hospitalId } });
        console.log(`    yazıldı: ${res.modifiedCount}`);
        total += res.modifiedCount;
      } else total += sameStr;
    }
    if (otherStr) {
      if (INVALID_FIX.has(name)) {
        console.log(`  ${name}: ${otherStr} kayıtta hospitalId geçersiz metin → bu hastane`);
        if (APPLY) {
          const res = await col.updateMany({ hospitalId: { $type: 'string', $ne: hidStr } }, { $set: { hospitalId } });
          console.log(`    yazıldı: ${res.modifiedCount}`);
          total += res.modifiedCount;
        } else total += otherStr;
      } else {
        console.log(`  ${name}: ${otherStr} kayıtta hospitalId geçersiz metin — ATLANDI (elle incelenmeli)`);
      }
    }
  }

  console.log(`[backfill] ${APPLY ? 'güncellenen' : 'güncellenecek'} toplam: ${total}`);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('[backfill] HATA:', err?.message || err);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
