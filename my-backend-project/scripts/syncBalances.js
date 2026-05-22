#!/usr/bin/env node
/**
 * scripts/syncBalances.js — İzin Bakiyesi Onarım Scripti
 *
 * Toplu İzin Listesi (Setting/leavesV2) içindeki gerçek izin günlerini sayarak
 * LeaveBalance.used alanını düzeltir.
 *
 * Kullanım:
 *   node scripts/syncBalances.js                  # tüm hospitallar, cari yıl
 *   node scripts/syncBalances.js --year=2026       # belirli yıl
 *   node scripts/syncBalances.js --dry-run         # değişiklik yapmadan göster
 *   node scripts/syncBalances.js --hospital=<id>   # tek hastane
 *
 * Ne yapar:
 *   1. Tüm leavesV2 Setting dokümanlarını okur
 *   2. Her personId + leaveCode + year için gün sayar
 *   3. LeaveType koleksiyonunda eşleşen kodu arar (vardiya kodu değil, gerçek izin)
 *   4. LeaveBalance.used'u gerçek değerle günceller (allocated'a dokunmaz)
 *   5. remaining = max(0, allocated - used) hesaplar
 *   6. Fark raporu yazdırır
 */
/* eslint-disable no-console */
require('dotenv').config();
const mongoose = require('mongoose');

const Setting      = require('../models/Setting');
const LeaveBalance = require('../models/LeaveBalance');
const LeaveType    = require('../models/LeaveType');

// ── CLI argümanları ───────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const [k, v] = a.slice(2).split('=');
      return [k, v === undefined ? true : v];
    }),
);

const DRY_RUN    = !!args['dry-run'];
const TARGET_YEAR = args['year'] ? Number(args['year']) : new Date().getFullYear();
const TARGET_HID  = args['hospital'] || null;

// ── Yardımcılar ───────────────────────────────────────────────────────────────

function monthKey(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

/**
 * Tüm leavesV2 Setting dökümanlarındaki izinleri say.
 * Döner: Map<"hospitalId|personId|leaveCode|year", number>
 */
async function countActualLeaveDays() {
  const query = { key: 'leavesV2' };
  if (TARGET_HID) query.hospitalId = new mongoose.Types.ObjectId(TARGET_HID);

  const docs = await Setting.find(query).lean();
  const counts = new Map(); // "hid|pid|code|year" → days

  for (const doc of docs) {
    const hid = String(doc.hospitalId || '');
    const value = doc.value && typeof doc.value === 'object' ? doc.value : {};

    for (const [personId, monthsObj] of Object.entries(value)) {
      if (!monthsObj || typeof monthsObj !== 'object') continue;

      for (const [mk, daysObj] of Object.entries(monthsObj)) {
        // mk format: "2026-05"
        const yearMatch = mk.match(/^(\d{4})-\d{2}$/);
        if (!yearMatch) continue;
        const entryYear = Number(yearMatch[1]);
        if (entryYear !== TARGET_YEAR) continue;

        if (!daysObj || typeof daysObj !== 'object') continue;

        for (const dayEntry of Object.values(daysObj)) {
          const code = typeof dayEntry === 'string'
            ? dayEntry.trim().toUpperCase()
            : String(dayEntry?.code || '').trim().toUpperCase();
          if (!code) continue;

          const key = `${hid}|${personId}|${code}|${entryYear}`;
          counts.set(key, (counts.get(key) || 0) + 1);
        }
      }
    }
  }

  return counts;
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
  console.log(`Yıl: ${TARGET_YEAR} | Dry-run: ${DRY_RUN} | Hastane: ${TARGET_HID || 'hepsi'}`);
  console.log('─'.repeat(60));

  // 1) Gerçek izin günlerini say
  const counts = await countActualLeaveDays();
  console.log(`${counts.size} eşsiz personId+leaveCode+yıl kombinasyonu bulundu`);

  // 2) Her kombinasyon için LeaveType eşleştir ve LeaveBalance güncelle
  let updated = 0;
  let skipped = 0;
  let noType  = 0;
  let unchanged = 0;

  const leaveTypeCache = new Map(); // "hid|code" → LeaveType doc

  async function getLeaveType(hid, code) {
    const cacheKey = `${hid}|${code}`;
    if (leaveTypeCache.has(cacheKey)) return leaveTypeCache.get(cacheKey);
    const lt = hid
      ? await LeaveType.findOne({ hospitalId: new mongoose.Types.ObjectId(hid), code }).lean()
      : null;
    leaveTypeCache.set(cacheKey, lt || null);
    return lt || null;
  }

  for (const [key, actualUsed] of counts.entries()) {
    const [hid, personId, code, yearStr] = key.split('|');
    const year = Number(yearStr);

    const leaveType = await getLeaveType(hid, code);
    if (!leaveType) {
      noType++;
      continue; // Vardiya kodu veya tanımsız izin türü — atla
    }

    const leaveTypeId = String(leaveType._id);
    const filter = {
      hospitalId:  new mongoose.Types.ObjectId(hid),
      personId,
      leaveTypeId,
      year,
    };

    const existing = await LeaveBalance.findOne(filter).lean();

    if (existing) {
      const currentUsed = existing.used ?? 0;
      const diff = actualUsed - currentUsed;

      if (diff === 0) {
        unchanged++;
        continue;
      }

      const newRemaining = Math.max(0, (existing.allocated ?? 0) - actualUsed);

      console.log(
        `${DRY_RUN ? '[DRY] ' : ''}GÜNCELLENİYOR — ${personId} | ${code} | ${year}` +
        ` | used: ${currentUsed} → ${actualUsed} (fark: ${diff > 0 ? '+' : ''}${diff})` +
        ` | remaining: ${existing.remaining} → ${newRemaining}`,
      );

      if (!DRY_RUN) {
        await LeaveBalance.updateOne(filter, {
          $set: { used: actualUsed, remaining: newRemaining },
        });
      }
      updated++;
    } else {
      // Bakiye kaydı yok — oluştur
      const allocated = leaveType.maxDaysPerYear ?? 0;
      const remaining = Math.max(0, allocated - actualUsed);

      console.log(
        `${DRY_RUN ? '[DRY] ' : ''}YENİ KAYIT — ${personId} | ${code} | ${year}` +
        ` | allocated: ${allocated} | used: ${actualUsed} | remaining: ${remaining}`,
      );

      if (!DRY_RUN) {
        try {
          await LeaveBalance.create({
            hospitalId:    new mongoose.Types.ObjectId(hid),
            personId,
            personName:    '',  // personName ayrıca doldurulabilir
            leaveTypeId,
            leaveTypeName: leaveType.name || code,
            year,
            allocated,
            used:          actualUsed,
            remaining,
          });
        } catch (e) {
          if (e.code === 11000) {
            // Çakışma: başka process oluşturmuş olabilir — güncelle
            await LeaveBalance.updateOne(filter, {
              $set: { used: actualUsed, remaining },
            });
          } else {
            throw e;
          }
        }
      }
      updated++;
    }
  }

  // 3) Özet rapor
  console.log('─'.repeat(60));
  console.log(`Sonuç:
  Güncellenen / oluşturulan : ${updated}
  Değişmemiş                : ${unchanged}
  Atlandı (LeaveType yok)   : ${noType}
  Toplam kombinasyon        : ${counts.size}
  ${DRY_RUN ? '\n  ⚠️  DRY-RUN modunda çalıştı — veritabanında değişiklik yapılmadı' : ''}`);

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('Script hatası:', err?.message || err);
  process.exit(1);
});
