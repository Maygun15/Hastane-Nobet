#!/usr/bin/env node
'use strict';

/**
 * Acil provası için YEREL deneme veritabanını doldurur.
 *
 * GÜVENLİK: Sadece 127.0.0.1 / localhost veritabanında çalışır; .env dosyasını
 * OKUMAZ. MONGODB_URI açıkça verilmezse veya yerel değilse çalışmayı reddeder.
 *
 * Kullanım:
 *   MONGODB_URI=mongodb://127.0.0.1:27018/nobet_prova \
 *   node scripts/acilProvaSeed.js --staff HEMŞIRELER.xlsx \
 *     --template nobet_cizelgesi_hemşireler_2026-03.xlsx --year 2026 --month 12 \
 *     --credentials /yol/prova-giris.txt
 *
 * Oluşturur: "Prova Hastane", bir yönetici + bir personel kullanıcısı (rastgele
 * şifre, --credentials dosyasına yazılır), Excel'deki tüm personel (TC/telefon
 * yazılmaz), ve hedef ay için taslak çizelge şablonu (defs).
 */

const crypto = require('crypto');
const fs = require('fs');
const mongoose = require('mongoose');
const { loadStaff, loadTemplateDefs } = require('./acilProva');

const SECTION_ID = 'calisma-cizelgesi';
const SERVICE_CODE = 'ACIL';
const ROLE = 'Nurse';
const DB_NAME = 'hastane'; // index.js ile aynı dbName

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return out;
}

function assertLocalUri(uri) {
  if (!uri) throw new Error('MONGODB_URI açıkça verilmeli (ör. mongodb://127.0.0.1:27018/nobet_prova).');
  let host;
  try { host = new URL(uri).hostname; } catch { throw new Error('MONGODB_URI okunamadı.'); }
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    throw new Error(`Güvenlik: sadece yerel veritabanına yazılır (verilen host: ${host}).`);
  }
}

const randomPassword = () => crypto.randomBytes(12).toString('base64url');

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const uri = process.env.MONGODB_URI;
  assertLocalUri(uri);
  if (!args.staff || !args.template || !args.credentials) {
    throw new Error('--staff, --template ve --credentials zorunlu.');
  }
  const year = Number(args.year || 2026);
  const month = Number(args.month || 12);

  await mongoose.connect(uri, { dbName: DB_NAME, serverSelectionTimeoutMS: 5000 });
  const Hospital = require('../models/Hospital');
  const User = require('../models/User');
  const Person = require('../models/Person');
  const MonthlySchedule = require('../models/MonthlySchedule');
  require('../models/Assignment'); // MonthlySchedule silme kancası Assignment modelini kullanır

  const hospital = await Hospital.findOneAndUpdate(
    { slug: 'prova-hastane' },
    { $setOnInsert: { name: 'Prova Hastane', slug: 'prova-hastane', contactEmail: 'yonetici@prova.test', active: true } },
    { upsert: true, new: true }
  );
  const hospitalId = hospital._id;

  // Servis: ekran servisi _id ile tanır; personel ve çizelge bu kimliği kullanır.
  require('../routes/services.routes');
  const Service = mongoose.model('Service');
  const service = await Service.findOneAndUpdate(
    { hospitalId, code: SERVICE_CODE },
    { $setOnInsert: { hospitalId, code: SERVICE_CODE, name: 'Acil Servis', active: true } },
    { upsert: true, new: true }
  );
  const SERVICE_ID = String(service._id);

  // Personel (TC / telefon / e-posta YAZILMAZ)
  const staff = await loadStaff(args.staff);
  await Person.deleteMany({ hospitalId });
  const persons = await Person.insertMany(staff.map((s) => ({
    hospitalId,
    serviceId: SERVICE_ID,
    name: s.name,
    active: true,
    meta: { role: s.role || ROLE, title: s.title, unvan: s.title, areas: s.meta.areas, shiftCodes: s.meta.shiftCodes },
  })));

  // Kullanıcılar
  const adminPass = randomPassword();
  const staffPass = randomPassword();
  const staffPerson = persons.find((p, i) => staff[i].meta.areas.length && staff[i].meta.shiftCodes.includes('N')) || persons[0];

  async function upsertUser(email, fields, password) {
    let u = await User.findOne({ email });
    if (!u) u = new User({ email });
    Object.assign(u, fields, { hospitalId, active: true, mustChangePassword: false });
    await u.setPassword(password);
    await u.save();
    return u;
  }
  const admin = await upsertUser('yonetici@prova.test', { name: 'Prova Yönetici', role: 'admin', serviceIds: [SERVICE_ID] }, adminPass);
  const staffUser = await upsertUser('personel@prova.test', { name: staffPerson.name, role: 'user', serviceIds: [SERVICE_ID], personId: staffPerson._id }, staffPass);
  await Person.updateOne({ _id: staffPerson._id }, { $set: { userId: staffUser._id } });

  // Hedef ay: taslak şablon
  const defs = await loadTemplateDefs(args.template);
  await MonthlySchedule.deleteMany({ hospitalId, sectionId: SECTION_ID, role: ROLE, year, month });
  await mongoose.connection.db.collection('assignments').deleteMany({ hospitalId, year, month });
  await MonthlySchedule.create({
    hospitalId, sectionId: SECTION_ID, serviceId: SERVICE_ID, role: ROLE, year, month,
    data: { defs },
    publication: { status: 'draft', draftedAt: new Date(), draftedBy: String(admin._id), draftReason: 'prova' },
    createdBy: String(admin._id),
  });

  fs.writeFileSync(args.credentials, [
    'Acil provası — YEREL deneme girişleri (gerçek sistemde geçersiz)',
    `Yönetici : yonetici@prova.test / ${adminPass}`,
    `Personel : personel@prova.test / ${staffPass}  (${staffPerson.name})`,
    '',
  ].join('\n'), { mode: 0o600 });

  console.log(JSON.stringify({
    ok: true,
    veritabani: `${new URL(uri).host}/${DB_NAME}`,
    hastane: String(hospitalId),
    servisId: SERVICE_ID,
    personel: persons.length,
    gorevSatiri: defs.length,
    ay: `${year}-${String(month).padStart(2, '0')}`,
    girisBilgileri: args.credentials,
  }, null, 2));
}

main()
  .catch((err) => { console.error('[acilProvaSeed]', err.message || err); process.exitCode = 1; })
  .finally(() => mongoose.disconnect().catch(() => {}));
