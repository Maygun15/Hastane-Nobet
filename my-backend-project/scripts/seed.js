#!/usr/bin/env node
/**
 * Demo seed data — geliştirme ortamı için
 * Kullanım: node scripts/seed.js
 * Temizle: node scripts/seed.js --clean
 */
require('dotenv').config();
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/hastane';
const clean = process.argv.includes('--clean');

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log('[seed] MongoDB bağlandı:', MONGODB_URI);

  const Hospital    = require('../models/Hospital');
  const User        = require('../models/User');
  const Person      = require('../models/Person');
  const LeaveType   = require('../models/LeaveType');
  const WorkArea    = require('../models/WorkArea');
  const WorkingHours = require('../models/WorkingHours');

  if (clean) {
    await Promise.all([
      Hospital.deleteMany({ slug: /^demo-/ }),
      User.deleteMany({ email: /demo\.hastane\.test$/ }),
      Person.deleteMany({ email: /demo\.hastane\.test$/ }),
      LeaveType.deleteMany({ name: /^\[DEMO\]/ }),
      WorkArea.deleteMany({ name: /^\[DEMO\]/ }),
      WorkingHours.deleteMany({ name: /^\[DEMO\]/ }),
    ]);
    console.log('[seed] Demo veriler temizlendi.');
    return;
  }

  // ── Hastane ──────────────────────────────────────────────
  let hospital = await Hospital.findOne({ slug: 'demo-hastane' }).lean();
  if (!hospital) {
    hospital = await Hospital.create({
      name: 'Demo Hastane',
      slug: 'demo-hastane',
      contactEmail: 'admin@demo.hastane.test',
      active: true,
    });
    console.log('[seed] Hastane oluşturuldu:', hospital.slug);
  }
  const hId = hospital._id;

  // ── Çalışma Alanları ─────────────────────────────────────
  const areas = await Promise.all([
    WorkArea.findOneAndUpdate(
      { hospitalId: hId, name: '[DEMO] Acil Servis' },
      { hospitalId: hId, name: '[DEMO] Acil Servis', color: '#ef4444', status: 'active' },
      { upsert: true, new: true }
    ),
    WorkArea.findOneAndUpdate(
      { hospitalId: hId, name: '[DEMO] Dahiliye' },
      { hospitalId: hId, name: '[DEMO] Dahiliye', color: '#3b82f6', status: 'active' },
      { upsert: true, new: true }
    ),
  ]);
  console.log('[seed] Çalışma alanları:', areas.length);

  // ── Vardiya Şablonları ────────────────────────────────────
  await Promise.all([
    WorkingHours.findOneAndUpdate(
      { hospitalId: hId, name: '[DEMO] Sabah Vardiyası' },
      { hospitalId: hId, name: '[DEMO] Sabah Vardiyası', startTime: '08:00', endTime: '16:00', totalHours: 8, status: 'active' },
      { upsert: true, new: true }
    ),
    WorkingHours.findOneAndUpdate(
      { hospitalId: hId, name: '[DEMO] Öğleden Sonra' },
      { hospitalId: hId, name: '[DEMO] Öğleden Sonra', startTime: '16:00', endTime: '00:00', totalHours: 8, status: 'active' },
      { upsert: true, new: true }
    ),
    WorkingHours.findOneAndUpdate(
      { hospitalId: hId, name: '[DEMO] Gece Vardiyası' },
      { hospitalId: hId, name: '[DEMO] Gece Vardiyası', startTime: '00:00', endTime: '08:00', totalHours: 8, status: 'active' },
      { upsert: true, new: true }
    ),
  ]);
  console.log('[seed] Vardiya şablonları oluşturuldu.');

  // ── İzin Türleri ─────────────────────────────────────────
  const leaveTypes = [
    { name: '[DEMO] Yıllık İzin',    color: '#22c55e', category: 'annual',   maxDaysPerYear: 14, paidLeave: true },
    { name: '[DEMO] Hastalık İzni',  color: '#f59e0b', category: 'sick',     maxDaysPerYear: 30, paidLeave: true },
    { name: '[DEMO] Ücretsiz İzin',  color: '#6b7280', category: 'unpaid',   maxDaysPerYear: null, paidLeave: false },
  ];
  for (const lt of leaveTypes) {
    await LeaveType.findOneAndUpdate(
      { hospitalId: hId, name: lt.name },
      { ...lt, hospitalId: hId },
      { upsert: true }
    );
  }
  console.log('[seed] İzin türleri oluşturuldu.');

  // ── Admin Kullanıcı ──────────────────────────────────────
  let admin = await User.findOne({ email: 'admin@demo.hastane.test' });
  if (!admin) {
    admin = new User({
      hospitalId: hId,
      name: 'Demo Admin',
      email: 'admin@demo.hastane.test',
      tc: '10000000001',
      role: 'admin',
      active: true,
      serviceIds: [],
    });
    await admin.setPassword('Demo2026!');
    admin.mustChangePassword = true;
    await admin.save();
    console.log('[seed] Admin oluşturuldu: admin@demo.hastane.test / Demo2026!');
  }

  // ── Demo Personel ────────────────────────────────────────
  const serviceId = String(areas[0]._id);
  const personnel = [
    { name: 'Ayşe Kaya',   tc: '10000000002', email: 'ayse@demo.hastane.test'   },
    { name: 'Mehmet Demir',tc: '10000000003', email: 'mehmet@demo.hastane.test' },
    { name: 'Fatma Yılmaz',tc: '10000000004', email: 'fatma@demo.hastane.test'  },
    { name: 'Ali Çelik',   tc: '10000000005', email: 'ali@demo.hastane.test'    },
  ];
  for (const p of personnel) {
    await Person.findOneAndUpdate(
      { hospitalId: hId, tc: p.tc },
      { ...p, hospitalId: hId, serviceId, active: true },
      { upsert: true }
    );
  }
  console.log('[seed] Demo personel oluşturuldu:', personnel.length);

  console.log('\n[seed] ✅ Tamamlandı.');
  console.log('  Giriş: admin@demo.hastane.test / Demo2026!');
  console.log('  Temizlemek için: node scripts/seed.js --clean\n');
}

main()
  .catch((err) => { console.error('[seed] HATA:', err); process.exit(1); })
  .finally(() => mongoose.disconnect());
