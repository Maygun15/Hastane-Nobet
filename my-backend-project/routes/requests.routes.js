// routes/requests.routes.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Request = require('../models/Request');
const Person = require('../models/Person');
const MonthlySchedule = require('../models/MonthlySchedule');
const Assignment = require('../models/Assignment');
const Setting = require('../models/Setting');
const LeaveBalance = require('../models/LeaveBalance');
const LeaveType = require('../models/LeaveType');
const {
  sendLeaveApproved,
  sendLeaveRejected,
  sendShiftChanged,
  sendNewRequestNotification,
} = require('../services/notificationService');
const { replaceAssignmentsForSchedule } = require('../services/assignmentSyncService');
const { suggestSwaps } = require('../services/swapSuggestionService');
const { withHospitalFilter, isSuperAdminRole, getHospitalContext } = require('../middleware/hospital');
const ScheduleRules = require('../models/ScheduleRules');
const { validateAssignment } = require('../utils/rulesValidator');
const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
const safeMessage = (err, fallback = 'Sunucu hatası') =>
  isProd ? fallback : (err?.message || fallback);
const REQUEST_STATUS = new Set(['pending', 'approved', 'rejected', 'deleted']);
const SOFT_DELETE_KEEP_DAYS = 180;

/* ── İzin onayını transaction içinde atomic yap ──
 *
 * Replica-set varsa gerçek MongoDB transaction kullanır; yoksa CAS-first
 * sequential fallback ile çalışır ve başarısız yazma durumunda request
 * durumunu previousStatus'a geri alır (compensation).
 *
 * Dönüş: { updated: RequestDoc|null, error: null|'CONFLICT'|string }
 */
async function approveLeaveWithTransaction(req, request, previousStatus, adminNote, actorUserId) {
  const { fromPersonId, targetDate, targetDateEnd, serviceId, message, leaveTypeCode, hospitalId: hid } = request;

  if (!fromPersonId || !targetDate || !hid) {
    const upd = await Request.findOneAndUpdate(
      withHospitalFilter(req, { _id: request._id, status: previousStatus }),
      { $set: { status: 'approved', adminNote: adminNote || '', resolvedBy: actorUserId, resolvedAt: new Date() } },
      { new: true }
    );
    return { updated: upd, error: upd ? null : 'CONFLICT' };
  }

  const leaveCode = String(leaveTypeCode || 'YILLIK').trim().toUpperCase();
  const start = new Date(`${String(targetDate).slice(0, 10)}T00:00:00`);
  const end   = new Date(`${String(targetDateEnd || targetDate).slice(0, 10)}T00:00:00`);
  if (isNaN(start) || isNaN(end) || end < start) {
    return { updated: null, error: 'Geçersiz tarih aralığı' };
  }
  const dayDiff = Math.round((end - start) / 86_400_000);
  if (dayDiff >= 365) return { updated: null, error: 'İzin aralığı çok uzun (max 365 gün)' };

  const totalDays = dayDiff + 1;
  const year = start.getFullYear();
  const pid  = String(fromPersonId);
  // Frontend her zaman /api/leaves?serviceId= (boş) ile okur.
  // request.serviceId ne olursa olsun, her zaman boş bucket'a yaz.
  const sid  = '';

  const byMonth = {};
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const y  = d.getFullYear();
    const m  = d.getMonth() + 1;
    const mk = `${y}-${String(m).padStart(2, '0')}`;
    (byMonth[mk] ??= []).push(d.getDate());
  }
  const entry = message ? { code: leaveCode, note: String(message).slice(0, 200) } : { code: leaveCode };

  const leaveType     = await LeaveType.findOne({ hospitalId: hid, code: leaveCode }).lean();
  const leaveTypeId   = leaveType ? String(leaveType._id) : leaveCode;
  const leaveTypeName = leaveType?.name || leaveCode;

  const startStr = start.toISOString().slice(0, 10);
  const endStr   = end.toISOString().slice(0, 10);

  let updatedRequest;
  let settingDocId;

  async function writeLeaves(sess) {
    for (const [monthKey, days] of Object.entries(byMonth)) {
      const docFilter = { hospitalId: hid, key: 'leavesV2', serviceId: sid };
      let doc = sess
        ? await Setting.findOne(docFilter).session(sess)
        : await Setting.findOne(docFilter);

      if (!doc) {
        doc = new Setting({ hospitalId: hid, key: 'leavesV2', serviceId: sid, value: {} });
      }

      const value = doc.value && typeof doc.value === 'object' ? { ...doc.value } : {};
      value[pid] ??= {};
      value[pid][monthKey] ??= {};
      for (const day of days) value[pid][monthKey][String(day)] = entry;
      doc.value = value;
      doc.markModified('value');
      await doc.save(sess ? { session: sess } : undefined);
      settingDocId ??= doc._id;
    }
  }

  async function writeBalance(sess) {
    await LeaveBalance.findOneAndUpdate(
      { hospitalId: hid, personId: pid, leaveTypeId, year },
      [
        {
          $set: {
            hospitalId:    { $ifNull: ['$hospitalId',    hid] },
            personId:      { $ifNull: ['$personId',      pid] },
            personName:    { $ifNull: ['$personName',    request.fromName || ''] },
            leaveTypeId:   { $ifNull: ['$leaveTypeId',   leaveTypeId] },
            leaveTypeName: { $ifNull: ['$leaveTypeName', leaveTypeName] },
            year:          { $ifNull: ['$year',          year] },
            allocated:     { $ifNull: ['$allocated',     leaveType?.maxDaysPerYear ?? 0] },
            used:          { $add:    [{ $ifNull: ['$used', 0] }, totalDays] },
          },
        },
        { $set: { remaining: { $max: [0, { $subtract: ['$allocated', '$used'] }] } } },
      ],
      sess ? { upsert: true, new: true, session: sess } : { upsert: true, new: true }
    );
  }

  async function casRequest(sess) {
    const upd = await Request.findOneAndUpdate(
      withHospitalFilter(req, { _id: request._id, status: previousStatus }),
      {
        $set: {
          status:        'approved',
          adminNote:     adminNote || '',
          resolvedBy:    actorUserId,
          resolvedAt:    new Date(),
          leaveRecordId: settingDocId || null,
        },
      },
      sess ? { new: true, session: sess } : { new: true }
    );
    if (!upd) throw Object.assign(new Error('Talep durumu değişti, lütfen sayfayı yenileyin'), { code: 'CONFLICT' });
    updatedRequest = upd;
  }

  let session;
  try {
    session = await mongoose.startSession();
    await session.withTransaction(async () => {
      await writeLeaves(session);
      await writeBalance(session);
      await casRequest(session);
    });
  } catch (txErr) {
    if (txErr?.code === 'CONFLICT') {
      if (session) await session.endSession().catch(() => {});
      return { updated: null, error: 'CONFLICT' };
    }

    const isNoReplicaSet = txErr?.codeName === 'IllegalOperation'
      || txErr?.message?.includes('Transaction')
      || txErr?.message?.includes('replica');

    if (isNoReplicaSet) {
      // Standalone MongoDB: CAS önce, ardından yazma (compensation pattern)
      console.warn('[leave-approve] Transaction desteği yok, standalone fallback kullanılıyor');
      try {
        const upd = await Request.findOneAndUpdate(
          withHospitalFilter(req, { _id: request._id, status: previousStatus }),
          { $set: { status: 'approved', adminNote: adminNote || '', resolvedBy: actorUserId, resolvedAt: new Date() } },
          { new: true }
        );
        if (!upd) {
          if (session) await session.endSession().catch(() => {});
          return { updated: null, error: 'CONFLICT' };
        }
        updatedRequest = upd;

        await writeLeaves(null);
        await writeBalance(null);

        if (settingDocId) {
          await Request.updateOne(
            withHospitalFilter(req, { _id: request._id }),
            { $set: { leaveRecordId: settingDocId } }
          );
          updatedRequest.leaveRecordId = settingDocId;
        }
      } catch (fbErr) {
        // Compensation: Request durumunu geri al
        if (updatedRequest) {
          await Request.updateOne(
            withHospitalFilter(req, { _id: request._id }),
            { $set: { status: previousStatus, adminNote: '' } }
          ).catch((e) => console.error('[leave-approve][fallback-revert] ERR:', e?.message || e));
        }
        // Compensation: writeLeaves tarafından yazılan izin günlerini geri al
        if (settingDocId) {
          try {
            const lDoc = await Setting.findById(settingDocId);
            if (lDoc?.value && typeof lDoc.value === 'object') {
              const val = { ...lDoc.value };
              for (const [mk, mDays] of Object.entries(byMonth)) {
                if (val[pid]?.[mk]) {
                  for (const d of mDays) delete val[pid][mk][String(d)];
                  if (!Object.keys(val[pid][mk]).length) delete val[pid][mk];
                }
              }
              if (val[pid] && !Object.keys(val[pid]).length) delete val[pid];
              lDoc.value = val;
              lDoc.markModified('value');
              await lDoc.save();
            }
          } catch (revertLeavesErr) {
            console.error('[leave-approve][fallback-revert-leaves] ERR:', revertLeavesErr?.message || revertLeavesErr);
          }
        }
        if (session) await session.endSession().catch(() => {});
        return { updated: null, error: 'İşlem sırasında hata oluştu, bakiye güncellenemedi' };
      }
    } else {
      console.error('[leave-approve] Transaction rollback:', txErr?.message);
      if (session) await session.endSession().catch(() => {});
      return { updated: null, error: 'İşlem sırasında hata oluştu, bakiye güncellenemedi' };
    }
  }

  if (session) await session.endSession().catch(() => {});

  return { updated: updatedRequest, error: null };
}

/* ── İzin geri alındığında/reddedildiğinde LeaveBalance + leavesV2 geri al ── */
async function revertLeaveBalance(request) {
  const { fromPersonId, targetDate, targetDateEnd, leaveTypeCode, hospitalId: hid } = request;
  if (!fromPersonId || !targetDate) return;

  const leaveCode = String(leaveTypeCode || 'YILLIK').trim().toUpperCase();
  const start = new Date(`${String(targetDate).slice(0, 10)}T00:00:00`);
  const end   = new Date(`${String(targetDateEnd || targetDate).slice(0, 10)}T00:00:00`);
  if (isNaN(start) || isNaN(end) || end < start) return;

  const totalDays = Math.round((end - start) / 86_400_000) + 1;
  const year = start.getFullYear();
  const pid  = String(fromPersonId);

  // LeaveBalance geri al — negatife düşmesin
  const leaveType   = await LeaveType.findOne({ hospitalId: hid, code: leaveCode });
  const leaveTypeId = leaveType ? String(leaveType._id) : leaveCode;
  await LeaveBalance.updateOne(
    { hospitalId: hid, personId: pid, leaveTypeId, year },
    [
      { $set: { used: { $max: [0, { $subtract: ['$used', totalDays] }] } } },
      { $set: { remaining: { $subtract: ['$allocated', '$used'] } } },
    ]
  );

  // leavesV2 Setting'den izin günlerini sil
  const byMonth = {};
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    (byMonth[mk] ??= []).push(d.getDate());
  }
  try {
    const lDoc = await Setting.findOne({ hospitalId: hid, key: 'leavesV2', serviceId: '' });
    if (lDoc?.value && typeof lDoc.value === 'object') {
      const val = { ...lDoc.value };
      for (const [mk, days] of Object.entries(byMonth)) {
        if (val[pid]?.[mk]) {
          for (const d of days) delete val[pid][mk][String(d)];
          if (!Object.keys(val[pid][mk]).length) delete val[pid][mk];
        }
      }
      if (val[pid] && !Object.keys(val[pid]).length) delete val[pid];
      lDoc.value = val;
      lDoc.markModified('value');
      await lDoc.save();
    }
  } catch (err) {
    console.error('[leave-revert] leavesV2 silme hatası:', err?.message || err);
  }
}

/* ── Takas yardımcıları ── */
function swapCanonName(str = '') {
  return String(str || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleUpperCase('tr-TR').replace(/\s+/g, ' ').trim();
}
function swapAddDays(dateStr, n) {
  const d = new Date(String(dateStr) + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function isNightShiftDef(def) {
  if (!def) return false;
  const start = String(def?.start || def?.from || '').trim();
  const end   = String(def?.end   || def?.to   || '').trim();
  if (!start || !end) return false;
  const sh = Number(start.split(':')[0]);
  const eh = Number(end.split(':')[0]);
  if (!Number.isFinite(sh) || !Number.isFinite(eh)) return false;
  return sh >= 22 || eh < sh; // 22:00+ başlayan veya gece yarısını geçen vardiya
}

/* Takas çalışma kuralı kontrolü — onaylamadan önce çağrılır */
async function checkSwapConflicts(request) {
  const { fromPersonId, fromName, swapWithPersonId, swapSectionId,
    swapMyDate, swapMyShiftId, swapTargetDate, swapTargetShiftId } = request;
  if (!fromPersonId || !swapWithPersonId || !swapMyDate || !swapTargetDate) return null;

  function ym(d) { const m = String(d).slice(0, 10).match(/^(\d{4})-(\d{2})/); return m ? { year: Number(m[1]), month: Number(m[2]) } : null; }
  const myYm = ym(swapMyDate); const tYm = ym(swapTargetDate);
  if (!myYm || !tYm) return null;

  const sectionId = String(swapSectionId || '');
  const fromPid   = String(fromPersonId);
  const toPid     = String(swapWithPersonId);
  const myDate    = String(swapMyDate).slice(0, 10);
  const tDate     = String(swapTargetDate).slice(0, 10);
  const myShift   = String(swapMyShiftId || '').toUpperCase();
  const tShift    = String(swapTargetShiftId || '').toUpperCase();

  const [fromPerson, toPerson] = await Promise.all([
    Person.findById(fromPersonId).lean(),
    Person.findById(swapWithPersonId).lean(),
  ]);
  const fromDisplayName = fromPerson?.name || fromName || 'Talep eden';
  const toDisplayName   = toPerson?.name || 'Diğer personel';

  // Çizelge dokümanları
  const docs = await Promise.all([
    MonthlySchedule.findOne({ sectionId, year: myYm.year, month: myYm.month }).lean(),
    myYm.year !== tYm.year || myYm.month !== tYm.month
      ? MonthlySchedule.findOne({ sectionId, year: tYm.year, month: tYm.month }).lean()
      : null,
  ]);
  const myDoc = docs[0];
  const tDoc  = docs[1] || myDoc;

  function getDefs(doc) { return Array.isArray(doc?.data?.defs) ? doc.data.defs : []; }

  // assignments[] veya namedAssignments formatından birleşik liste üret
  function getAllAssignmentEntries(doc) {
    const fromArr = Array.isArray(doc?.data?.assignments) ? doc.data.assignments : [];
    if (fromArr.length > 0) return fromArr;
    // Fallback: namedAssignments (personId yok, sadece isim)
    const named = doc?.data?.roster?.namedAssignments || doc?.data?.namedAssignments;
    if (!named || typeof named !== 'object') return [];
    const defs = getDefs(doc);
    const defById = new Map(defs.map((d) => [String(d?.id || d?.rowId || ''), d]));
    const pad2 = (n) => String(n).padStart(2, '0');
    const entries = [];
    for (const [dayStr, byRow] of Object.entries(named)) {
      const day = Number(dayStr);
      if (!Number.isFinite(day) || day < 1 || day > 31) continue;
      const date = `${doc.year}-${pad2(doc.month)}-${pad2(day)}`;
      for (const [rowId, names] of Object.entries(byRow || {})) {
        const def = defById.get(rowId);
        const shiftCode = String(def?.shiftCode || def?.code || rowId);
        for (const name of (Array.isArray(names) ? names : [])) {
          if (name) entries.push({ date, personName: name, personId: '', shiftId: shiftCode, shiftCode });
        }
      }
    }
    return entries;
  }

  // pid varsa pid ile, yoksa kanonize isimle eşleş
  function personHasShiftOnDate(entries, pid, personName, date, excludeShift) {
    const canonTarget = personName ? swapCanonName(personName) : '';
    return entries.some((a) => {
      const aDate  = String(a?.date || '').slice(0, 10);
      const aPid   = String(a?.personId || '').trim();
      const aShift = String(a?.shiftId || a?.shiftCode || '').trim().toUpperCase();
      if (aDate !== date || aShift === excludeShift) return false;
      if (pid && aPid) return aPid === pid;
      const aName = swapCanonName(String(a?.personName || a?.name || ''));
      return canonTarget ? aName === canonTarget : false;
    });
  }
  function hadNightShiftOnDate(entries, defs, pid, personName, date) {
    const canonTarget = personName ? swapCanonName(personName) : '';
    const defByCode = new Map(defs.map((d) => [String(d?.shiftCode || d?.code || '').toUpperCase(), d]));
    return entries.some((a) => {
      const aDate  = String(a?.date || '').slice(0, 10);
      const aPid   = String(a?.personId || '').trim();
      if (aDate !== date) return false;
      let matches;
      if (pid && aPid) { matches = aPid === pid; }
      else {
        const aName = swapCanonName(String(a?.personName || a?.name || ''));
        matches = canonTarget ? aName === canonTarget : false;
      }
      if (!matches) return false;
      const code = String(a?.shiftId || a?.shiftCode || '').toUpperCase();
      return isNightShiftDef(defByCode.get(code));
    });
  }

  const myEntries = getAllAssignmentEntries(myDoc);
  const tEntries  = getAllAssignmentEntries(tDoc);

  // 1. Aynı gün çakışması: fromPid → tDate (takas edilen değil, başka bir vardiya)
  if (personHasShiftOnDate(tEntries, fromPid, fromDisplayName, tDate, tShift)) {
    return `${fromDisplayName} zaten ${tDate} tarihinde başka bir nöbeti var — aynı güne iki nöbet yazılamaz.`;
  }
  // 2. Aynı gün çakışması: toPid → myDate
  if (personHasShiftOnDate(myEntries, toPid, toDisplayName, myDate, myShift)) {
    return `${toDisplayName} zaten ${myDate} tarihinde başka bir nöbeti var — aynı güne iki nöbet yazılamaz.`;
  }

  // 3. Ardarda nöbet: fromPid gece vardiyasının ertesi günü tDate'e yazılacak mı?
  const prevTDate = swapAddDays(tDate, -1);
  if (hadNightShiftOnDate(tEntries, getDefs(tDoc), fromPid, fromDisplayName, prevTDate)) {
    return `${fromDisplayName} ${prevTDate} tarihinde gece nöbeti çalışıyor — ardarda nöbet yazılamaz.`;
  }
  // 4. Ardarda nöbet: toPid gece vardiyasının ertesi günü myDate'e yazılacak mı?
  const prevMyDate = swapAddDays(myDate, -1);
  if (hadNightShiftOnDate(myEntries, getDefs(myDoc), toPid, toDisplayName, prevMyDate)) {
    return `${toDisplayName} ${prevMyDate} tarihinde gece nöbeti çalışıyor — ardarda nöbet yazılamaz.`;
  }

  return null; // kural ihlali yok
}

/* ── Takas öncesi kural simülasyonu ──
 * Her iki personelin takas sonrası takvim durumunu simüle eder ve
 * ScheduleRules kural setine göre validateAssignment çalıştırır.
 * Orijinal assignments dizisi mutate edilmez — slice() ile kopya alınır.
 * Döndürdüğü: { valid: boolean, violations: Array<{person, errors}> }
 */
async function validateSwap(request) {
  const {
    fromPersonId, fromName,
    swapWithPersonId,
    swapSectionId, swapMyDate, swapMyShiftId,
    swapTargetDate, swapTargetShiftId,
    serviceId, hospitalId,
  } = request;

  if (!fromPersonId || !swapWithPersonId || !swapMyDate || !swapTargetDate) {
    return { valid: true, violations: [] };
  }

  // ScheduleRules çek — yoksa veya devre dışıysa doğrudan geç
  const sectionId = String(swapSectionId || '');
  const rulesFilter = { sectionId };
  if (serviceId) rulesFilter.serviceId = String(serviceId);
  const rulesDoc = await ScheduleRules.findOne(rulesFilter).lean();
  if (!rulesDoc?.enabled) return { valid: true, violations: [] };

  function ym(d) {
    const m = String(d).slice(0, 10).match(/^(\d{4})-(\d{2})/);
    return m ? { year: Number(m[1]), month: Number(m[2]) } : null;
  }
  const myYm = ym(swapMyDate);
  const tYm  = ym(swapTargetDate);
  if (!myYm || !tYm) return { valid: true, violations: [] };

  const fromPid  = String(fromPersonId);
  const toPid    = String(swapWithPersonId);
  const myDate   = String(swapMyDate).slice(0, 10);
  const tDate    = String(swapTargetDate).slice(0, 10);
  const myShift  = String(swapMyShiftId  || '').toUpperCase();
  const tShift   = String(swapTargetShiftId || '').toUpperCase();

  const [fromPerson, toPerson] = await Promise.all([
    Person.findById(fromPersonId).lean(),
    Person.findById(swapWithPersonId).lean(),
  ]);
  const fromDisplayName = fromPerson?.name || fromName || String(fromPersonId);
  const toDisplayName   = toPerson?.name || String(swapWithPersonId);

  // İlgili ay dokümanlarını çek (sadece assignments projeksiyonu)
  const isSameDoc = myYm.year === tYm.year && myYm.month === tYm.month;
  const [myDoc, tDoc] = await Promise.all([
    MonthlySchedule.findOne({ sectionId, year: myYm.year, month: myYm.month })
      .select({ 'data.assignments': 1 }).lean(),
    isSameDoc
      ? Promise.resolve(null)
      : MonthlySchedule.findOne({ sectionId, year: tYm.year, month: tYm.month })
          .select({ 'data.assignments': 1 }).lean(),
  ]);

  // Tüm atamaları immutable olarak birleştir
  const myAssignments = Array.isArray(myDoc?.data?.assignments)
    ? myDoc.data.assignments.slice()
    : [];
  const tAssignments = isSameDoc
    ? myAssignments
    : (Array.isArray(tDoc?.data?.assignments) ? tDoc.data.assignments.slice() : []);

  // Kişi bazlı filtre: personId öncelikli, yoksa normalize isimle eşleş
  function forPerson(list, pid, name) {
    const canonName = swapCanonName(name);
    return list.filter((a) => {
      const apid = String(a?.personId || '').trim();
      if (pid && apid) return apid === pid;
      if (name) return swapCanonName(String(a?.personName || '')) === canonName;
      return false;
    });
  }

  // Takas sonrası simüle edilmiş listeler (orijinal kopyalanmış, mutate edilmiyor)
  const fromCurrentList = forPerson(myAssignments, fromPid, fromDisplayName);
  const toCurrentList   = forPerson(tAssignments,  toPid,   toDisplayName);

  // Kişi A: myDate/myShift çıkar → tDate ekle
  const simFromList = fromCurrentList
    .filter((a) => {
      const aDate  = String(a?.date || a?.day || '').slice(0, 10);
      const aShift = String(a?.shiftId || a?.shiftCode || '').trim().toUpperCase();
      return !(aDate === myDate && aShift === myShift);
    })
    .concat([{ personId: fromPid, personName: fromDisplayName, date: tDate }]);

  // Kişi B: tDate/tShift çıkar → myDate ekle
  const simToList = toCurrentList
    .filter((a) => {
      const aDate  = String(a?.date || a?.day || '').slice(0, 10);
      const aShift = String(a?.shiftId || a?.shiftCode || '').trim().toUpperCase();
      return !(aDate === tDate && aShift === tShift);
    })
    .concat([{ personId: toPid, personName: toDisplayName, date: myDate }]);

  // Her iki kişi için kural kontrolü
  const resultA = validateAssignment(
    rulesDoc,
    { personId: fromPid, personName: fromDisplayName, date: tDate },
    simFromList,
  );
  const resultB = validateAssignment(
    rulesDoc,
    { personId: toPid, personName: toDisplayName, date: myDate },
    simToList,
  );

  const violations = [];
  if (!resultA.valid) {
    violations.push({ person: fromDisplayName, personId: fromPid, errors: resultA.errors });
  }
  if (!resultB.valid) {
    violations.push({ person: toDisplayName, personId: toPid, errors: resultB.errors });
  }

  return { valid: violations.length === 0, violations };
}

/* ── Takas onaylandığında atamaları değiştir ── */
async function executeSwap(request) {
  const {
    fromPersonId, fromName,
    swapWithPersonId,
    swapSectionId, swapMyDate, swapMyShiftId,
    swapTargetDate, swapTargetShiftId,
  } = request;

  if (!fromPersonId || !swapWithPersonId || !swapMyDate || !swapTargetDate) return false;
  // Self-swap: kişi kendisiyle takas yapamaz
  if (String(fromPersonId) === String(swapWithPersonId)) return false;

  function ym(dateStr) {
    const m = String(dateStr).slice(0, 10).match(/^(\d{4})-(\d{2})/);
    return m ? { year: Number(m[1]), month: Number(m[2]) } : null;
  }

  const myYm = ym(swapMyDate);
  const tYm  = ym(swapTargetDate);
  if (!myYm || !tYm) return false;

  const sectionId = String(swapSectionId || '');
  const fromPid   = String(fromPersonId);
  const toPid     = String(swapWithPersonId);
  const myShift   = String(swapMyShiftId || '').toUpperCase();
  const tShift    = String(swapTargetShiftId || '').toUpperCase();
  const myDate    = String(swapMyDate).slice(0, 10);
  const tDate     = String(swapTargetDate).slice(0, 10);

  const [fromPerson, toPerson] = await Promise.all([
    Person.findById(fromPersonId).lean(),
    Person.findById(swapWithPersonId).lean(),
  ]);

  // Personel adları çözümleniyor. Boş ad DB'ye yazılmasın; bu noktada fırlatılan
  // hata, aşağıdaki tüm try/catch bloklarının dışında olduğu için admin onay
  // akışındaki catch'e (→ 500 + durum geri alma) doğrudan ulaşır.
  const resolvedFromName = (fromPerson?.name || '').trim() || (typeof fromName === 'string' ? fromName.trim() : '');
  const resolvedToName   = (toPerson?.name || '').trim();
  if (!resolvedFromName) {
    throw new Error(`Takas başlatıcısının adı bulunamadı (personId: ${fromPid}). Personel kaydı eksik veya silinmiş.`);
  }
  if (!resolvedToName) {
    throw new Error(`Takas yapılacak kişinin adı bulunamadı (personId: ${toPid}). Personel kaydı eksik veya silinmiş.`);
  }

  const isSameDoc = myYm.year === tYm.year && myYm.month === tYm.month;

  const findAndSwap = async (doc, findDate, findPid, findShift, newPid, newName, findNameFallback = '') => {
    const assignments = Array.isArray(doc?.data?.assignments) ? [...doc.data.assignments] : [];
    let idx = assignments.findIndex((a) => {
      const aDate  = String(a?.date || a?.day || '').slice(0, 10);
      const aPid   = String(a?.personId || '').trim();
      const aShift = String(a?.shiftId || a?.shiftCode || '').trim().toUpperCase();
      return aDate === findDate && aPid === findPid && aShift === findShift;
    });
    // isim tabanlı fallback (personId boş olabilir)
    if (idx === -1 && findNameFallback) {
      const canon = swapCanonName(findNameFallback);
      idx = assignments.findIndex((a) => {
        const aDate  = String(a?.date || a?.day || '').slice(0, 10);
        const aName  = swapCanonName(String(a?.personName || a?.name || ''));
        const aShift = String(a?.shiftId || a?.shiftCode || '').trim().toUpperCase();
        return aDate === findDate && aName === canon && aShift === findShift;
      });
    }
    if (idx === -1) return { doc, found: false, assignments };

    // Boş ad DB'ye yazılmasın — bu noktaya ulaşıldıysa yukarıdaki guard'ı geçmiş
    // olmalı; ama savunma amacıyla ikinci kez kontrol ediliyor.
    const safeNewName = String(newName || '').trim();
    if (!safeNewName) {
      throw new Error(`Takas sırasında yeni kişi adı boş — ${findDate} / ${findShift} ataması iptal edildi.`);
    }

    const oldName = String(assignments[idx].personName || '').trim();
    const rowId   = String(assignments[idx].rowId || assignments[idx].shiftId || findShift).trim();
    const day     = Number(String(findDate).slice(8, 10));

    assignments[idx] = { ...assignments[idx], personId: newPid, personName: safeNewName, source: 'swap', overrideReason: 'takas' };

    // namedAssignments güncelle (DutyRowsEditor bu formatı okur)
    if (oldName && rowId && day) {
      const canonOld = swapCanonName(oldName);
      for (const namedRoot of [doc.data?.roster?.namedAssignments, doc.data?.namedAssignments]) {
        if (!namedRoot || typeof namedRoot !== 'object') continue;
        const daySlot = namedRoot[day];
        if (!daySlot || typeof daySlot !== 'object') continue;
        // rowId eşleşmesi — hem direkt hem büyük/küçük harf toleranslı
        const matchKey = Object.keys(daySlot).find(
          (k) => k === rowId || k.toUpperCase() === rowId.toUpperCase()
        );
        if (!matchKey) continue;
        const names = Array.isArray(daySlot[matchKey]) ? [...daySlot[matchKey]] : [];
        const ni = names.findIndex((n) => swapCanonName(n) === canonOld);
        if (ni !== -1) names[ni] = newName;
        daySlot[matchKey] = names;
      }
    }

    return { doc, found: true, assignments };
  };

  if (isSameDoc) {
    const doc = await MonthlySchedule.findOne({ sectionId, year: myYm.year, month: myYm.month });
    if (!doc) return false;

    const r1 = await findAndSwap(doc, myDate, fromPid, myShift, toPid, resolvedToName, resolvedFromName);
    if (!r1.found) return false;
    doc.data = { ...doc.data, assignments: r1.assignments };

    const r2 = await findAndSwap(doc, tDate, toPid, tShift, fromPid, resolvedFromName, resolvedToName);
    if (!r2.found) return false;
    doc.data = { ...doc.data, assignments: r2.assignments };
    doc.markModified('data');
    await doc.save();
    try {
      await replaceAssignmentsForSchedule({
        scope: {
          sectionId: String(doc.sectionId || sectionId || '').trim(),
          serviceId: doc.serviceId != null ? String(doc.serviceId).trim() : '',
          role: doc.role != null ? String(doc.role).trim() : '',
          year: myYm.year,
          month: myYm.month,
          sourceScheduleId: doc._id,
        },
        payload: doc.data || {},
        createdBy: doc.createdBy || null,
        updatedBy: null,
      });
    } catch (syncErr) {
      console.error('[assignmentSync][swap-same-doc] ERR:', syncErr?.message || syncErr);
    }
  } else {
    // İki farklı ay dokümanı — okuma + yazma transaction içinde; write conflict'e karşı güvenli
    let session;
    let syncFromDoc, syncToDoc;
    try {
      session = await mongoose.startSession();
      await session.withTransaction(async () => {
        const [fromDoc, toDoc] = await Promise.all([
          MonthlySchedule.findOne({ sectionId, year: myYm.year, month: myYm.month }).session(session),
          MonthlySchedule.findOne({ sectionId, year: tYm.year,  month: tYm.month  }).session(session),
        ]);
        if (!fromDoc || !toDoc) throw new Error('Çizelge bulunamadı');

        const r1 = await findAndSwap(fromDoc, myDate, fromPid, myShift, toPid, resolvedToName, resolvedFromName);
        if (!r1.found) throw new Error('Vardiya bulunamadı (from)');
        fromDoc.data = { ...fromDoc.data, assignments: r1.assignments };
        fromDoc.markModified('data');

        const r2 = await findAndSwap(toDoc, tDate, toPid, tShift, fromPid, resolvedFromName, resolvedToName);
        if (!r2.found) throw new Error('Vardiya bulunamadı (to)');
        toDoc.data = { ...toDoc.data, assignments: r2.assignments };
        toDoc.markModified('data');

        await fromDoc.save({ session });
        await toDoc.save({ session });
        syncFromDoc = fromDoc;
        syncToDoc = toDoc;
      });
    } catch (txErr) {
      const isNoReplicaSet = txErr?.codeName === 'IllegalOperation'
        || txErr?.message?.includes('Transaction')
        || txErr?.message?.includes('replica');

      if (isNoReplicaSet) {
        // Standalone MongoDB: transaction desteklemiyor — sıralı kayıt ile devam
        console.warn('[swap][cross-doc] Transaction desteği yok, standalone fallback kullanılıyor');
        try {
          const [fbFromDoc, fbToDoc] = await Promise.all([
            MonthlySchedule.findOne({ sectionId, year: myYm.year, month: myYm.month }),
            MonthlySchedule.findOne({ sectionId, year: tYm.year, month: tYm.month }),
          ]);
          if (!fbFromDoc || !fbToDoc) { if (session) await session.endSession().catch(() => {}); return false; }

          const fr1 = await findAndSwap(fbFromDoc, myDate, fromPid, myShift, toPid, resolvedToName, resolvedFromName);
          if (!fr1.found) { if (session) await session.endSession().catch(() => {}); return false; }
          fbFromDoc.data = { ...fbFromDoc.data, assignments: fr1.assignments };
          fbFromDoc.markModified('data');

          const fr2 = await findAndSwap(fbToDoc, tDate, toPid, tShift, fromPid, resolvedFromName, resolvedToName);
          if (!fr2.found) { if (session) await session.endSession().catch(() => {}); return false; }
          fbToDoc.data = { ...fbToDoc.data, assignments: fr2.assignments };
          fbToDoc.markModified('data');

          await fbFromDoc.save();
          await fbToDoc.save();
          syncFromDoc = fbFromDoc;
          syncToDoc = fbToDoc;
        } catch (fbErr) {
          console.error('[swap][cross-doc][fallback] ERR:', fbErr?.message || fbErr);
          if (session) await session.endSession().catch(() => {});
          return false;
        }
      } else {
        console.error('[swap] Transaction başarısız, rollback yapıldı:', txErr?.message);
        if (session) await session.endSession().catch(() => {});
        return false;
      }
    }
    if (session) await session.endSession().catch(() => {});

    if (!syncFromDoc || !syncToDoc) return false;

    try {
      await Promise.all([
        replaceAssignmentsForSchedule({
          scope: {
            sectionId: String(syncFromDoc.sectionId || sectionId || '').trim(),
            serviceId: syncFromDoc.serviceId != null ? String(syncFromDoc.serviceId).trim() : '',
            role: syncFromDoc.role != null ? String(syncFromDoc.role).trim() : '',
            year: myYm.year,
            month: myYm.month,
            sourceScheduleId: syncFromDoc._id,
          },
          payload: syncFromDoc.data || {},
          createdBy: syncFromDoc.createdBy || null,
          updatedBy: null,
        }),
        replaceAssignmentsForSchedule({
          scope: {
            sectionId: String(syncToDoc.sectionId || sectionId || '').trim(),
            serviceId: syncToDoc.serviceId != null ? String(syncToDoc.serviceId).trim() : '',
            role: syncToDoc.role != null ? String(syncToDoc.role).trim() : '',
            year: tYm.year,
            month: tYm.month,
            sourceScheduleId: syncToDoc._id,
          },
          payload: syncToDoc.data || {},
          createdBy: syncToDoc.createdBy || null,
          updatedBy: null,
        }),
      ]);
    } catch (syncErr) {
      console.error('[assignmentSync][swap-cross-doc] ERR:', syncErr?.message || syncErr);
    }
  }
  return true;
}

// Auth middleware
// Not: Bu router, index.js içinde zaten `secureTenant` (auth + extractHospital) ile mount edilir.
// Burada sadece guard yapıyoruz; tenant/hospital çözümlemesi dış middleware'den gelir.
function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ message: 'Yetkisiz' });
  if (!req.hospitalId && !isSuperAdminRole(req.user?.role)) {
    return res.status(403).json({ message: 'hospitalId gerekli' });
  }
  return next();
}

function isAdminOrStaff(user) {
  const role = String(user?.role || '').toLowerCase();
  return role === 'admin' || role === 'staff';
}

function parseStatusFilter(status) {
  const value = String(status || '').trim().toLowerCase();
  if (!value || value === 'all') return null;
  return REQUEST_STATUS.has(value) ? value : null;
}

// POST /api/requests — kullanıcı talep gönderir
router.post('/', requireAuth, async (req, res) => {
  try {
    const {
      type, targetDate, targetDateEnd, message, swapWithPersonId,
      leaveTypeCode,
      swapSectionId, swapMyDate, swapMyShiftId, swapMyShiftLabel,
      swapTargetDate, swapTargetShiftId, swapTargetShiftLabel,
      swapWithPersonName,
    } = req.body;

    if (!type || !message) {
      return res.status(400).json({ message: 'Tür ve mesaj zorunlu' });
    }
    if (type === 'takas' && (!swapWithPersonId || !swapMyDate || !swapMyShiftId || !swapTargetDate || !swapTargetShiftId)) {
      return res.status(400).json({ message: 'Takas için swapWithPersonId, swapMyDate, swapMyShiftId, swapTargetDate, swapTargetShiftId zorunlu' });
    }

    const person = await Person.findOne(withHospitalFilter(req, { userId: req.user._id })).lean();

    const request = await Request.create(withHospitalFilter(req, {
      type,
      fromUserId:   req.user._id,
      fromPersonId: person?._id || null,
      fromName:     req.user.name || '',
      serviceId:    person?.serviceId || '',
      targetDate:   targetDate || '',
      targetDateEnd: targetDateEnd || '',
      swapWithPersonId:   swapWithPersonId || null,
      swapWithPersonName: String(swapWithPersonName || '').trim(),
      leaveTypeCode:      String(leaveTypeCode || '').trim().toUpperCase(),
      swapSectionId:    String(swapSectionId || '').trim(),
      swapMyDate:       String(swapMyDate || '').slice(0, 10),
      swapMyShiftId:    String(swapMyShiftId || '').trim(),
      swapMyShiftLabel: String(swapMyShiftLabel || '').trim(),
      swapTargetDate:   String(swapTargetDate || '').slice(0, 10),
      swapTargetShiftId: String(swapTargetShiftId || '').trim(),
      swapTargetShiftLabel: String(swapTargetShiftLabel || '').trim(),
      message,
      status: 'pending',
    }));

    void sendNewRequestNotification({ request, senderName: req.user?.name || '' }).catch(() => {});
    res.json({ ok: true, request });
  } catch (err) {
    res.status(500).json({ message: safeMessage(err) });
  }
});

// GET /api/requests/swap-shifts — bir kişinin belirli tarihteki vardiyalarını döndürür
// ?personId=...  (belirtilmezse kendi vardiyaları)  &date=YYYY-MM-DD
router.get('/swap-shifts', requireAuth, async (req, res) => {
  try {
    const { personId, date } = req.query;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
      return res.status(400).json({ message: 'Geçerli tarih (YYYY-MM-DD) zorunlu' });
    }
    let queryPid = personId ? String(personId).trim() : null;
    if (!queryPid) {
      const myPerson = await Person.findOne(withHospitalFilter(req, { userId: req.user._id })).lean();
      queryPid = myPerson ? String(myPerson._id) : null;
    }
    if (!queryPid) return res.json({ items: [] });

    const items = await Assignment.find(
      withHospitalFilter(req, { date: String(date), personId: queryPid })
    ).select('date shiftId shiftCode roleLabel rowId personName personId sectionId serviceId').limit(20).lean();

    res.json({ items });
  } catch (err) {
    res.status(500).json({ message: safeMessage(err) });
  }
});

// GET /api/requests — kullanıcı kendi taleplerini, yetkili/admin tümünü görür
router.get('/', requireAuth, async (req, res) => {
  try {
    const statusFilter = parseStatusFilter(req.query?.status);
    let filter = {};

    if (isAdminOrStaff(req.user)) {
      const role = String(req.user.role || '').toLowerCase();
      if (role === 'staff') {
        // Yetkili sadece kendi serviceId'lerini görür
        const serviceIds = Array.isArray(req.user.serviceIds)
          ? req.user.serviceIds.filter(Boolean)
          : [];
        if (serviceIds.length) {
          filter.serviceId = { $in: serviceIds };
        }
      }
      // Admin hiçbir filtre olmadan tümünü görür
    } else {
      // Normal kullanıcı kendi talepleri + gelen takas taleplerini görür
      const myPerson = await Person.findOne(withHospitalFilter(req, { userId: req.user._id })).lean();
      if (myPerson?._id) {
        filter = { $or: [{ fromUserId: req.user._id }, { swapWithPersonId: myPerson._id }] };
      } else {
        filter.fromUserId = req.user._id;
      }
    }
    if (statusFilter) filter.status = statusFilter;

    const requests = await Request.find(withHospitalFilter(req, filter))
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    res.json({ items: requests });
  } catch (err) {
    res.status(500).json({ message: safeMessage(err) });
  }
});

// PUT /api/requests/:id — yetkili/admin onayla veya reddet
router.put('/:id', requireAuth, async (req, res) => {
  try {
    if (!isAdminOrStaff(req.user)) {
      return res.status(403).json({ message: 'Yetkiniz yok' });
    }

    const { status, adminNote, forceSwap = false } = req.body;
    if (!['approved', 'rejected', 'pending'].includes(status)) {
      return res.status(400).json({ message: 'Geçersiz durum' });
    }

    let request = await Request.findOne(withHospitalFilter(req, { _id: req.params.id }));
    if (!request) return res.status(404).json({ message: 'Talep bulunamadı' });
    if (String(request.status || '') === 'deleted') {
      return res.status(409).json({ message: 'Silinmiş talep güncellenemez' });
    }

    // Yetkili sadece kendi servisindeki talebi işleyebilir
    const role = String(req.user.role || '').toLowerCase();
    if (role === 'staff') {
      const serviceIds = Array.isArray(req.user.serviceIds)
        ? req.user.serviceIds.filter(Boolean).map(String)
        : [];
      if (serviceIds.length && !serviceIds.includes(String(request.serviceId))) {
        return res.status(403).json({ message: 'Bu talep sizin servisinize ait değil' });
      }
    }

    const previousStatus = String(request.status || 'pending');
    const requestType = String(request.type || '').toLowerCase();
    const isSwapRequest = requestType === 'takas';

    // Takas onay ÖNCE kural kontrolü — status henüz değişmeden
    if (status === 'approved' && previousStatus !== 'approved' && isSwapRequest && !request.swapExecuted) {
      // 1. ScheduleRules simülasyonu (maxShifts, minRest, maxConsecutive, restrictedDays)
      try {
        const swapVal = await validateSwap(request);
        if (!swapVal.valid && !forceSwap) {
          return res.status(400).json({
            message: 'Takas kural ihlali içeriyor. Devam etmek için forceSwap: true gönderin.',
            violations: swapVal.violations,
            canForce: true,
          });
        }
        if (!swapVal.valid && forceSwap) {
          console.warn('[swap-validate] Kural ihlali forceSwap ile geçildi:', JSON.stringify(swapVal.violations));
        }
      } catch (valErr) {
        console.error('[swap-validate] ERR:', valErr?.message || valErr);
        // Kural kontrolü başarısız olsa bile takasın bloklanması istenmez; devam et
      }

      // 2. Aynı gün / gece ardışık çakışma kontrolü
      try {
        const conflict = await checkSwapConflicts(request);
        if (conflict) return res.status(422).json({ message: conflict });
      } catch (checkErr) {
        console.error('[swap-conflict-check] ERR:', checkErr?.message || checkErr);
      }
    }

    const isLeaveRequest = requestType === 'izin';
    const hasStatusChange = previousStatus !== String(status);
    const actorName = req.user?.name || req.user?.email || 'Yetkili';

    // İzin onayı → transaction içinde atomic: CAS + Setting yazma + LeaveBalance güncelleme
    if (isLeaveRequest && hasStatusChange && status === 'approved') {
      const { updated, error } = await approveLeaveWithTransaction(
        req, request, previousStatus, adminNote, req.user._id
      );
      if (error === 'CONFLICT') {
        return res.status(409).json({ message: 'Talep durumu değişti, lütfen sayfayı yenileyin' });
      }
      if (error) {
        return res.status(500).json({ message: error });
      }
      request = updated;
      void sendLeaveApproved({ request, actorName }).catch((e) => {
        console.error('[notify][leave-approved] ERR:', e?.message || e);
      });
      return res.json({ ok: true, request });
    }

    // Diğer durum değişiklikleri için standart atomic CAS
    const updatedRequest = await Request.findOneAndUpdate(
      withHospitalFilter(req, { _id: req.params.id, status: previousStatus }),
      { $set: { status, adminNote: adminNote || '', resolvedBy: req.user._id, resolvedAt: new Date() } },
      { new: true }
    );
    if (!updatedRequest) {
      return res.status(409).json({ message: 'Talep durumu değişti, lütfen sayfayı yenileyin' });
    }
    request = updatedRequest;

    if (hasStatusChange && status === 'approved') {
      if (isSwapRequest && !request.swapExecuted) {
        try {
          const executed = await executeSwap(request);
          if (executed) {
            // Swap başarılı → swapExecuted atomik olarak işaretle
            await Request.updateOne(
              withHospitalFilter(req, { _id: request._id }),
              { $set: { swapExecuted: true } }
            );
            request.swapExecuted = true;
          } else {
            // Swap başarısız — durumu geri al, yöneticiye hata döndür
            console.warn('[swap-execute] Takas gerçekleştirilemedi, durum geri alınıyor:', request._id);
            await Request.updateOne(
              withHospitalFilter(req, { _id: request._id }),
              { $set: { status: previousStatus, adminNote: 'Takas çizelgede gerçekleştirilemedi — vardiya bulunamadı veya çizelge kaydedilmemiş. Durum geri alındı.' } }
            );
            return res.status(422).json({ message: 'Takas onaylandı ancak çizelgede ilgili vardiya bulunamadı. Durum "Beklemede" ye geri alındı — çizelgeyi kaydedin ve tekrar deneyin.' });
          }
        } catch (e) {
          console.error('[swap-execute] ERR:', e?.message || e);
          await Request.updateOne(
            withHospitalFilter(req, { _id: request._id }),
            { $set: { status: previousStatus, adminNote: `Takas sırasında hata: ${e?.message || 'bilinmeyen hata'}` } }
          ).catch(() => {});
          return res.status(500).json({ message: safeMessage(e, 'Takas sırasında sunucu hatası, durum geri alındı.') });
        }
        // Takas onay bildirimi — her iki tarafa
        void sendShiftChanged({
          personId: request.fromPersonId,
          userId:   request.fromUserId,
          personName: request.fromName,
          date:       request.swapMyDate,
          previousShift: request.swapMyShiftLabel || request.swapMyShiftId,
          newShift:      request.swapTargetShiftLabel || request.swapTargetShiftId,
          changedByName: actorName,
          action: 'updated',
        }).catch((e) => console.error('[notify][swap-from] ERR:', e?.message || e));
        void sendShiftChanged({
          personId: request.swapWithPersonId,
          date:     request.swapTargetDate,
          previousShift: request.swapTargetShiftLabel || request.swapTargetShiftId,
          newShift:      request.swapMyShiftLabel || request.swapMyShiftId,
          changedByName: actorName,
          action: 'updated',
        }).catch((e) => console.error('[notify][swap-to] ERR:', e?.message || e));
      }
    } else if (isLeaveRequest && hasStatusChange && status === 'rejected') {
      void sendLeaveRejected({ request, actorName }).catch((e) => {
        console.error('[notify][leave-rejected] ERR:', e?.message || e);
      });
      // Daha önce onaylanmış bir izin reddediliyorsa bakiyeyi geri al
      if (previousStatus === 'approved') {
        void revertLeaveBalance(request).catch((e) => {
          console.error('[leave-balance-revert] ERR:', e?.message || e);
        });
      }
    } else if (isLeaveRequest && hasStatusChange && status === 'pending' && previousStatus === 'approved') {
      // Onay geri alındı (approved → pending)
      void revertLeaveBalance(request).catch((e) => {
        console.error('[leave-balance-revert] ERR:', e?.message || e);
      });
    }

    res.json({ ok: true, request });
  } catch (err) {
    res.status(500).json({ message: safeMessage(err) });
  }
});

// DELETE /api/requests/:id — soft delete (180 gün sonra otomatik temizlenir)
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const request = await Request.findOne(withHospitalFilter(req, { _id: req.params.id }));
    if (!request) return res.status(404).json({ message: 'Talep bulunamadı' });

    const userIsManager = isAdminOrStaff(req.user);
    const isOwner = String(request.fromUserId || '') === String(req.user?._id || '');

    if (!userIsManager && !isOwner) {
      return res.status(403).json({ message: 'Bu talebi silme yetkiniz yok' });
    }

    const role = String(req.user.role || '').toLowerCase();
    if (userIsManager && role === 'staff') {
      const serviceIds = Array.isArray(req.user.serviceIds)
        ? req.user.serviceIds.filter(Boolean).map(String)
        : [];
      if (serviceIds.length && !serviceIds.includes(String(request.serviceId))) {
        return res.status(403).json({ message: 'Bu talep sizin servisinize ait değil' });
      }
    }

    if (String(request.status || '') === 'deleted') {
      return res.json({ ok: true, request });
    }

    const now = new Date();
    const keepMs = SOFT_DELETE_KEEP_DAYS * 24 * 60 * 60 * 1000;
    const reason = String(req.body?.reason || '').trim().slice(0, 500);

    request.status = 'deleted';
    request.deletedAt = now;
    request.deletedBy = req.user._id;
    request.deletedReason = reason;
    request.purgeAt = new Date(now.getTime() + keepMs);
    request.resolvedBy = req.user._id;
    request.resolvedAt = now;
    await request.save();

    res.json({ ok: true, request });
  } catch (err) {
    res.status(500).json({ message: safeMessage(err) });
  }
});

// GET /api/requests/swap-suggestions — takas için uygun kişi önerileri
router.get('/swap-suggestions', requireAuth, async (req, res) => {
  try {
    const { personId, currentPersonName, date, shiftId, sectionId, serviceId, role, roleLabel, limit } = req.query;
    if (!date || !shiftId) {
      return res.status(400).json({ message: 'date ve shiftId zorunlu' });
    }
    const result = await suggestSwaps({
      personId:          personId || null,
      currentPersonName: String(currentPersonName || ''),
      date:              String(date).slice(0, 10),
      shiftId:           String(shiftId),
      roleLabel:         String(roleLabel || ''),
      serviceId:         String(serviceId || ''),
      role:              String(role || ''),
      sectionId:         String(sectionId || ''),
      hospitalId:        req.hospitalId,
      limit:             Math.min(50, Number(limit) || 10),
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: safeMessage(err) });
  }
});

// POST /api/requests/:id/peer-response — hedef kişi takas talebini kabul/reddeder
router.post('/:id/peer-response', requireAuth, async (req, res) => {
  try {
    const { accepted, note } = req.body;
    if (typeof accepted !== 'boolean' && accepted !== 'true' && accepted !== 'false') {
      return res.status(400).json({ message: 'accepted alanı zorunlu (boolean)' });
    }
    const isAccepted = accepted === true || accepted === 'true';

    const myPerson = await Person.findOne(withHospitalFilter(req, { userId: req.user._id })).lean();
    if (!myPerson) return res.status(403).json({ message: 'Personel kaydınız bulunamadı' });

    const request = await Request.findOne(
      withHospitalFilter(req, { _id: req.params.id, type: 'takas', swapWithPersonId: myPerson._id })
    );
    if (!request) return res.status(404).json({ message: 'Talep bulunamadı' });
    if (request.status !== 'pending') {
      return res.status(409).json({ message: 'Talep artık beklemede değil' });
    }
    if (request.peerStatus !== 'pending') {
      return res.status(409).json({ message: 'Bu talebi zaten yanıtladınız' });
    }

    const peerStatus = isAccepted ? 'accepted' : 'rejected';
    const peerNote = String(note || '').trim().slice(0, 500);

    // Atomik CAS: iki eşzamanlı yanıt gelirse ikincisi 409 alır
    const updated = await Request.findOneAndUpdate(
      withHospitalFilter(req, { _id: req.params.id, peerStatus: 'pending' }),
      { $set: { peerStatus, peerRespondedAt: new Date(), peerNote } },
      { new: true }
    );
    if (!updated) return res.status(409).json({ message: 'Durum değişti, sayfayı yenileyin' });

    if (!isAccepted) {
      // Karşı taraf reddetti → talebi otomatik olarak reddet
      await Request.updateOne(
        withHospitalFilter(req, { _id: req.params.id }),
        {
          $set: {
            status: 'rejected',
            adminNote: peerNote ? `Karşı taraf reddetti: ${peerNote}` : 'Karşı taraf reddetti',
            resolvedAt: new Date(),
          },
        }
      );
      updated.status = 'rejected';
    } else {
      // Kabul edildi → yöneticilere bildir (nihai onay bekleniyor)
      void sendNewRequestNotification({ request: updated, senderName: req.user?.name || '' }).catch(() => {});
    }

    res.json({ ok: true, request: updated });
  } catch (err) {
    res.status(500).json({ message: safeMessage(err) });
  }
});

// GET /api/requests/unread-count — header'daki zil için
router.get('/unread-count', requireAuth, async (req, res) => {
  try {
    if (!isAdminOrStaff(req.user)) return res.json({ count: 0 });

    const role = String(req.user.role || '').toLowerCase();
    const filter = { status: 'pending' };

    if (role === 'staff') {
      const serviceIds = Array.isArray(req.user.serviceIds)
        ? req.user.serviceIds.filter(Boolean)
        : [];
      if (serviceIds.length) filter.serviceId = { $in: serviceIds };
    }

    const count = await Request.countDocuments(withHospitalFilter(req, filter));
    res.json({ count });
  } catch {
    res.json({ count: 0 });
  }
});

module.exports = router;
