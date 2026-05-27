'use strict';
// services/requestService.js — İstek Yönetimi İş Mantığı Katmanı

const mongoose       = require('mongoose');
const Request        = require('../models/Request');
const Person         = require('../models/Person');
const MonthlySchedule = require('../models/MonthlySchedule');
const Setting        = require('../models/Setting');
const LeaveBalance   = require('../models/LeaveBalance');
const LeaveType      = require('../models/LeaveType');
const ScheduleRules  = require('../models/ScheduleRules');
const { broadcastAll }                 = require('./sseService');
const { computeMonthlyFairnessScores } = require('./fairnessEngine');
const { withHospitalFilter }           = require('../middleware/hospital');
const { validateAssignment }           = require('../utils/rulesValidator');
const { replaceAssignmentsForSchedule } = require('./assignmentSyncService');
const {
  sendLeaveApproved,
  sendLeaveRejected,
  sendShiftChanged,
  saveAndBroadcast,
} = require('./notificationService');

const TR_MONTHS = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];

function normalizeLeaveTypeCode(raw) {
  const value = String(raw || '').trim().toUpperCase();
  if (!value) return 'Y';
  if (['YILLIK', 'YILLIK IZIN', 'YILLIK İZİN', 'ANNUAL'].includes(value)) return 'Y';
  return value;
}

function getDefaultAllocatedDays(leaveType) {
  const value = Number(leaveType?.maxDaysPerYear);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/* ─── Takas yardımcıları ─── */

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
  return sh >= 22 || eh < sh;
}

/* ─── Takas çakışma kontrolü ─── */
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

  const docs = await Promise.all([
    MonthlySchedule.findOne({ sectionId, year: myYm.year, month: myYm.month }).lean(),
    myYm.year !== tYm.year || myYm.month !== tYm.month
      ? MonthlySchedule.findOne({ sectionId, year: tYm.year, month: tYm.month }).lean()
      : null,
  ]);
  const myDoc = docs[0];
  const tDoc  = docs[1] || myDoc;

  function getDefs(doc) { return Array.isArray(doc?.data?.defs) ? doc.data.defs : []; }

  function getAllAssignmentEntries(doc) {
    const fromArr = Array.isArray(doc?.data?.assignments) ? doc.data.assignments : [];
    if (fromArr.length > 0) return fromArr;
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

  if (personHasShiftOnDate(tEntries, fromPid, fromDisplayName, tDate, tShift)) {
    return `${fromDisplayName} zaten ${tDate} tarihinde başka bir nöbeti var — aynı güne iki nöbet yazılamaz.`;
  }
  if (personHasShiftOnDate(myEntries, toPid, toDisplayName, myDate, myShift)) {
    return `${toDisplayName} zaten ${myDate} tarihinde başka bir nöbeti var — aynı güne iki nöbet yazılamaz.`;
  }
  const prevTDate = swapAddDays(tDate, -1);
  if (hadNightShiftOnDate(tEntries, getDefs(tDoc), fromPid, fromDisplayName, prevTDate)) {
    return `${fromDisplayName} ${prevTDate} tarihinde gece nöbeti çalışıyor — ardarda nöbet yazılamaz.`;
  }
  const prevMyDate = swapAddDays(myDate, -1);
  if (hadNightShiftOnDate(myEntries, getDefs(myDoc), toPid, toDisplayName, prevMyDate)) {
    return `${toDisplayName} ${prevMyDate} tarihinde gece nöbeti çalışıyor — ardarda nöbet yazılamaz.`;
  }
  return null;
}

/* ─── Takas kural simülasyonu ─── */
async function validateSwap(request) {
  const {
    fromPersonId, fromName,
    swapWithPersonId,
    swapSectionId, swapMyDate, swapMyShiftId,
    swapTargetDate, swapTargetShiftId,
    serviceId,
  } = request;
  if (!fromPersonId || !swapWithPersonId || !swapMyDate || !swapTargetDate) return { valid: true, violations: [] };

  const sectionId = String(swapSectionId || '');
  const rulesFilter = { sectionId };
  if (serviceId) rulesFilter.serviceId = String(serviceId);
  const rulesDoc = await ScheduleRules.findOne(rulesFilter).lean();
  if (!rulesDoc?.enabled) return { valid: true, violations: [] };

  function ym(d) { const m = String(d).slice(0, 10).match(/^(\d{4})-(\d{2})/); return m ? { year: Number(m[1]), month: Number(m[2]) } : null; }
  const myYm = ym(swapMyDate); const tYm = ym(swapTargetDate);
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

  const isSameDoc = myYm.year === tYm.year && myYm.month === tYm.month;
  const [myDoc, tDoc] = await Promise.all([
    MonthlySchedule.findOne({ sectionId, year: myYm.year, month: myYm.month }).select({ 'data.assignments': 1 }).lean(),
    isSameDoc
      ? Promise.resolve(null)
      : MonthlySchedule.findOne({ sectionId, year: tYm.year, month: tYm.month }).select({ 'data.assignments': 1 }).lean(),
  ]);

  const myAssignments = Array.isArray(myDoc?.data?.assignments) ? myDoc.data.assignments.slice() : [];
  const tAssignments  = isSameDoc ? myAssignments : (Array.isArray(tDoc?.data?.assignments) ? tDoc.data.assignments.slice() : []);

  function forPerson(list, pid, name) {
    const canonName = swapCanonName(name);
    return list.filter((a) => {
      const apid = String(a?.personId || '').trim();
      if (pid && apid) return apid === pid;
      if (name) return swapCanonName(String(a?.personName || '')) === canonName;
      return false;
    });
  }

  const fromCurrentList = forPerson(myAssignments, fromPid, fromDisplayName);
  const toCurrentList   = forPerson(tAssignments, toPid, toDisplayName);

  const simFromList = fromCurrentList
    .filter((a) => {
      const aDate  = String(a?.date || a?.day || '').slice(0, 10);
      const aShift = String(a?.shiftId || a?.shiftCode || '').trim().toUpperCase();
      return !(aDate === myDate && aShift === myShift);
    })
    .concat([{ personId: fromPid, personName: fromDisplayName, date: tDate }]);

  const simToList = toCurrentList
    .filter((a) => {
      const aDate  = String(a?.date || a?.day || '').slice(0, 10);
      const aShift = String(a?.shiftId || a?.shiftCode || '').trim().toUpperCase();
      return !(aDate === tDate && aShift === tShift);
    })
    .concat([{ personId: toPid, personName: toDisplayName, date: myDate }]);

  const resultA = validateAssignment(rulesDoc, { personId: fromPid, personName: fromDisplayName, date: tDate }, simFromList);
  const resultB = validateAssignment(rulesDoc, { personId: toPid, personName: toDisplayName, date: myDate }, simToList);

  const violations = [];
  if (!resultA.valid) violations.push({ person: fromDisplayName, personId: fromPid, errors: resultA.errors });
  if (!resultB.valid) violations.push({ person: toDisplayName, personId: toPid, errors: resultB.errors });
  return { valid: violations.length === 0, violations };
}

/* ─── Takas gerçekleştirme ─── */
async function executeSwap(request) {
  const {
    fromPersonId, fromName,
    swapWithPersonId,
    swapSectionId, swapMyDate, swapMyShiftId,
    swapTargetDate, swapTargetShiftId,
  } = request;
  if (!fromPersonId || !swapWithPersonId || !swapMyDate || !swapTargetDate) return false;
  if (String(fromPersonId) === String(swapWithPersonId)) return false;

  function ym(dateStr) {
    const m = String(dateStr).slice(0, 10).match(/^(\d{4})-(\d{2})/);
    return m ? { year: Number(m[1]), month: Number(m[2]) } : null;
  }
  const myYm = ym(swapMyDate); const tYm = ym(swapTargetDate);
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
  const resolvedFromName = (fromPerson?.name || '').trim() || (typeof fromName === 'string' ? fromName.trim() : '');
  const resolvedToName   = (toPerson?.name || '').trim();
  if (!resolvedFromName) throw new Error(`Takas başlatıcısının adı bulunamadı (personId: ${fromPid}).`);
  if (!resolvedToName)   throw new Error(`Takas yapılacak kişinin adı bulunamadı (personId: ${toPid}).`);

  const isSameDoc = myYm.year === tYm.year && myYm.month === tYm.month;

  const findAndSwap = async (doc, findDate, findPid, findShift, newPid, newName, findNameFallback = '') => {
    const assignments = Array.isArray(doc?.data?.assignments) ? [...doc.data.assignments] : [];
    let idx = assignments.findIndex((a) => {
      const aDate  = String(a?.date || a?.day || '').slice(0, 10);
      const aPid   = String(a?.personId || '').trim();
      const aShift = String(a?.shiftId || a?.shiftCode || '').trim().toUpperCase();
      return aDate === findDate && aPid === findPid && aShift === findShift;
    });
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

    const safeNewName = String(newName || '').trim();
    if (!safeNewName) throw new Error(`Takas sırasında yeni kişi adı boş — ${findDate} / ${findShift} ataması iptal edildi.`);

    const oldName = String(assignments[idx].personName || '').trim();
    const rowId   = String(assignments[idx].rowId || assignments[idx].shiftId || findShift).trim();
    const day     = Number(String(findDate).slice(8, 10));
    assignments[idx] = { ...assignments[idx], personId: newPid, personName: safeNewName, source: 'swap', overrideReason: 'takas' };

    if (oldName && rowId && day) {
      const canonOld = swapCanonName(oldName);
      for (const namedRoot of [doc.data?.roster?.namedAssignments, doc.data?.namedAssignments]) {
        if (!namedRoot || typeof namedRoot !== 'object') continue;
        const daySlot = namedRoot[day];
        if (!daySlot || typeof daySlot !== 'object') continue;
        const matchKey = Object.keys(daySlot).find((k) => k === rowId || k.toUpperCase() === rowId.toUpperCase());
        if (!matchKey) continue;
        const names = Array.isArray(daySlot[matchKey]) ? [...daySlot[matchKey]] : [];
        const ni = names.findIndex((n) => swapCanonName(n) === canonOld);
        if (ni !== -1) names[ni] = newName;
        daySlot[matchKey] = names;
      }
    }
    return { doc, found: true, assignments };
  };

  const syncDoc = async (doc, year, month, sectionId) => {
    try {
      await replaceAssignmentsForSchedule({
        scope: {
          sectionId: String(doc.sectionId || sectionId || '').trim(),
          serviceId: doc.serviceId != null ? String(doc.serviceId).trim() : '',
          role:      doc.role != null ? String(doc.role).trim() : '',
          year, month,
          sourceScheduleId: doc._id,
        },
        payload:   doc.data || {},
        createdBy: doc.createdBy || null,
        updatedBy: null,
      });
    } catch (syncErr) {
      console.error('[assignmentSync][swap] ERR:', syncErr?.message || syncErr);
    }
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
    await syncDoc(doc, myYm.year, myYm.month, sectionId);
  } else {
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
        fromDoc.data = { ...fromDoc.data, assignments: r1.assignments }; fromDoc.markModified('data');
        const r2 = await findAndSwap(toDoc, tDate, toPid, tShift, fromPid, resolvedFromName, resolvedToName);
        if (!r2.found) throw new Error('Vardiya bulunamadı (to)');
        toDoc.data = { ...toDoc.data, assignments: r2.assignments }; toDoc.markModified('data');
        await fromDoc.save({ session }); await toDoc.save({ session });
        syncFromDoc = fromDoc; syncToDoc = toDoc;
      });
    } catch (txErr) {
      const isNoReplica = txErr?.codeName === 'IllegalOperation' || txErr?.message?.includes('Transaction') || txErr?.message?.includes('replica');
      if (isNoReplica) {
        console.warn('[swap][cross-doc] Standalone MongoDB fallback');
        try {
          const [fbFromDoc, fbToDoc] = await Promise.all([
            MonthlySchedule.findOne({ sectionId, year: myYm.year, month: myYm.month }),
            MonthlySchedule.findOne({ sectionId, year: tYm.year,  month: tYm.month  }),
          ]);
          if (!fbFromDoc || !fbToDoc) { if (session) await session.endSession().catch(() => {}); return false; }
          const fr1 = await findAndSwap(fbFromDoc, myDate, fromPid, myShift, toPid, resolvedToName, resolvedFromName);
          if (!fr1.found) { if (session) await session.endSession().catch(() => {}); return false; }
          fbFromDoc.data = { ...fbFromDoc.data, assignments: fr1.assignments }; fbFromDoc.markModified('data');
          const fr2 = await findAndSwap(fbToDoc, tDate, toPid, tShift, fromPid, resolvedFromName, resolvedToName);
          if (!fr2.found) { if (session) await session.endSession().catch(() => {}); return false; }
          fbToDoc.data = { ...fbToDoc.data, assignments: fr2.assignments }; fbToDoc.markModified('data');
          await fbFromDoc.save(); await fbToDoc.save();
          syncFromDoc = fbFromDoc; syncToDoc = fbToDoc;
        } catch (fbErr) {
          console.error('[swap][cross-doc][fallback] ERR:', fbErr?.message);
          if (session) await session.endSession().catch(() => {});
          return false;
        }
      } else {
        console.error('[swap] Transaction rollback:', txErr?.message);
        if (session) await session.endSession().catch(() => {}); return false;
      }
    }
    if (session) await session.endSession().catch(() => {});
    if (!syncFromDoc || !syncToDoc) return false;
    await Promise.all([
      syncDoc(syncFromDoc, myYm.year, myYm.month, sectionId),
      syncDoc(syncToDoc,   tYm.year,  tYm.month,  sectionId),
    ]);
  }
  return true;
}

/* ─── İzin onayı (transaction) ─── */
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

  const leaveCode = normalizeLeaveTypeCode(leaveTypeCode || message);
  const start = new Date(`${String(targetDate).slice(0, 10)}T00:00:00`);
  const end   = new Date(`${String(targetDateEnd || targetDate).slice(0, 10)}T00:00:00`);
  if (isNaN(start) || isNaN(end) || end < start) return { updated: null, error: 'Geçersiz tarih aralığı' };
  const dayDiff = Math.round((end - start) / 86_400_000);
  if (dayDiff >= 365) return { updated: null, error: 'İzin aralığı çok uzun (max 365 gün)' };

  const totalDays = dayDiff + 1;
  const year = start.getFullYear();
  const pid  = String(fromPersonId);
  const sid  = '';

  const byMonth = {};
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const y = d.getFullYear(); const m = d.getMonth() + 1;
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
      let doc = sess ? await Setting.findOne(docFilter).session(sess) : await Setting.findOne(docFilter);
      if (!doc) doc = new Setting({ hospitalId: hid, key: 'leavesV2', serviceId: sid, value: {} });
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
    if (leaveType && leaveType.isDeductible === false) return;

    const updateOptions = { upsert: true, new: true, setDefaultsOnInsert: true };
    if (sess) updateOptions.session = sess;
    const balance = await LeaveBalance.findOneAndUpdate(
      { hospitalId: hid, personId: pid, leaveTypeId, year },
      {
        $setOnInsert: {
          hospitalId: hid,
          personId: pid,
          leaveTypeId,
          year,
          allocated: getDefaultAllocatedDays(leaveType),
          used: 0,
          remaining: getDefaultAllocatedDays(leaveType),
        },
        $inc: { used: totalDays },
      },
      updateOptions
    );

    if (!balance) return;
    const used = Number(balance.used || 0);
    const allocated = Number(balance.allocated || 0);
    await LeaveBalance.updateOne(
      { _id: balance._id },
      {
        $set: {
          personName: request.fromName || '',
          leaveTypeName,
          remaining: Math.max(0, allocated - used),
        },
      },
      sess ? { session: sess } : undefined
    );
  }

  async function casRequest(sess) {
    const upd = await Request.findOneAndUpdate(
      withHospitalFilter(req, { _id: request._id, status: previousStatus }),
      { $set: { status: 'approved', adminNote: adminNote || '', resolvedBy: actorUserId, resolvedAt: new Date(), leaveRecordId: settingDocId || null } },
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
    if (txErr?.code === 'CONFLICT') { if (session) await session.endSession().catch(() => {}); return { updated: null, error: 'CONFLICT' }; }
    const isNoReplica = txErr?.codeName === 'IllegalOperation' || txErr?.message?.includes('Transaction') || txErr?.message?.includes('replica');
    if (isNoReplica) {
      console.warn('[leave-approve] Standalone MongoDB fallback');
      try {
        const upd = await Request.findOneAndUpdate(
          withHospitalFilter(req, { _id: request._id, status: previousStatus }),
          { $set: { status: 'approved', adminNote: adminNote || '', resolvedBy: actorUserId, resolvedAt: new Date() } },
          { new: true }
        );
        if (!upd) { if (session) await session.endSession().catch(() => {}); return { updated: null, error: 'CONFLICT' }; }
        updatedRequest = upd;
        await writeLeaves(null);
        await writeBalance(null);
        if (settingDocId) {
          await Request.updateOne(withHospitalFilter(req, { _id: request._id }), { $set: { leaveRecordId: settingDocId } });
          updatedRequest.leaveRecordId = settingDocId;
        }
      } catch (fbErr) {
        console.error('[leave-approve][fallback]', fbErr?.message || fbErr);
        if (updatedRequest) {
          await Request.updateOne(withHospitalFilter(req, { _id: request._id }), { $set: { status: previousStatus, adminNote: '' } }).catch((e) => console.error('[leave-approve][fallback-revert]', e?.message));
        }
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
              lDoc.value = val; lDoc.markModified('value'); await lDoc.save();
            }
          } catch (revertErr) { console.error('[leave-approve][fallback-revert-leaves]', revertErr?.message); }
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

/* ─── İzin geri alma ─── */
async function revertLeaveBalance(request) {
  const { fromPersonId, targetDate, targetDateEnd, leaveTypeCode, hospitalId: hid } = request;
  if (!fromPersonId || !targetDate) return;

  const leaveCode = normalizeLeaveTypeCode(leaveTypeCode);
  const start = new Date(`${String(targetDate).slice(0, 10)}T00:00:00`);
  const end   = new Date(`${String(targetDateEnd || targetDate).slice(0, 10)}T00:00:00`);
  if (isNaN(start) || isNaN(end) || end < start) return;

  const totalDays = Math.round((end - start) / 86_400_000) + 1;
  const year = start.getFullYear();
  const pid  = String(fromPersonId);

  const leaveType   = await LeaveType.findOne({ hospitalId: hid, code: leaveCode });
  const leaveTypeId = leaveType ? String(leaveType._id) : leaveCode;
  const balance = await LeaveBalance.findOneAndUpdate(
    { hospitalId: hid, personId: pid, leaveTypeId, year },
    { $inc: { used: -totalDays } },
    { new: true }
  );
  if (balance) {
    const used = Math.max(0, Number(balance.used || 0));
    const allocated = Number(balance.allocated || 0);
    await LeaveBalance.updateOne(
      { _id: balance._id },
      { $set: { used, remaining: Math.max(0, allocated - used) } }
    );
  }

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
      lDoc.value = val; lDoc.markModified('value'); await lDoc.save();
    }
  } catch (err) {
    console.error('[leave-revert] leavesV2 silme hatası:', err?.message);
  }
}

/* ═══════════════════════════════════════════════════════
   YENİ: Real-Time Event + Fairness Entegrasyonu
═══════════════════════════════════════════════════════ */

function emitRequestUpdated(request, status) {
  try {
    broadcastAll('request:updated', {
      requestId: String(request._id),
      type:      String(request.type || ''),
      status:    String(status || request.status || ''),
      serviceId: String(request.serviceId || ''),
    });
  } catch {}
}

async function notifyFairnessScore({ hospitalId, fromPersonId, fromUserId, targetDate }) {
  if (!fromPersonId) return;
  const dateStr = String(targetDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}/.test(dateStr)) return;
  const year  = Number(dateStr.slice(0, 4));
  const month = Number(dateStr.slice(5, 7));
  if (!year || !month) return;
  try {
    const result = await computeMonthlyFairnessScores({ hospitalId, year, month });
    const pid   = String(fromPersonId);
    const entry = result.people.find((p) => String(p.personId) === pid);
    if (!entry) return;

    let resolvedUserId = fromUserId ? String(fromUserId) : null;
    if (!resolvedUserId) {
      const person = await Person.findById(pid).select('userId').lean();
      resolvedUserId = person?.userId ? String(person.userId) : null;
    }
    if (!resolvedUserId) return;

    const score      = entry.fairnessScore;
    const monthLabel = TR_MONTHS[month - 1] || `Ay ${month}`;
    void saveAndBroadcast({
      userId:     resolvedUserId,
      hospitalId: String(hospitalId || ''),
      type:       score >= 80 ? 'success' : score >= 55 ? 'warning' : 'info',
      title:      `${monthLabel} ${year} Adillik Güncellemesi`,
      message:    `İzin onayı sonrası ${monthLabel} ${year} adillik skorunuz: %${score}.`,
      data:       { year, month, fairnessScore: score },
    });
  } catch (err) {
    console.warn('[requestService][notifyFairnessScore]', err?.message);
  }
}

/* ═══════════════════════════════════════════════════════
   PUBLIC API — route handler'lardan çağrılır
═══════════════════════════════════════════════════════ */

async function approveLeaveRequest({ req, request, adminNote, actorUserId, actorName }) {
  const previousStatus = String(request.status || 'pending');
  const { updated, error } = await approveLeaveWithTransaction(req, request, previousStatus, adminNote, actorUserId);
  if (error === 'CONFLICT') return { ok: false, httpStatus: 409, message: 'Talep durumu değişti, lütfen sayfayı yenileyin' };
  if (error)               return { ok: false, httpStatus: 500, message: error };

  void broadcastAll('leaves:refresh', {});
  void emitRequestUpdated(updated, 'approved');
  void sendLeaveApproved({ request: updated, actorName }).catch((e) => console.error('[notify][leave-approved]', e?.message));
  void notifyFairnessScore({ hospitalId: request.hospitalId, fromPersonId: request.fromPersonId, fromUserId: request.fromUserId, targetDate: request.targetDate });

  return { ok: true, request: updated };
}

async function rejectLeaveRequest({ req, request, adminNote, actorUserId, actorName, previousStatus }) {
  const updatedRequest = await Request.findOneAndUpdate(
    withHospitalFilter(req, { _id: request._id, status: previousStatus }),
    { $set: { status: 'rejected', adminNote: adminNote || '', resolvedBy: actorUserId, resolvedAt: new Date() } },
    { new: true }
  );
  if (!updatedRequest) return { ok: false, httpStatus: 409, message: 'Talep durumu değişti, lütfen sayfayı yenileyin' };

  void emitRequestUpdated(updatedRequest, 'rejected');
  void sendLeaveRejected({ request: updatedRequest, actorName }).catch((e) => console.error('[notify][leave-rejected]', e?.message));

  if (previousStatus === 'approved') {
    void broadcastAll('leaves:refresh', {});
    void revertLeaveBalance(updatedRequest).catch((e) => console.error('[leave-balance-revert]', e?.message));
  }
  return { ok: true, request: updatedRequest };
}

async function approveSwapRequest({ req, request, adminNote, actorUserId, actorName, forceSwap, previousStatus }) {
  // Validation-First: her iki taraf için kural simülasyonu
  try {
    const swapVal = await validateSwap(request);
    if (!swapVal.valid && !forceSwap) {
      return { ok: false, httpStatus: 400, message: 'Takas kural ihlali içeriyor. Devam etmek için forceSwap: true gönderin.', violations: swapVal.violations, canForce: true };
    }
    if (!swapVal.valid && forceSwap) {
      console.warn('[swap-validate] Kural ihlali forceSwap ile geçildi:', JSON.stringify(swapVal.violations));
    }
  } catch (valErr) {
    console.error('[swap-validate] ERR:', valErr?.message);
  }

  // Aynı gün / ardışık gece çakışma kontrolü
  try {
    const conflict = await checkSwapConflicts(request);
    if (conflict) return { ok: false, httpStatus: 422, message: conflict };
  } catch (checkErr) {
    console.error('[swap-conflict-check] ERR:', checkErr?.message);
  }

  // Atomik durum güncellemesi
  const updatedRequest = await Request.findOneAndUpdate(
    withHospitalFilter(req, { _id: request._id, status: previousStatus }),
    { $set: { status: 'approved', adminNote: adminNote || '', resolvedBy: actorUserId, resolvedAt: new Date() } },
    { new: true }
  );
  if (!updatedRequest) return { ok: false, httpStatus: 409, message: 'Talep durumu değişti, lütfen sayfayı yenileyin' };

  // Çizelgede takas gerçekleştir
  if (!updatedRequest.swapExecuted) {
    try {
      const executed = await executeSwap(updatedRequest);
      if (executed) {
        await Request.updateOne(withHospitalFilter(req, { _id: updatedRequest._id }), { $set: { swapExecuted: true } });
        updatedRequest.swapExecuted = true;
      } else {
        await Request.updateOne(
          withHospitalFilter(req, { _id: updatedRequest._id }),
          { $set: { status: previousStatus, adminNote: 'Takas çizelgede gerçekleştirilemedi — vardiya bulunamadı veya çizelge kaydedilmemiş. Durum geri alındı.' } }
        );
        return { ok: false, httpStatus: 422, message: 'Takas onaylandı ancak çizelgede ilgili vardiya bulunamadı. Durum "Beklemede" ye geri alındı — çizelgeyi kaydedin ve tekrar deneyin.' };
      }
    } catch (e) {
      await Request.updateOne(
        withHospitalFilter(req, { _id: updatedRequest._id }),
        { $set: { status: previousStatus, adminNote: `Takas sırasında hata: ${e?.message || 'bilinmeyen hata'}` } }
      ).catch(() => {});
      return { ok: false, httpStatus: 500, message: e?.message || 'Takas sırasında sunucu hatası' };
    }

    // SSE: tüm istemciler atama değişikliğini bilir
    void broadcastAll('assignments:refresh', { serviceId: String(request.serviceId || '') });
    void emitRequestUpdated(updatedRequest, 'approved');

    // Her iki tarafa bildirim
    void sendShiftChanged({
      personId:      request.fromPersonId, userId: request.fromUserId,
      personName:    request.fromName,     date: request.swapMyDate,
      previousShift: request.swapMyShiftLabel || request.swapMyShiftId,
      newShift:      request.swapTargetShiftLabel || request.swapTargetShiftId,
      changedByName: actorName, action: 'updated',
    }).catch((e) => console.error('[notify][swap-from]', e?.message));
    void sendShiftChanged({
      personId:      request.swapWithPersonId, date: request.swapTargetDate,
      previousShift: request.swapTargetShiftLabel || request.swapTargetShiftId,
      newShift:      request.swapMyShiftLabel || request.swapMyShiftId,
      changedByName: actorName, action: 'updated',
    }).catch((e) => console.error('[notify][swap-to]', e?.message));
  }

  return { ok: true, request: updatedRequest };
}

module.exports = {
  approveLeaveRequest,
  approveSwapRequest,
  rejectLeaveRequest,
  emitRequestUpdated,
  notifyFairnessScore,
  // Exported for direct use by routes (validation, peer responses etc.)
  validateSwap,
  checkSwapConflicts,
  revertLeaveBalance,
};
