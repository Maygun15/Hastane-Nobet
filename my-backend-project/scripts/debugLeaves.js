#!/usr/bin/env node
/**
 * scripts/debugLeaves.js — İzin Onayı Sonrası Teşhis Scripti
 *
 * Kullanım:
 *   node scripts/debugLeaves.js --requestId=<ObjectId>
 *
 * Ne yapar:
 *   1. Request dokümanını getirir (hospitalId, fromPersonId, tarihler, leaveTypeCode)
 *   2. Setting/leavesV2 dokümanını serviceId + hospitalId ile sorgular
 *   3. İzin aralığındaki her günü leavesV2 içinde kontrol eder
 *   4. hospitalId uyumsuzluğunu (tenant izolasyonu sorunu) raporlar
 *   5. request.leaveRecordId → Setting._id bağlantısını doğrular
 */
/* eslint-disable no-console */
require('dotenv').config();
const mongoose = require('mongoose');

const Request = require('../models/Request');
const Setting = require('../models/Setting');

// ── CLI ───────────────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const [k, v] = a.slice(2).split('=');
      return [k, v === undefined ? true : v];
    }),
);

const REQUEST_ID = args['requestId'] || args['request-id'] || null;

if (!REQUEST_ID) {
  console.error('Kullanım: node scripts/debugLeaves.js --requestId=<ObjectId>');
  process.exit(1);
}

// ── Yardımcılar ───────────────────────────────────────────────────────────────
const sep  = () => console.log('─'.repeat(70));
const pad2 = (n) => String(n).padStart(2, '0');

function monthKey(y, m) {
  return `${y}-${pad2(m)}`;
}

function dateRange(startDate, endDate) {
  const days = [];
  const start = new Date(`${startDate}T00:00:00`);
  const end   = new Date(`${endDate}T00:00:00`);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    days.push({
      date:     `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
      monthKey: monthKey(d.getFullYear(), d.getMonth() + 1),
      day:      String(d.getDate()),
    });
  }
  return days;
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
  sep();

  // 1. Request dokümanı ─────────────────────────────────────────────────────
  let request;
  try {
    request = await Request.findById(REQUEST_ID).lean();
  } catch (e) {
    console.error(`Request sorgulanamadı: ${e.message}`);
    await mongoose.disconnect();
    process.exit(1);
  }

  if (!request) {
    console.error(`❌ Request bulunamadı: ${REQUEST_ID}`);
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log('✅ REQUEST BULUNDU:');
  console.log(JSON.stringify({
    _id:           String(request._id),
    status:        request.status,
    type:          request.type,
    hospitalId:    String(request.hospitalId   || 'NULL'),
    fromPersonId:  String(request.fromPersonId || 'NULL'),
    fromName:      request.fromName || '',
    serviceId:     request.serviceId  || '(boş)',
    targetDate:    request.targetDate    || 'NULL',
    targetDateEnd: request.targetDateEnd || request.targetDate || 'NULL',
    leaveTypeCode: request.leaveTypeCode || 'YILLIK (default)',
    leaveRecordId: String(request.leaveRecordId || 'NULL'),
    resolvedAt:    request.resolvedAt || null,
    resolvedBy:    String(request.resolvedBy || 'NULL'),
  }, null, 2));
  sep();

  const hid       = request.hospitalId;
  const pid       = String(request.fromPersonId || '');
  const sid       = String(request.serviceId   || '');
  const leaveCode = String(request.leaveTypeCode || 'YILLIK').trim().toUpperCase();
  const startDate = String(request.targetDate    || '').slice(0, 10);
  const endDate   = String(request.targetDateEnd || request.targetDate || '').slice(0, 10);

  if (!hid || !pid || !startDate) {
    console.error('❌ Request eksik kritik alan (hospitalId, fromPersonId veya targetDate)');
    await mongoose.disconnect();
    process.exit(1);
  }

  // 2. Setting/leavesV2 sorgula ─────────────────────────────────────────────
  console.log(`\n🔍 Setting/leavesV2 sorgulanıyor:`);
  console.log(`   hospitalId : ${hid}`);
  console.log(`   serviceId  : "${sid}"`);

  const allSettings = await Setting.find({ hospitalId: hid, key: 'leavesV2' }).lean();
  console.log(`\n   Bu hastanede bulunan leavesV2 doküman sayısı: ${allSettings.length}`);
  allSettings.forEach((s, i) => {
    console.log(`   [${i + 1}] Setting#${s._id}  serviceId="${s.serviceId || ''}"  hospitalId=${s.hospitalId}`);
  });

  const settingDoc = allSettings.find((s) => String(s.serviceId || '') === sid);

  if (!settingDoc) {
    console.error(`\n❌ serviceId="${sid}" eşleşen leavesV2 dokümanı YOK!`);
    if (allSettings.length > 0) {
      console.log('   Mevcut serviceId\'ler:', allSettings.map((s) => `"${s.serviceId || ''}"`).join(', '));
      console.log('   → Request.serviceId ile Setting.serviceId uyuşmuyor olabilir.');
    } else {
      console.log('   → Bu hastane için hiç leavesV2 kaydı yok (writeLeaves hiç başarılı olmadı).');
    }
    await mongoose.disconnect();
    return;
  }

  console.log(`\n✅ Eşleşen Setting dokümanı: Setting#${settingDoc._id}`);
  sep();

  // 3. İzin aralığındaki günleri kontrol et ─────────────────────────────────
  const days = dateRange(startDate, endDate);
  const personData = settingDoc.value?.[pid] ?? null;

  console.log(`\n📅 İZİN ARALIĞI: ${startDate} → ${endDate} (${days.length} gün)`);
  console.log(`   personId      : ${pid}`);
  console.log(`   leaveCode     : ${leaveCode}`);
  console.log(`   leavesV2'de bu personId var mı: ${personData ? 'EVET' : 'HAYIR'}`);
  if (personData) {
    console.log(`   Bu kişinin kayıtlı ayları: ${Object.keys(personData).join(', ')}`);
  }

  const found   = [];
  const missing = [];

  for (const { date, monthKey: mk, day } of days) {
    const raw   = personData?.[mk]?.[day];
    const code  = raw ? (typeof raw === 'string' ? raw : raw?.code) : null;
    const note  = typeof raw === 'object' ? raw?.note || '' : '';
    if (raw) {
      found.push({ date, code, note, raw: JSON.stringify(raw) });
    } else {
      missing.push({ date, monthKey: mk, day });
    }
  }

  console.log(`\n✅ KAYITLI GÜNLER (${found.length}/${days.length}):`);
  if (found.length === 0) {
    console.log('   (hiç yok)');
  }
  found.forEach(({ date, code, note }) =>
    console.log(`   ${date} → code: "${code}"${note ? `  note: "${note}"` : ''}`)
  );

  if (missing.length > 0) {
    console.log(`\n❌ EKSİK GÜNLER (${missing.length}):`);
    missing.forEach(({ date, monthKey: mk, day }) =>
      console.log(`   ${date}  (monthKey=${mk}, day=${day})`)
    );
  } else {
    console.log('\n✅ Tüm günler leavesV2\'ye yazılmış — kayıt tam.');
  }

  // 4. hospitalId uyumsuzluk kontrolü ───────────────────────────────────────
  sep();
  console.log('\n🏥 HOSPİTAL-ID UYUMSUZLUK KONTROLÜ:');
  console.log(`   request.hospitalId  : ${String(request.hospitalId)}`);
  console.log(`   Setting.hospitalId  : ${String(settingDoc.hospitalId)}`);
  const hidMatch = String(request.hospitalId) === String(settingDoc.hospitalId);
  console.log(`   Eşleşiyor mu        : ${hidMatch ? '✅ EVET' : '❌ HAYIR — Tenant izolasyon hatası!'}`);

  if (!hidMatch) {
    console.error('\n⚠️  KRİTİK: hospitalId uyuşmazlığı — writeLeaves farklı bir hastane Setting\'ine yazıyor veya doğru dokümanı bulamıyor.');
  }

  // 5. leaveRecordId doğrulama ───────────────────────────────────────────────
  console.log('\n📌 LEAVE-RECORD-ID DOĞRULAMA:');
  if (request.leaveRecordId) {
    console.log(`   request.leaveRecordId     : ${request.leaveRecordId}`);
    console.log(`   Eşleşen Setting._id        : ${settingDoc._id}`);
    const recMatch = String(request.leaveRecordId) === String(settingDoc._id);
    console.log(`   Eşleşiyor mu              : ${recMatch ? '✅ EVET' : '❌ HAYIR — farklı Setting dokümanına işaret ediyor'}`);
  } else {
    console.log('   ⚠️  request.leaveRecordId = null');
    console.log('   → approveLeaveWithTransaction içinde writeLeaves başarısız olmuş');
    console.log('     veya casRequest adımında settingDocId henüz set edilmemişti.');
  }

  // 6. Özet rapor ───────────────────────────────────────────────────────────
  sep();
  console.log('\nÖZET RAPOR:');
  console.log(`  İzin aralığı        : ${startDate} → ${endDate} (${days.length} gün)`);
  console.log(`  Yazılan gün         : ${found.length}`);
  console.log(`  Eksik gün           : ${missing.length}`);
  console.log(`  hospitalId eşleşme  : ${hidMatch ? '✅' : '❌'}`);
  console.log(`  leaveRecordId mevcut: ${request.leaveRecordId ? '✅' : '❌ (null)'}`);
  console.log(`  Request durumu      : ${request.status}`);

  if (missing.length > 0 && found.length === 0) {
    console.log('\n🔴 SONUÇ: writeLeaves hiç çalışmamış veya tamamen başarısız olmuş.');
  } else if (missing.length > 0) {
    console.log('\n🟡 SONUÇ: writeLeaves kısmen başarılı — bazı günler eksik.');
  } else {
    console.log('\n🟢 SONUÇ: leavesV2 kaydı tam ve doğru.');
  }

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('Script hatası:', err?.message || err);
  process.exit(1);
});
