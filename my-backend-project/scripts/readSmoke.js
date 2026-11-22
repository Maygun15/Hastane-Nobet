#!/usr/bin/env node
// Geri yüklenen veritabanında temel okuma akışı (uygulamanın modelleriyle): kurum, personel, kullanıcı,
// son çizelge ve atamaları, izin bakiyeleri. Yalnız okur. Kullanım: MONGODB_URI=mongodb://localhost:27017 node scripts/readSmoke.js
'use strict';
const mongoose = require('mongoose');
(async () => {
  const uri = process.env.MONGODB_URI;
  if (!/^mongodb:\/\/(localhost|127\.0\.0\.1)/.test(uri || '')) throw new Error('yalnız yerel/CI veritabanında çalışır');
  await mongoose.connect(uri, { dbName: process.env.SMOKE_DB_NAME || 'hastane', autoIndex: false });
  const Hospital = require('../models/Hospital');
  const Person = require('../models/Person');
  const User = require('../models/User');
  const MonthlySchedule = require('../models/MonthlySchedule');
  const LeaveBalance = require('../models/LeaveBalance');
  const raw = mongoose.connection.db;
  const out = {
    hastane: await raw.collection('hospitals').countDocuments(),
    personel: await raw.collection('people').countDocuments(),
    kullanici: await raw.collection('users').countDocuments(),
    cizelge: await raw.collection('monthlyschedules').countDocuments(),
    izinBakiyesi: await raw.collection('leavebalances').countDocuments(),
  };
  // Model üzerinden okuma (şema / eklenti uyumu): ilk kurum, onun personeli ve en son çizelgesi
  const h = await Hospital.findOne().lean();
  const persons = h ? await Person.find({ hospitalId: h._id }).limit(5).lean() : [];
  const lastPlan = h ? await MonthlySchedule.findOne({ hospitalId: h._id }).sort({ year: -1, month: -1 }).lean() : null;
  out.modelOkuma = {
    kurumVar: !!h, ilkPersonelSayisi: persons.length,
    sonCizelge: lastPlan ? `${lastPlan.year}-${String(lastPlan.month).padStart(2, '0')}` : null,
    sonCizelgeAtama: Array.isArray(lastPlan?.data?.assignments) ? lastPlan.data.assignments.length : 0,
    kullaniciOkundu: !!(await User.findOne().select('_id role').lean()),
    bakiyeOkundu: (await LeaveBalance.countDocuments()) >= 0,
  };
  console.log(JSON.stringify(out, null, 2));
  const ok = out.hastane > 0 && out.personel > 0 && out.modelOkuma.kurumVar;
  await mongoose.disconnect();
  if (!ok) { console.error('[okuma] temel veri bulunamadı'); process.exit(2); }
  console.log('[okuma] TAMAM');
})().catch((e) => { console.error('[okuma] HATA:', e.message); process.exit(1); });
