#!/usr/bin/env node
// İzin türlerini düzeltir: yalnızca yıllık izin bakiyeden düşülür, yıllık hak tanımlanır.
//
// Sorun: eski izin türlerinde `isDeductible` alanı boş; kod boşu "düşülür" sayıyordu.
// Rapor, doğum izni, görevli vb. onaylanınca izin bakiyesinden düşüyordu. Yıllık hak
// (maxDaysPerYear) da boş olduğu için bakiye hep "hak 0".
//
// Kullanım (varsayılan KURU, hiçbir şey yazmaz):
//   MONGODB_URI=<uri> node scripts/fixLeaveTypes.js
//   MONGODB_URI=<uri> node scripts/fixLeaveTypes.js --apply
// Seçenekler:
//   --deductible=Y         bakiyeden düşülecek kodlar (virgülle; varsayılan: Y)
//   --annual-days=20       düşülen türlerde yıllık hak (gün; 657 DMK: 10 yıldan az 20, fazla 30)
//
// Ayrıca hak 0 kalmış mevcut bakiyeleri (allocated=0) yeni hakla günceller, kalanı yeniden hesaplar.
// Kişi bazlı 30 günlük haklar için personel listesiyle ayrıca güncelleme gerekir.
'use strict';

const path = require('path');
const mongoose = require(path.join(__dirname, '..', 'node_modules', 'mongoose'));

const APPLY = process.argv.includes('--apply');
const arg = (name, def) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : def;
};
const DEDUCTIBLE = new Set(
  arg('deductible', 'Y').split(',').map((s) => s.trim().toLocaleUpperCase('tr-TR')).filter(Boolean)
);
const ANNUAL_DAYS = Number(arg('annual-days', '20'));

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI açıkça verilmeli (.env okunmaz).');
  if (!Number.isFinite(ANNUAL_DAYS) || ANNUAL_DAYS <= 0) throw new Error('--annual-days pozitif sayı olmalı');
  const host = (String(uri).match(/@([^/?]+)/) || [])[1] || '?';
  console.log(`[izin-türleri] sunucu: ${host} · mod: ${APPLY ? 'UYGULA' : 'KURU (yazmaz)'}`);
  console.log(`[izin-türleri] düşülecek kodlar: ${[...DEDUCTIBLE].join(', ')} · yıllık hak: ${ANNUAL_DAYS} gün`);

  await mongoose.connect(uri, { dbName: 'hastane', serverSelectionTimeoutMS: 15000 });
  const db = mongoose.connection.db;
  const types = await db.collection('leave_types').find({}).sort({ code: 1 }).toArray();

  const changes = [];
  for (const t of types) {
    const code = String(t.code || '').toLocaleUpperCase('tr-TR');
    const shouldDeduct = DEDUCTIBLE.has(code);
    const set = {};
    if (t.isDeductible !== shouldDeduct) set.isDeductible = shouldDeduct;
    if (shouldDeduct && !(Number(t.maxDaysPerYear) > 0)) set.maxDaysPerYear = ANNUAL_DAYS;
    if (Object.keys(set).length) changes.push({ t, set });
  }

  for (const { t, set } of changes) {
    console.log(`  ${String(t.code).padEnd(4)} ${String(t.name).padEnd(26)} → ${JSON.stringify(set)}`);
  }
  if (!changes.length) console.log('  izin türlerinde değişiklik yok');

  // Eski bakiyelerde leaveTypeId olarak tür KODU (ör. "Y") yazılmış olabilir; onay kodu
  // artık türün kimliğini kullanıyor. Kodla yazılmışları kimliğe çevir (aksi halde yeni
  // onaylar ayrı bir bakiye açar).
  const codeToId = new Map(types.map((t) => [String(t.code || ''), String(t._id)]));
  const codeKeyed = await db.collection('leavebalances')
    .find({ leaveTypeId: { $in: [...codeToId.keys()].filter(Boolean) } })
    .toArray();
  for (const b of codeKeyed) {
    console.log(`  bakiye kimliği: ${b.personName || b.personId} ${b.year} "${b.leaveTypeId}" → tür kimliği`);
  }

  // hak 0 kalmış bakiyeler
  const deductTypes = types.filter((t) => DEDUCTIBLE.has(String(t.code || '').toLocaleUpperCase('tr-TR')));
  const ids = deductTypes.flatMap((t) => [t._id, String(t._id), String(t.code || '')]);
  const zeroBalances = await db.collection('leavebalances')
    .find({ leaveTypeId: { $in: ids }, $or: [{ allocated: 0 }, { allocated: null }, { allocated: { $exists: false } }] })
    .toArray();
  for (const b of zeroBalances) {
    const used = Number(b.used || 0);
    console.log(`  bakiye: ${b.personName || b.personId} ${b.year} → hak ${ANNUAL_DAYS}, kullanılan ${used}, kalan ${Math.max(0, ANNUAL_DAYS - used)}`);
  }

  if (APPLY) {
    for (const b of codeKeyed) {
      await db.collection('leavebalances').updateOne(
        { _id: b._id },
        { $set: { leaveTypeId: codeToId.get(String(b.leaveTypeId)) } }
      );
    }
    for (const { t, set } of changes) {
      await db.collection('leave_types').updateOne({ _id: t._id }, { $set: set });
    }
    for (const b of zeroBalances) {
      const used = Number(b.used || 0);
      await db.collection('leavebalances').updateOne(
        { _id: b._id },
        { $set: { allocated: ANNUAL_DAYS, remaining: Math.max(0, ANNUAL_DAYS - used) } }
      );
    }
  }
  console.log(`[izin-türleri] ${APPLY ? 'güncellendi' : 'güncellenecek'}: ${changes.length} izin türü, ${zeroBalances.length} bakiye hakkı, ${codeKeyed.length} bakiye kimliği`);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('[izin-türleri] HATA:', err?.message || err);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
