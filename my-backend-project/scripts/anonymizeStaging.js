#!/usr/bin/env node
// SADECE DENEME (staging) veritabanı: gerçek TC / telefon / e-postayı sahte değerlerle değiştirir.
//
// Neden: deneme ortamı canlının kopyası; kabul testinde başka kişiler de girecek. KVKK
// gereği gerçek kimlik ve iletişim bilgisi deneme ortamında durmamalı.
//
// Ne yapar:
//   - people: tc → sahte (99 ile başlar, 11 hane), telefon ve e-posta boşaltılır
//   - users (yönetici OLMAYAN): tc → bağlı personelin sahte TC'si (yoksa yeni sahte),
//     telefon boş, e-posta → personelNN@deneme.test
//   - Yönetici hesaplarına DOKUNMAZ (girişleri bozulmasın).
//   - İsimler korunur (kabul testinde personel kendini tanısın).
//
// Güvenlik: hedef adres "staging" içermiyorsa veya canlı kümeyi (gqsquu8) gösteriyorsa DURUR.
// Kullanım:
//   MONGODB_URI=<deneme> node scripts/anonymizeStaging.js          (KURU — sayıları gösterir)
//   MONGODB_URI=<deneme> node scripts/anonymizeStaging.js --apply
'use strict';

const path = require('path');
const mongoose = require(path.join(__dirname, '..', 'node_modules', 'mongoose'));

const APPLY = process.argv.includes('--apply');
const ADMIN_ROLES = new Set(['admin', 'superadmin', 'super_admin']);

function fakeTc(n) {
  return `99${String(n).padStart(9, '0')}`;
}

async function main() {
  const uri = String(process.env.MONGODB_URI || '');
  const host = (uri.match(/@([^/?]+)/) || [])[1] || '';
  if (!host || !/staging/i.test(host) || /gqsquu8/i.test(uri)) {
    throw new Error(`Bu betik yalnızca DENEME veritabanında çalışır (hedef: ${host || '?'}).`);
  }
  console.log(`[anonim] sunucu: ${host} · mod: ${APPLY ? 'UYGULA' : 'KURU (yazmaz)'}`);

  await mongoose.connect(uri, { dbName: 'hastane', serverSelectionTimeoutMS: 15000 });
  const db = mongoose.connection.db;
  const People = db.collection('people');
  const Users = db.collection('users');

  const people = await People.find({}, { projection: { _id: 1, userId: 1 } }).sort({ _id: 1 }).toArray();
  const users = await Users.find({}, { projection: { _id: 1, role: 1, personId: 1 } }).sort({ _id: 1 }).toArray();

  let seq = 1;
  const tcByPerson = new Map();
  const tcByUser = new Map();
  for (const p of people) {
    const tc = fakeTc(seq++);
    tcByPerson.set(String(p._id), tc);
    if (p.userId) tcByUser.set(String(p.userId), tc);
  }

  const staffUsers = users.filter((u) => !ADMIN_ROLES.has(String(u.role || '').toLowerCase()));
  console.log(`  personel: ${people.length} (TC sahte, telefon/e-posta boş)`);
  console.log(`  personel hesabı: ${staffUsers.length} (TC sahte, e-posta personelNN@deneme.test, telefon boş)`);
  console.log(`  yönetici hesabı (dokunulmaz): ${users.length - staffUsers.length}`);

  if (APPLY) {
    for (const p of people) {
      await People.updateOne(
        { _id: p._id },
        {
          $set: { tc: tcByPerson.get(String(p._id)), phone: '', email: '', mail: '' },
          $unset: { 'meta.phone': '', 'meta.email': '', 'meta.mail': '', 'meta.tc': '' },
        }
      );
    }
    let n = 1;
    for (const u of staffUsers) {
      // users.tc benzersiz: personele bağlı (people.userId) hesap personelin TC'sini alır,
      // bağsız/kopya hesaplar ayrı sahte TC alır (aynı TC iki hesapta olmasın).
      const tc = tcByUser.get(String(u._id)) || fakeTc(seq++);
      const email = `personel${String(n++).padStart(3, '0')}@deneme.test`;
      // users.tc / email / phone benzersiz (sparse) indeksli: telefonu alandan kaldır
      await Users.updateOne({ _id: u._id }, { $set: { tc, email }, $unset: { phone: '' } });
    }
    console.log('[anonim] tamamlandı.');
  }
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('[anonim] HATA:', err?.message || err);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
