#!/usr/bin/env node
/**
 * scripts/repairOrphanedLeaves.js — Yanlış serviceId ile Kaydedilmiş İzinleri Onar
 *
 * Sorun:
 *   Onay akışı daha önce request.serviceId (bir ObjectId) ile Setting/leavesV2'ye yazıyordu.
 *   Frontend ise /api/leaves?serviceId= (boş string) ile okuyor.
 *   Sonuç: approve edilen izinler veritabanında var ama ekranda görünmüyor.
 *
 * Bu script:
 *   1. serviceId != '' olan tüm leavesV2 Setting dokümanlarını bulur (orphan)
 *   2. Her orphan'ın value'sunu, aynı hastaneye ait serviceId='' dokümanla deep-merge eder
 *   3. Birleştirilmiş veriyi serviceId='' dokümanına kaydeder
 *   4. Orphan dokümanları siler (dry-run'da sadece raporlar)
 *
 * Kullanım:
 *   node scripts/repairOrphanedLeaves.js              # tüm hastaneler
 *   node scripts/repairOrphanedLeaves.js --dry-run    # değişiklik yapma, sadece raporla
 *   node scripts/repairOrphanedLeaves.js --hospital=<id>  # tek hastane
 */
/* eslint-disable no-console */
require('dotenv').config();
const mongoose = require('mongoose');
const Setting  = require('../models/Setting');

// ── CLI ───────────────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const [k, v] = a.slice(2).split('=');
      return [k, v === undefined ? true : v];
    }),
);

const DRY_RUN     = !!args['dry-run'];
const TARGET_HID  = args['hospital'] || null;

const sep = () => console.log('─'.repeat(70));

// ── Deep merge: orphan.value → target.value ───────────────────────────────────
// Orphan kazanır sadece hedefte o gün yoksa; mevcudu ezmez.
function mergeLeaveValues(target, orphan) {
  const out = target && typeof target === 'object' ? { ...target } : {};

  for (const [pid, byYm] of Object.entries(orphan || {})) {
    if (!byYm || typeof byYm !== 'object') continue;
    out[pid] ??= {};
    for (const [ym, days] of Object.entries(byYm)) {
      if (!days || typeof days !== 'object') continue;
      out[pid][ym] ??= {};
      for (const [day, entry] of Object.entries(days)) {
        if (out[pid][ym][day] === undefined) {
          // Hedefte bu gün yok → orphan kaydını al
          out[pid][ym][day] = entry;
        }
        // Hedefte varsa dokunma (onay-sonrası düzeltme öncelikli)
      }
    }
  }
  return out;
}

// ── Ana akış ─────────────────────────────────────────────────────────────────
async function run() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGODB_URI env değişkeni tanımlı değil');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log('MongoDB bağlandı');
  console.log(`Mod: ${DRY_RUN ? 'DRY-RUN (değişiklik yok)' : 'CANLI'}  |  Hastane: ${TARGET_HID || 'hepsi'}`);
  sep();

  // 1. Orphan dokümanları bul (serviceId != '' ve != null)
  const orphanQuery = {
    key: 'leavesV2',
    serviceId: { $exists: true, $nin: ['', null] },
  };
  if (TARGET_HID) orphanQuery.hospitalId = new mongoose.Types.ObjectId(TARGET_HID);

  const orphans = await Setting.find(orphanQuery).lean();
  console.log(`Orphan leavesV2 doküman sayısı: ${orphans.length}`);

  if (orphans.length === 0) {
    console.log('Onarılacak orphan doküman yok. Çıkılıyor.');
    await mongoose.disconnect();
    return;
  }
  sep();

  // 2. Her orphan'ı ilgili hastanedeki '' dokümanla merge et
  let mergedCount   = 0;
  let skippedCount  = 0;
  let deletedCount  = 0;
  let createdTarget = 0;

  // hospitalId'ye göre grupla — her hastane için tek bir target doc yeterli
  const byHospital = new Map();
  for (const doc of orphans) {
    const hid = String(doc.hospitalId || '');
    if (!byHospital.has(hid)) byHospital.set(hid, []);
    byHospital.get(hid).push(doc);
  }

  for (const [hid, group] of byHospital.entries()) {
    console.log(`\nHastane: ${hid} — ${group.length} orphan doküman`);

    if (!hid || !mongoose.Types.ObjectId.isValid(hid)) {
      console.warn(`  ⚠️  Geçersiz hospitalId "${hid}" — bu grup atlanıyor`);
      continue;
    }

    // Target: serviceId='' dokümanı
    const targetFilter = { hospitalId: new mongoose.Types.ObjectId(hid), key: 'leavesV2', serviceId: '' };
    let targetDoc = await Setting.findOne(targetFilter);

    if (!targetDoc) {
      console.log('  Target doküman (serviceId="") yok — oluşturulacak');
      if (!DRY_RUN) {
        targetDoc = await Setting.create({ hospitalId: hid, key: 'leavesV2', serviceId: '', value: {} });
        createdTarget++;
      } else {
        console.log('  [DRY] Target oluşturulacaktı');
      }
    } else {
      console.log(`  Target: Setting#${targetDoc._id} (mevcut kişi sayısı: ${Object.keys(targetDoc.value || {}).length})`);
    }

    for (const orphan of group) {
      const orphanPersonCount = Object.keys(orphan.value || {}).length;
      let totalDays = 0;
      for (const byYm of Object.values(orphan.value || {})) {
        for (const days of Object.values(byYm || {})) {
          totalDays += Object.keys(days || {}).length;
        }
      }

      console.log(`  Orphan Setting#${orphan._id}  serviceId="${orphan.serviceId}"  kişi: ${orphanPersonCount}  toplam gün: ${totalDays}`);

      if (orphanPersonCount === 0) {
        console.log('    → Boş orphan, sadece silinecek');
        if (!DRY_RUN) {
          await Setting.deleteOne({ _id: orphan._id });
          deletedCount++;
        } else {
          console.log('    [DRY] Silinecekti');
        }
        continue;
      }

      if (!DRY_RUN && targetDoc) {
        const currentValue = targetDoc.value && typeof targetDoc.value === 'object' ? targetDoc.value : {};
        const merged = mergeLeaveValues(currentValue, orphan.value);

        const addedDays = Object.values(merged).reduce((acc, byYm) =>
          acc + Object.values(byYm || {}).reduce((a2, d) => a2 + Object.keys(d || {}).length, 0), 0
        ) - Object.values(currentValue).reduce((acc, byYm) =>
          acc + Object.values(byYm || {}).reduce((a2, d) => a2 + Object.keys(d || {}).length, 0), 0
        );

        targetDoc.value = merged;
        targetDoc.markModified('value');
        await targetDoc.save();
        console.log(`    → Merge tamamlandı. +${addedDays} gün eklendi`);

        await Setting.deleteOne({ _id: orphan._id });
        console.log(`    → Orphan Setting#${orphan._id} silindi`);
        mergedCount++;
        deletedCount++;
      } else {
        // DRY-RUN: sadece rapor
        const currentValue = targetDoc?.value && typeof targetDoc.value === 'object' ? targetDoc.value : {};
        const merged = mergeLeaveValues(currentValue, orphan.value);
        let addedDays = 0;
        for (const [pid, byYm] of Object.entries(orphan.value || {})) {
          for (const [ym, days] of Object.entries(byYm || {})) {
            for (const day of Object.keys(days || {})) {
              if (!currentValue[pid]?.[ym]?.[day]) addedDays++;
            }
          }
        }
        void merged;
        console.log(`    [DRY] Merge edilecekti: +${addedDays} yeni gün, Setting#${orphan._id} silinecekti`);
        skippedCount++;
      }
    }
  }

  // 3. Özet rapor
  sep();
  console.log('ÖZET:');
  console.log(`  Orphan doküman bulundu : ${orphans.length}`);
  if (DRY_RUN) {
    console.log(`  Merge edilecekti       : ${skippedCount + (orphans.length - skippedCount)}`);
    console.log(`  ⚠️  DRY-RUN — veritabanında hiçbir değişiklik yapılmadı`);
    console.log(`  Gerçek çalıştırmak için: node scripts/repairOrphanedLeaves.js`);
  } else {
    console.log(`  Merge edildi           : ${mergedCount}`);
    console.log(`  Silindi                : ${deletedCount}`);
    console.log(`  Yeni target oluşturdu  : ${createdTarget}`);
    console.log(`  ✅ Onarım tamamlandı`);
  }

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('Script hatası:', err?.message || err);
  process.exit(1);
});
