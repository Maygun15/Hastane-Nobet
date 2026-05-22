#!/usr/bin/env node
/**
 * Demo verisi üreticisi — Başhekime gösterilebilecek dolu ve gerçekçi çizelge.
 *
 * Kullanım  : node my-backend-project/scripts/seedDemoData.js
 * Temizleme : node my-backend-project/scripts/seedDemoData.js --clean
 * Ay seçimi : DEMO_YEAR=2026 DEMO_MONTH=6 node my-backend-project/scripts/seedDemoData.js
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/hastane';
const CLEAN  = process.argv.includes('--clean');
// --unfair: Adillik skorunu kasıtlı olarak düşük üret (sunum demo'su için)
const UNFAIR = process.argv.includes('--unfair');

const NOW = new Date();
const YEAR  = Number(process.env.DEMO_YEAR)  || NOW.getFullYear();
const MONTH = Number(process.env.DEMO_MONTH) || (NOW.getMonth() + 1);

// ── Vardiya şablonları ────────────────────────────────────────────────────────
// Gece 22:00 başlar (BUG-09: isNightShiftDef eşiği 22:00)
const SHIFTS = [
  { id: 'shift-s', code: 'S', label: 'Sabah Vardiyası', startTime: '08:00', endTime: '16:00', hours: 8,  startHour: 8,  isNight: false },
  { id: 'shift-a', code: 'A', label: 'Akşam Vardiyası', startTime: '16:00', endTime: '22:00', hours: 6,  startHour: 16, isNight: false },
  { id: 'shift-g', code: 'G', label: 'Gece Nöbeti',     startTime: '22:00', endTime: '08:00', hours: 10, startHour: 22, isNight: true  },
];

// ── Personel şablonları ───────────────────────────────────────────────────────
const NURSE_ROSTER = [
  { firstName: 'Ayşe',    lastName: 'Kaya',    title: 'Sorumlu Hemşire', tc: '20000000001' },
  { firstName: 'Fatma',   lastName: 'Yılmaz',  title: 'Hemşire',         tc: '20000000002' },
  { firstName: 'Zeynep',  lastName: 'Demir',   title: 'Hemşire',         tc: '20000000003' },
  { firstName: 'Elif',    lastName: 'Şahin',   title: 'Hemşire',         tc: '20000000004' },
  { firstName: 'Merve',   lastName: 'Çelik',   title: 'Hemşire',         tc: '20000000005' },
  { firstName: 'Hatice',  lastName: 'Arslan',  title: 'Hemşire',         tc: '20000000006' },
];
const DOCTOR_ROSTER = [
  { firstName: 'Mehmet',  lastName: 'Öztürk',  title: 'Uzman Doktor',    tc: '20000000007' },
  { firstName: 'Ahmet',   lastName: 'Koç',     title: 'Asistan Doktor',  tc: '20000000008' },
  { firstName: 'Mustafa', lastName: 'Aydın',   title: 'Uzman Doktor',    tc: '20000000009' },
  { firstName: 'İbrahim', lastName: 'Yıldız',  title: 'Asistan Doktor',  tc: '20000000010' },
];

// ── Yardımcı fonksiyonlar ─────────────────────────────────────────────────────

function daysInMonth(y, m) { return new Date(y, m, 0).getDate(); }

function isoDate(y, m, d) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function addDays(dateStr, n) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

// Deterministic pick: verilen index ve seed'e göre candidates dizisinden seçer.
// Aynı script çalıştırıldığında aynı çizelgeyi üretir.
function deterministicPick(candidates, seed) {
  if (candidates.length === 0) return null;
  return candidates[Math.abs(seed * 2654435761) % candidates.length];
}

// ── Kısıt tabanlı çizelge üretici ───────────────────────────────────────────
//
// Kurallar (constraints.js ile uyumlu):
//   • ONE_SHIFT_PER_DAY: aynı kişi aynı günde birden fazla atama alamaz
//   • MAX_CONSECUTIVE_DAYS=2: ardışık 2 günden fazla nöbet yok (3+ yasak)
//   • NIGHT_NEXT_DAY_OFF: gece nöbetinden sonra ertesi gün atama yok

function buildSchedule(staff, year, month, unfair = false) {
  const totalDays = daysInMonth(year, month);

  // Kişi başı takip durumu
  const st = new Map();
  for (const p of staff) {
    st.set(p._id.toString(), {
      shifts: 0,
      lastDates: [],     // son 3 atama tarihi (ascending)
      nightBlock: null,  // gece nöbeti sonrası bloke tarih
    });
  }

  const nurses  = staff.filter(p => p.meta?.role === 'Hemşire');
  const doctors = staff.filter(p => p.meta?.role === 'Doktor');

  // Unfair mod: belirli personeli gece & hafta sonu nöbetlerine yığar.
  // Hemşirelerin son 2'si (Elif Şahin, Merve Çelik) tüm gece nöbetlerini üstlenir;
  // doktorların ilk 2'si (Mehmet Öztürk, Ahmet Koç) hafta sonu nöbetine yığılır.
  const nightTargets   = unfair ? new Set(nurses.slice(-2).map(p => p._id.toString())) : null;
  const weekendTargets = unfair ? new Set(doctors.slice(0, 2).map(p => p._id.toString())) : null;

  function canWork(pid, today) {
    const s = st.get(pid);
    if (s.nightBlock === today) return false;

    const len = s.lastDates.length;
    if (len >= 2) {
      const d1 = addDays(today, -1);
      const d2 = addDays(today, -2);
      if (s.lastDates[len - 1] === d1 && s.lastDates[len - 2] === d2) return false;
    }
    return true;
  }

  function mark(pid, today, isNight) {
    const s = st.get(pid);
    s.shifts++;
    s.lastDates.push(today);
    if (s.lastDates.length > 3) s.lastDates.shift();
    if (isNight) s.nightBlock = addDays(today, 1);
  }

  function pick(group, today, dayNum, used, shift) {
    if (unfair) {
      const wd = new Date(today).getDay();
      const isWeekendDay = wd === 0 || wd === 6;

      // Gece nöbetini nightTargets'a yığ
      if (shift?.isNight && nightTargets) {
        const forced = group.filter(p => {
          const pid = p._id.toString();
          return nightTargets.has(pid) && !used.has(pid) && canWork(pid, today);
        });
        if (forced.length > 0) return deterministicPick(forced, dayNum);
      }

      // Hafta sonu gündüz nöbetini weekendTargets'a yığ
      if (!shift?.isNight && isWeekendDay && weekendTargets) {
        const forced = group.filter(p => {
          const pid = p._id.toString();
          return weekendTargets.has(pid) && !used.has(pid) && canWork(pid, today);
        });
        if (forced.length > 0) return deterministicPick(forced, dayNum);
      }
    }

    const eligible = group.filter(p => {
      const pid = p._id.toString();
      return !used.has(pid) && canWork(pid, today);
    });
    if (eligible.length === 0) return null;
    const minShifts = Math.min(...eligible.map(p => st.get(p._id.toString()).shifts));
    const candidates = eligible.filter(p => st.get(p._id.toString()).shifts === minShifts);
    return deterministicPick(candidates, dayNum);
  }

  const rows = [];

  for (let d = 1; d <= totalDays; d++) {
    const today = isoDate(year, month, d);
    const wd    = new Date(year, month - 1, d).getDay();
    const used  = new Set();

    // Her gün için slot planı: [vardiya, grup, slotSeed]
    const plan = [
      [SHIFTS[0], nurses,  d * 10 + 1],  // Sabah — hemşire
      [SHIFTS[1], nurses,  d * 10 + 2],  // Akşam — hemşire
      [SHIFTS[2], nurses,  d * 10 + 3],  // Gece  — hemşire
      [SHIFTS[0], doctors, d * 10 + 4],  // Sabah — doktor
      [SHIFTS[2], doctors, d * 10 + 5],  // Gece  — doktor
    ];

    for (const [shift, group, seed] of plan) {
      const person = pick(group, today, seed, used, shift);
      if (!person) {
        console.warn(`  [!] ${today} ${shift.code}: uygun personel bulunamadı, slot boş bırakıldı`);
        continue;
      }
      const pid = person._id.toString();
      used.add(pid);
      mark(pid, today, shift.isNight);
      rows.push({ date: today, day: d, weekday: wd, person, shift });
    }
  }

  // Özet istatistik
  for (const [pid, s] of st.entries()) {
    const person = staff.find(p => p._id.toString() === pid);
    console.log(
      `  ${(person?.name || pid).padEnd(20)} | ${String(s.shifts).padStart(2)} nöbet` +
      ` | ${s.nightBlock ? 'son blok: ' + s.nightBlock : ''}`
    );
  }

  return rows;
}

// ── Ana akış ─────────────────────────────────────────────────────────────────

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log('[demo] MongoDB bağlandı:', MONGODB_URI);

  const Hospital        = require('../models/Hospital');
  const Person          = require('../models/Person');
  const MonthlySchedule = require('../models/MonthlySchedule');
  const Assignment      = require('../models/Assignment');
  const LeaveBalance    = require('../models/LeaveBalance');

  // ── Temizleme modu ────────────────────────────────────────────────────────
  if (CLEAN) {
    const hospital = await Hospital.findOne({ slug: 'demo-hastane' }).lean();
    if (hospital) {
      const hId = hospital._id;
      const people = await Person.find({ hospitalId: hId, 'meta.seedTag': 'demo-2026' }).select('_id').lean();
      const pIds = people.map(p => String(p._id));

      const [pa, pb, pc] = await Promise.all([
        Assignment.deleteMany({ hospitalId: hId, sectionId: 'calisma-cizelgesi', serviceId: 'demo-acil-servis' }),
        MonthlySchedule.deleteMany({ hospitalId: hId, sectionId: 'calisma-cizelgesi', serviceId: 'demo-acil-servis' }),
        LeaveBalance.deleteMany({ hospitalId: hId, personId: { $in: pIds } }),
      ]);
      await Person.deleteMany({ hospitalId: hId, 'meta.seedTag': 'demo-2026' });
      console.log(`[demo] Temizlendi — Atama: ${pa.deletedCount}, Çizelge: ${pb.deletedCount}, İzin: ${pc.deletedCount}, Kişi: ${people.length}`);
    } else {
      console.log('[demo] Demo hastane bulunamadı, temizlenecek veri yok.');
    }
    return;
  }

  // ── Hastane ───────────────────────────────────────────────────────────────
  let hospital = await Hospital.findOne({ slug: 'demo-hastane' }).lean();
  if (!hospital) {
    hospital = await Hospital.create({ name: 'Demo Hastane', slug: 'demo-hastane', active: true });
    console.log('[demo] Hastane oluşturuldu: demo-hastane');
  }
  const hId = hospital._id;
  const serviceId = 'demo-acil-servis';

  // ── Personel (upsert, idempotent) ─────────────────────────────────────────
  console.log(`\n[demo] ${YEAR}-${MONTH} için personel oluşturuluyor…`);

  async function upsertPerson(tmpl, role) {
    const name = `${tmpl.firstName} ${tmpl.lastName}`;
    return Person.findOneAndUpdate(
      { hospitalId: hId, tc: tmpl.tc },
      {
        hospitalId: hId,
        serviceId,
        name,
        firstName: tmpl.firstName,
        lastName:  tmpl.lastName,
        tc:        tmpl.tc,
        email:     `${tmpl.firstName.toLowerCase().replace(/[^a-z]/gi, '')}.${tmpl.lastName.toLowerCase().replace(/[^a-z]/gi, '')}@demo.hastane.test`,
        active:    true,
        meta: { role, title: tmpl.title, seedTag: 'demo-2026' },
      },
      { upsert: true, new: true }
    ).lean();
  }

  const nurses  = await Promise.all(NURSE_ROSTER.map(t => upsertPerson(t, 'Hemşire')));
  const doctors = await Promise.all(DOCTOR_ROSTER.map(t => upsertPerson(t, 'Doktor')));
  const allStaff = [...nurses, ...doctors];
  console.log(`  Hemşire: ${nurses.length}, Doktor: ${doctors.length} → toplam ${allStaff.length} personel`);

  // ── Kısıt uyumlu çizelge üret ─────────────────────────────────────────────
  if (UNFAIR) {
    console.log('\n⚠️  [demo] UNFAIR modu aktif: Elif Şahin & Merve Çelik gece nöbetlerine, Mehmet Öztürk & Ahmet Koç hafta sonu nöbetlerine yığılıyor.');
    console.log('    Adillik skoru kasıtlı olarak düşük çıkacaktır — sunumda "sistem dengesizliği tespit ediyor" demo\'su için kullanın.\n');
  }
  console.log(`\n[demo] ${YEAR}-${MONTH} çizelgesi oluşturuluyor (kısıtlar aktif${UNFAIR ? ', UNFAIR modu' : ''})…`);
  const scheduleRows = buildSchedule(allStaff, YEAR, MONTH, UNFAIR);
  console.log(`  Üretilen atama satırı: ${scheduleRows.length}`);

  // ── MonthlySchedule ───────────────────────────────────────────────────────
  const msData = {
    rows:  SHIFTS.map(s => ({ id: s.id, code: s.code, label: s.label, startTime: s.startTime, endTime: s.endTime, hours: s.hours })),
    staff: allStaff.map(p => ({ id: String(p._id), name: p.name, role: p.meta?.role, title: p.meta?.title })),
    generatedBy: 'seedDemoData',
    generatedAt: new Date().toISOString(),
    totalAssignments: scheduleRows.length,
  };

  const monthlySchedule = await MonthlySchedule.findOneAndUpdate(
    { hospitalId: hId, sectionId: 'calisma-cizelgesi', serviceId, role: '', year: YEAR, month: MONTH },
    {
      hospitalId: hId,
      sectionId: 'calisma-cizelgesi',
      serviceId,
      role: '',
      year: YEAR,
      month: MONTH,
      data: msData,
      meta: { seedTag: 'demo-2026' },
      createdBy: 'seedDemoData',
    },
    { upsert: true, new: true }
  );
  console.log(`\n[demo] MonthlySchedule: ${monthlySchedule._id}`);

  // ── Assignment'lar (toplu upsert) ─────────────────────────────────────────
  // Önce eski varsa temizle (idempotent çalışma için)
  await Assignment.deleteMany({
    hospitalId: hId,
    sectionId:  'calisma-cizelgesi',
    serviceId,
    year:  YEAR,
    month: MONTH,
  });

  const assignmentDocs = scheduleRows.map(r => {
    const pid  = String(r.person._id);
    const role = r.person.meta?.role || '';
    const taskKey   = `${r.shift.id}|`;
    const personKey = pid;
    return {
      hospitalId:       hId,
      sourceScheduleId: monthlySchedule._id,
      sectionId:        'calisma-cizelgesi',
      serviceId,
      role,
      year:             YEAR,
      month:            MONTH,
      date:             r.date,
      day:              r.day,
      weekday:          r.weekday,
      rowId:            r.shift.id,
      shiftId:          r.shift.id,
      shiftCode:        r.shift.code,
      roleLabel:        r.shift.label,
      taskKey,
      personId:         pid,
      personName:       r.person.name,
      personKey,
      hours:            r.shift.hours,
      source:           'seedDemoData',
      status:           'active',
      createdBy:        'seedDemoData',
    };
  });

  await Assignment.insertMany(assignmentDocs, { ordered: false });
  console.log(`[demo] ${assignmentDocs.length} atama eklendi.`);

  // ── LeaveBalance (her kişiye yıllık + hastalık) ────────────────────────────
  console.log('\n[demo] İzin bakiyeleri oluşturuluyor…');

  // Çizelgedeki nöbet sayısını kullanarak "gerçekçi" hastalık izni ekleyelim
  const shiftCountMap = new Map();
  for (const r of scheduleRows) {
    const pid = String(r.person._id);
    shiftCountMap.set(pid, (shiftCountMap.get(pid) || 0) + 1);
  }

  for (const person of allStaff) {
    const pid = String(person._id);
    const idx = allStaff.indexOf(person);

    // Yıllık izin: allocated 14, used 2-7 (deterministic based on person index)
    const yillikUsed = 2 + (idx * 3) % 6;  // 2, 5, 2, 5, 2, 5, 2, 5, 2, 5
    const yillikAlloc = 14;

    // Hastalık izni: allocated 30, used 0-4 (sadece bazı personelde)
    const hastalikUsed = idx % 3 === 0 ? 0 : (idx % 3 === 1 ? 2 : 1);
    const hastalikAlloc = 30;

    await Promise.all([
      LeaveBalance.findOneAndUpdate(
        { hospitalId: hId, personId: pid, leaveTypeId: 'demo-yillik', year: YEAR },
        {
          hospitalId: hId, personId: pid,
          personName: person.name,
          leaveTypeId: 'demo-yillik',
          leaveTypeName: 'Yıllık İzin',
          year: YEAR,
          allocated: yillikAlloc,
          used: yillikUsed,
          remaining: yillikAlloc - yillikUsed,
        },
        { upsert: true, new: true }
      ),
      LeaveBalance.findOneAndUpdate(
        { hospitalId: hId, personId: pid, leaveTypeId: 'demo-hastalik', year: YEAR },
        {
          hospitalId: hId, personId: pid,
          personName: person.name,
          leaveTypeId: 'demo-hastalik',
          leaveTypeName: 'Hastalık İzni',
          year: YEAR,
          allocated: hastalikAlloc,
          used: hastalikUsed,
          remaining: hastalikAlloc - hastalikUsed,
        },
        { upsert: true, new: true }
      ),
    ]);
  }
  console.log(`  ${allStaff.length * 2} izin bakiyesi oluşturuldu (2 tür × ${allStaff.length} kişi).`);

  // ── Özet ──────────────────────────────────────────────────────────────────
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log(`║  Demo verisi hazır — ${String(YEAR) + '-' + String(MONTH).padStart(2,'0')}                            ║`);
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║  Personel  : ${String(allStaff.length).padStart(3)} (${nurses.length} hemşire, ${doctors.length} doktor)               ║`);
  console.log(`║  Atama     : ${String(assignmentDocs.length).padStart(3)} (${daysInMonth(YEAR,MONTH)} gün × 5 slot)                  ║`);
  console.log(`║  İzin kydı : ${String(allStaff.length * 2).padStart(3)}                                          ║`);
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log('║  Vardiyalar: S=Sabah 08-16  A=Akşam 16-22  G=Gece 22-08 ║');
  console.log('║  Kısıtlar : ardışık 2 gün max, gece→ertesi off          ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log('║  Temizle  : node scripts/seedDemoData.js --clean         ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
}

main()
  .catch((err) => { console.error('[demo] HATA:', err.message, err.stack); process.exit(1); })
  .finally(() => mongoose.disconnect());
