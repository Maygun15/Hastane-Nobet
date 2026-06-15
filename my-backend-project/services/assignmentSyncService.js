const mongoose = require('mongoose');
const Assignment = require('../models/Assignment');

const EXACT_PROJECTION_SCOPE_CODE = 'EXACT_PROJECTION_SCOPE_REQUIRED';
const EXACT_PROJECTION_SCOPE_MESSAGE = 'A complete schedule scope is required for Assignment projection synchronization.';
const LEGACY_SCRIPT_MODE = 'legacy-script';

function normalizeScopeValue(value) {
  if (value === undefined || value === null) return '';
  return String(value)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function createExactProjectionScopeError() {
  const error = new Error(EXACT_PROJECTION_SCOPE_MESSAGE);
  error.code = EXACT_PROJECTION_SCOPE_CODE;
  error.status = 400;
  error.statusCode = 400;
  return error;
}

function assertExactProjectionScope(scope = {}, { requireSourceScheduleId = false } = {}) {
  const rawHospitalId = scope?.hospitalId;
  const hospitalId = typeof rawHospitalId === 'string' ? rawHospitalId.trim() : (rawHospitalId || null);
  const sectionId = String(scope?.sectionId || '').trim();
  const serviceId = scope?.serviceId != null ? String(scope.serviceId).trim() : '';
  const role = scope?.role != null ? String(scope.role).trim() : '';
  const year = Number(scope?.year);
  const month = Number(scope?.month);
  const rawSourceScheduleId = scope?.sourceScheduleId;
  const sourceScheduleId = typeof rawSourceScheduleId === 'string'
    ? rawSourceScheduleId.trim()
    : (rawSourceScheduleId || null);
  const invalidServices = new Set(['', 'all', 'all services', 'all roles', 'tumu', 'tum servisler', 'tum roller']);
  const invalidRoles = new Set(['', 'all', 'all services', 'all roles', 'tumu', 'tum servisler', 'tum roller']);

  if (
    !hospitalId
    || !sectionId
    || invalidServices.has(normalizeScopeValue(serviceId))
    || invalidRoles.has(normalizeScopeValue(role))
    || !Number.isInteger(year)
    || year < 2000
    || year > 2100
    || !Number.isInteger(month)
    || month < 1
    || month > 12
    || (requireSourceScheduleId && !sourceScheduleId)
  ) {
    throw createExactProjectionScopeError();
  }

  return Object.freeze({
    hospitalId,
    sectionId,
    serviceId,
    role,
    year,
    month,
    sourceScheduleId,
  });
}

function canonName(str = '') {
  return String(str || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleUpperCase('tr-TR')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseDateYmd(raw) {
  const str = String(raw || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return null;
  const [y, m, d] = str.split('-').map((x) => Number(x));
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() + 1 !== m || dt.getDate() !== d) return null;
  return { y, m, d, date: str, weekday: dt.getDay() };
}

function buildTaskKey(item = {}) {
  const rowId = String(item?.rowId || item?.shiftId || '').trim();
  const shiftCode = String(item?.shiftCode || item?.shift || item?.code || '').trim();
  const roleLabel = String(item?.roleLabel || item?.rowLabel || item?.label || item?.area || '').trim();
  return `${rowId || shiftCode}|${roleLabel}`;
}

function buildPersonKey(item = {}) {
  const personId = String(item?.personId || item?.pid || item?.staffId || '').trim();
  const personName = canonName(item?.personName || item?.fullName || item?.name || '');
  return personId || personName;
}

function buildDefsIndex(defs = []) {
  const byId = new Map();
  const byShift = new Map();
  for (const row of defs || []) {
    const id = String(row?.id || row?.rowId || '').trim();
    const shiftCode = String(row?.shiftCode || row?.code || '').trim();
    if (id) byId.set(id, row);
    if (shiftCode) byShift.set(shiftCode, row);
  }
  return { byId, byShift };
}

function shiftDurationHours(startRaw = '', endRaw = '') {
  const start = String(startRaw || '').trim();
  const end = String(endRaw || '').trim();
  if (!start || !end) return 0;
  const [sh, sm] = start.split(':').map((v) => Number(v || 0));
  const [eh, em] = end.split(':').map((v) => Number(v || 0));
  if (![sh, sm, eh, em].every(Number.isFinite)) return 0;
  const startMin = (sh * 60) + sm;
  const endMin = (eh * 60) + em;
  const diff = endMin >= startMin ? (endMin - startMin) : ((24 * 60 - startMin) + endMin);
  return Math.round((diff / 60) * 100) / 100;
}

function buildAssignmentsFromNamed({ year, month, defs = [], namedAssignments = {} }) {
  const out = [];
  const seen = new Set();
  const defIndex = buildDefsIndex(defs);
  const pad2 = (n) => String(n).padStart(2, '0');

  for (const [dayStr, perRow] of Object.entries(namedAssignments || {})) {
    const day = Number(dayStr);
    if (!Number.isFinite(day) || day < 1 || day > 31) continue;
    const date = `${year}-${pad2(month)}-${pad2(day)}`;
    const weekday = new Date(year, month - 1, day).getDay();
    for (const [rowIdRaw, names] of Object.entries(perRow || {})) {
      const rowId = String(rowIdRaw || '').trim();
      const def = defIndex.byId.get(rowId) || defIndex.byShift.get(rowId) || null;
      const shiftId = String(def?.id || def?.rowId || rowId).trim();
      const shiftCode = String(def?.shiftCode || def?.code || rowId).trim();
      const roleLabel = String(def?.label || def?.name || def?.area || rowId).trim();
      for (const personNameRaw of names || []) {
        const personName = String(personNameRaw || '').trim();
        if (!personName) continue;
        const key = `${date}|${shiftId}|${personName}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          date,
          day,
          weekday,
          rowId,
          shiftId,
          shiftCode,
          roleLabel,
          personName,
        });
      }
    }
  }
  return out;
}

function normalizeAssignmentRecord(item = {}, scope = {}, options = {}) {
  const dateInfo = parseDateYmd(item?.date || item?.day);
  if (!dateInfo) return null;

  const sectionId = String(scope?.sectionId || '').trim();
  if (!sectionId) return null;
  const serviceId = scope?.serviceId != null ? String(scope.serviceId).trim() : '';
  const role = scope?.role != null ? String(scope.role).trim() : '';
  const personKey = buildPersonKey(item);
  if (!personKey) return null;

  const defsIndex = options?.defsIndex || { byId: new Map(), byShift: new Map() };
  let rowId = String(item?.rowId || '').trim();
  let shiftId = String(item?.shiftId || item?.shiftCode || item?.shift || item?.code || '').trim();
  let shiftCode = String(item?.shiftCode || item?.shiftId || item?.shift || item?.code || '').trim();
  let roleLabel = String(item?.roleLabel || item?.rowLabel || item?.label || item?.area || '').trim();

  const refKey = rowId || shiftId || shiftCode;
  const def = (refKey && defsIndex.byId.get(refKey))
    || (shiftCode && defsIndex.byShift.get(shiftCode))
    || null;

  if (def) {
    const defRowId = String(def?.rowId || def?.id || '').trim();
    const defShiftId = String(def?.id || def?.rowId || def?.shiftId || '').trim();
    const defShiftCode = String(def?.shiftCode || def?.code || '').trim();
    const defRoleLabel = String(def?.label || def?.name || def?.area || '').trim();
    if (!rowId && defRowId) rowId = defRowId;
    if (!shiftId && defShiftId) shiftId = defShiftId;
    if ((!shiftCode || shiftCode === shiftId || shiftCode === rowId) && defShiftCode) shiftCode = defShiftCode;
    if (!roleLabel && defRoleLabel) roleLabel = defRoleLabel;
  }

  const taskKey = buildTaskKey({ rowId, shiftCode, roleLabel, shiftId });
  if (!taskKey) return null;

  const hoursValue = Number(item?.hours);
  const defHours = def
    ? (() => {
        const explicit = Number(def?.hours ?? def?.duration ?? def?.totalHours);
        if (Number.isFinite(explicit) && explicit > 0) return explicit;
        return shiftDurationHours(def?.start ?? def?.from ?? def?.begin ?? def?.startTime, def?.end ?? def?.to ?? def?.finish ?? def?.endTime);
      })()
    : 0;
  const source = String(item?.source || options?.source || 'monthlySchedule').trim() || 'monthlySchedule';

  return {
    sourceScheduleId: scope?.sourceScheduleId || null,
    hospitalId: scope?.hospitalId || null,
    sectionId,
    serviceId,
    role,
    year: Number(scope?.year || dateInfo.y),
    month: Number(scope?.month || dateInfo.m),
    date: dateInfo.date,
    day: dateInfo.d,
    weekday: Number.isFinite(Number(item?.weekday)) ? Number(item.weekday) : dateInfo.weekday,
    rowId,
    shiftId,
    shiftCode,
    roleLabel,
    taskKey,
    personId: String(item?.personId || item?.pid || item?.staffId || '').trim(),
    personName: String(item?.personName || item?.fullName || item?.name || '').trim(),
    personKey,
    hours: Number.isFinite(hoursValue) && hoursValue > 0 ? hoursValue : defHours,
    pinned: item?.pinned === true,
    supervisorTask: item?.supervisorTask === true,
    note: String(item?.note || '').trim(),
    source,
    status: 'active',
    overrideReason: String(item?.overrideReason || '').trim(),
    createdBy: options?.createdBy || item?.createdBy || null,
    updatedBy: options?.updatedBy || item?.updatedBy || options?.createdBy || null,
  };
}

function extractAssignmentsFromPayload(payload = {}, scope = {}) {
  if (!payload || typeof payload !== 'object') return [];
  if (Array.isArray(payload.assignments)) return payload.assignments;
  const defs = Array.isArray(payload.defs)
    ? payload.defs
    : Array.isArray(payload.rows)
      ? payload.rows
      : [];
  const namedAssignments =
    payload?.roster?.namedAssignments && typeof payload.roster.namedAssignments === 'object'
      ? payload.roster.namedAssignments
      : payload?.namedAssignments && typeof payload.namedAssignments === 'object'
        ? payload.namedAssignments
        : null;

  if (namedAssignments) {
    return buildAssignmentsFromNamed({
      year: scope?.year,
      month: scope?.month,
      defs,
      namedAssignments,
    });
  }
  return [];
}

async function replaceAssignmentsForSchedule({
  scope = {},
  payload = {},
  createdBy = null,
  updatedBy = null,
  source = 'monthlySchedule',
  mode = 'operational',
} = {}) {
  const baseScope = mode === LEGACY_SCRIPT_MODE
    ? {
        hospitalId: scope?.hospitalId || null,
        sectionId: String(scope?.sectionId || '').trim(),
        serviceId: scope?.serviceId != null ? String(scope.serviceId).trim() : '',
        role: scope?.role != null ? String(scope.role).trim() : '',
        year: Number(scope?.year),
        month: Number(scope?.month),
        sourceScheduleId: scope?.sourceScheduleId || null,
      }
    : assertExactProjectionScope(scope, { requireSourceScheduleId: true });
  if (!baseScope.sectionId || !baseScope.year || !baseScope.month) return { count: 0 };

  const rawAssignments = extractAssignmentsFromPayload(payload, baseScope);
  const defs = Array.isArray(payload?.defs)
    ? payload.defs
    : Array.isArray(payload?.rows)
      ? payload.rows
      : [];
  const defsIndex = buildDefsIndex(defs);
  const docs = rawAssignments
    .map((item) => normalizeAssignmentRecord(item, baseScope, { source, createdBy, updatedBy, defsIndex }))
    .filter(Boolean);

  const deleteQuery = {
    hospitalId: baseScope.hospitalId,
    sectionId: baseScope.sectionId,
    serviceId: baseScope.serviceId,
    role: baseScope.role,
    year: baseScope.year,
    month: baseScope.month,
  };

  // Insert-first pattern: ensure new docs exist before removing old ones,
  // eliminating the empty-window risk of delete-then-insert.
  // If transactions are supported (replica set), use them; otherwise fall back safely.
  let session = null;
  try {
    session = await mongoose.startSession();
    await session.withTransaction(async () => {
      await Assignment.deleteMany(deleteQuery, { session });
      if (docs.length) await Assignment.insertMany(docs, { ordered: false, session });
    });
  } catch (txErr) {
    const isNoReplicaSet = txErr?.codeName === 'IllegalOperation'
      || txErr?.message?.includes('Transaction')
      || txErr?.message?.includes('replica');
    if (isNoReplicaSet) {
      // Standalone MongoDB: safe fallback using bulkWrite upserts then delete orphans
      if (docs.length) {
        const ops = docs.map((d) => ({
          updateOne: {
            filter: {
              sectionId: d.sectionId, serviceId: d.serviceId, role: d.role,
              hospitalId: d.hospitalId || null,
              date: d.date, taskKey: d.taskKey, personKey: d.personKey,
            },
            update: {
              $set: {
                sourceScheduleId: d.sourceScheduleId,
                hospitalId: d.hospitalId || null,
                sectionId: d.sectionId,
                serviceId: d.serviceId,
                role: d.role,
                year: d.year,
                month: d.month,
                date: d.date,
                day: d.day,
                weekday: d.weekday,
                rowId: d.rowId,
                shiftId: d.shiftId,
                shiftCode: d.shiftCode,
                roleLabel: d.roleLabel,
                taskKey: d.taskKey,
                personId: d.personId,
                personName: d.personName,
                personKey: d.personKey,
                hours: d.hours,
                pinned: d.pinned,
                supervisorTask: d.supervisorTask,
                note: d.note,
                source: d.source,
                status: d.status,
                overrideReason: d.overrideReason,
                updatedBy: d.updatedBy,
              },
              $setOnInsert: { createdBy: d.createdBy || null },
            },
            upsert: true,
          },
        }));
        await Assignment.bulkWrite(ops, { ordered: false });
      }
      // Delete records from this month that were not in the new set
      const newKeys = new Set(docs.map((d) => `${d.date}|${d.taskKey}|${d.personKey}`));
      const existing = await Assignment.find(deleteQuery).select('date taskKey personKey _id').lean();
      const orphanIds = existing
        .filter((r) => !newKeys.has(`${r.date}|${r.taskKey}|${r.personKey}`))
        .map((r) => r._id);
      if (orphanIds.length) await Assignment.deleteMany({ _id: { $in: orphanIds } });
    } else {
      throw txErr;
    }
  } finally {
    if (session) await session.endSession().catch(() => {});
  }

  return { count: docs.length };
}

async function upsertAssignment({ scope = {}, assignment = {}, createdBy = null, updatedBy = null, source = 'manual' } = {}) {
  const exactScope = assertExactProjectionScope(scope, { requireSourceScheduleId: true });
  const doc = normalizeAssignmentRecord(assignment, exactScope, { source, createdBy, updatedBy });
  if (!doc) return null;
  await Assignment.findOneAndUpdate(
    {
      hospitalId: doc.hospitalId || null,
      sectionId: doc.sectionId,
      serviceId: doc.serviceId,
      role: doc.role,
      date: doc.date,
      taskKey: doc.taskKey,
      personKey: doc.personKey,
    },
    { $set: doc, $setOnInsert: { createdBy: doc.createdBy || updatedBy || null } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  return doc;
}

async function removeAssignment({ scope = {}, assignment = {} } = {}) {
  const exactScope = assertExactProjectionScope(scope);
  const dateInfo = parseDateYmd(assignment?.date || assignment?.day);
  if (!dateInfo) return { deletedCount: 0 };
  const personId = String(assignment?.personId || '').trim();
  const personName = canonName(assignment?.personName || assignment?.name || '');
  const shiftId = String(assignment?.shiftId || assignment?.shiftCode || assignment?.shift || assignment?.code || '').trim();
  const roleLabel = String(assignment?.roleLabel || assignment?.rowLabel || assignment?.label || assignment?.area || '').trim();
  const taskKey = buildTaskKey({ shiftId, rowId: assignment?.rowId, shiftCode: assignment?.shiftCode, roleLabel });
  const personKey = personId || personName;
  if (!personKey) return { deletedCount: 0 };

  const result = await Assignment.deleteMany({
    hospitalId: exactScope.hospitalId,
    sectionId: exactScope.sectionId,
    serviceId: exactScope.serviceId,
    role: exactScope.role,
    date: dateInfo.date,
    taskKey,
    personKey,
  });
  return result;
}

module.exports = {
  EXACT_PROJECTION_SCOPE_CODE,
  EXACT_PROJECTION_SCOPE_MESSAGE,
  assertExactProjectionScope,
  replaceAssignmentsForSchedule,
  upsertAssignment,
  removeAssignment,
};
