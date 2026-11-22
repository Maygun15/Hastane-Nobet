// routes/schedules.routes.js
const express = require('express');
const institutionRules = require('../services/institutionRules');
const scheduleChanges = require('../services/scheduleChangeService');
const router = express.Router();

const MonthlySchedule = require('../models/MonthlySchedule');
const Assignment = require('../models/Assignment');
const ScheduleRules = require('../models/ScheduleRules');
const { listHolidays } = require('../services/holidayService');
const { sendShiftChanged } = require('../services/notificationService');
const {
  PUBLICATION_STATUS,
  canViewDrafts,
  draftPublication,
  excludeDraftScopes,
  findDraftScopes,
  isDraftSchedule,
  setPublicationStatus,
} = require('../services/schedulePublicationService');
const { validateAssignment } = require('../utils/rulesValidator');
const { checkSameDayConflict, checkLeaveConflict } = require('../services/conflictService');
const {
  replaceAssignmentsForSchedule,
  removeAssignment,
} = require('../services/assignmentSyncService');
const { requireAuth, sameServiceOrAdmin, requireRole } = require('../middleware/authz');
const { assignShiftSchema, validate } = require('../middleware/validate');
const {
  requireSpecificServiceScope,
  specificServiceErrorPayload,
} = require('../utils/serviceScopeGuard');
const {
  carryForwardMonthlyTemplate,
} = require('../services/monthlyTemplateCarryForwardService');
const {
  captureMonthlyScheduleSnapshot,
  recordUndoableOperation,
} = require('../services/undoService');
const ExcelJS = require('exceljs');
const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
const safeMessage = (err, fallback = 'Sunucu hatası') =>
  isProd ? fallback : (err?.message || fallback);

function buildUndoSummary(operationType, item = {}) {
  const date = String(item?.date || item?.day || '').slice(0, 10) || '-';
  const person = String(item?.personName || item?.name || item?.personId || '').trim() || '-';
  const shift = String(item?.shiftCode || item?.shiftId || item?.code || '').trim() || '-';
  const label = String(item?.roleLabel || item?.label || item?.area || '').trim();
  if (operationType === 'MANUAL_ASSIGNMENT_DELETE') {
    return `${date} ${shift}${label ? ` ${label}` : ''}: ${person} silindi`;
  }
  if (operationType === 'QUICK_REPLACE') {
    const from = String(item?.changedFromPersonName || item?.replacePersonName || '').trim() || '-';
    return `${date} ${shift}${label ? ` ${label}` : ''}: ${from} -> ${person}`;
  }
  if (operationType === 'MANUAL_ASSIGNMENT_EDIT') {
    return `${date} ${shift}${label ? ` ${label}` : ''}: ${person} güncellendi`;
  }
  return `${date} ${shift}${label ? ` ${label}` : ''}: ${person} eklendi`;
}

async function recordScheduleUndoOperation({
  scope,
  operationType,
  payload,
  beforeSnapshot,
  afterSnapshot,
  scheduleId,
  user,
}) {
  try {
    await recordUndoableOperation({
      scope,
      operationType,
      summary: buildUndoSummary(operationType, payload),
      entityRefs: {
        personId: payload?.personId || payload?.changedFromPersonId || null,
        personName: payload?.personName || payload?.changedFromPersonName || null,
        date: String(payload?.date || payload?.day || '').slice(0, 10) || null,
        shiftCode: payload?.shiftCode || payload?.shiftId || null,
        rowId: payload?.rowId || payload?.shiftId || null,
      },
      targetDocumentId: scheduleId ? String(scheduleId) : null,
      sourceScheduleId: scheduleId ? String(scheduleId) : null,
      beforeSnapshot,
      afterSnapshot,
      createdBy: user?.uid || null,
      createdByName: user?.name || user?.email || '',
    });
  } catch (undoErr) {
    console.error('[undo][recordScheduleUndoOperation] ERR:', undoErr);
  }
}

function allowMonthlyRead(req, res, next) {
  const role = String(req.user?.role || '').toLowerCase();
  if (req.method === 'GET' && (role === 'user' || role === 'staff' || role === 'standard')) {
    return next();
  }
  return sameServiceOrAdmin(req, res, next);
}

function parseIntSafe(val, def = null) {
  const n = Number(val);
  return Number.isFinite(n) ? n : def;
}

const HALF_DAY_A_HOURS = 4;
const SERVICE_SUPERVISOR_LABEL = 'SERVİS SORUMLUSU';
const DEFAULT_FALLBACK_SHIFT_CAPACITY = 1;
const normalizeText = (s = '') =>
  String(s || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

function isServiceSupervisorLabel(label = '') {
  return normalizeText(label).includes('servis sorumlu');
}

function holidayKindRank(kind = '') {
  if (kind === 'full') return 3;
  if (kind === 'arife' || kind === 'half') return 2;
  return 0;
}

function buildHolidayKindByDateMap(holidays = []) {
  const out = Object.create(null);
  for (const row of holidays || []) {
    const date = String(row?.date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const kind = String(row?.kind || 'full').toLowerCase();
    const prev = String(out[date] || '');
    if (!prev || holidayKindRank(kind) >= holidayKindRank(prev)) {
      out[date] = kind;
    }
  }
  return out;
}

function buildSupervisorRowIdSet(defs = []) {
  const set = new Set();
  for (const row of defs || []) {
    const id = String(row?.id || row?.rowId || '').trim();
    const label = String(row?.label || row?.area || row?.name || '').trim();
    if (!id || !label) continue;
    if (isServiceSupervisorLabel(label)) set.add(id);
  }
  return set;
}

function isSupervisorAssignment(item = {}, supervisorRowIds = new Set()) {
  const shiftId = String(item?.shiftId || item?.rowId || '').trim();
  const label = String(item?.roleLabel || item?.label || item?.area || '').trim();
  return (
    item?.supervisorTask === true ||
    supervisorRowIds.has(shiftId) ||
    isServiceSupervisorLabel(label)
  );
}

function sanitizeSupervisorAssignments(assignments = [], defs = [], holidayKindByDate = {}) {
  const supervisorRowIds = buildSupervisorRowIdSet(defs);
  let changed = false;
  const cleaned = [];

  for (const item of assignments || []) {
    const isSupervisor = isSupervisorAssignment(item, supervisorRowIds);
    if (!isSupervisor) {
      cleaned.push(item);
      continue;
    }

    const dateStr = String(item?.date || item?.day || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      cleaned.push(item);
      continue;
    }

    const dt = new Date(`${dateStr}T00:00:00`);
    const weekday = Number.isNaN(dt.getTime()) ? NaN : dt.getDay();
    const kind = String(holidayKindByDate?.[dateStr] || '').toLowerCase();

    if (weekday === 0 || weekday === 6 || kind === 'full') {
      changed = true;
      continue;
    }

    if (kind === 'arife' || kind === 'half') {
      const next = {
        ...item,
        roleLabel: String(item?.roleLabel || item?.label || '').trim() || SERVICE_SUPERVISOR_LABEL,
        supervisorTask: true,
        shiftCode: 'A',
        shiftId: 'A',
        hours: HALF_DAY_A_HOURS,
      };
      if (
        String(item?.roleLabel || item?.label || '').trim() !== next.roleLabel ||
        item?.supervisorTask !== true ||
        String(item?.shiftCode || '') !== 'A' ||
        String(item?.shiftId || '') !== 'A' ||
        Number(item?.hours) !== HALF_DAY_A_HOURS
      ) {
        changed = true;
      }
      cleaned.push(next);
      continue;
    }

    const next = {
      ...item,
      roleLabel: String(item?.roleLabel || item?.label || '').trim() || SERVICE_SUPERVISOR_LABEL,
      supervisorTask: true,
    };
    if (
      String(item?.roleLabel || item?.label || '').trim() !== next.roleLabel ||
      item?.supervisorTask !== true
    ) {
      changed = true;
    }
    cleaned.push(next);
  }

  return { assignments: cleaned, changed };
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

function normalizeShiftToken(v) {
  return String(v || '').trim().toUpperCase();
}

function buildTokens(...values) {
  return values
    .map((v) => normalizeShiftToken(v))
    .filter(Boolean);
}

function hasAnyDirectIdMatch(targetTokens = [], ...values) {
  if (!targetTokens.length) return false;
  const targetSet = new Set(targetTokens);
  return values.some((value) => {
    const token = normalizeShiftToken(value);
    return token && targetSet.has(token);
  });
}

function hasAnyTokenOverlap(a = [], b = []) {
  if (!a.length || !b.length) return false;
  const setA = new Set(a);
  return b.some((token) => setA.has(token));
}

function toDateParts(dateStr = '') {
  const m = String(dateStr || '').slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mon = Number(m[2]);
  const day = Number(m[3]);
  if (!y || !mon || !day) return null;
  const dt = new Date(y, mon - 1, day);
  if (Number.isNaN(dt.getTime())) return null;
  const weekdaySun0 = dt.getDay();
  const weekdayMon0 = (weekdaySun0 + 6) % 7;
  return { y, mon, day, weekdaySun0, weekdayMon0 };
}

function getDailyDefRequiredCount(defs = [], targetTokens = [], dateParts = null) {
  if (!targetTokens.length || !dateParts) return null;
  const readNeed = (sh = {}) => {
    const need = Number(sh?.requiredCount ?? sh?.count ?? sh?.need ?? sh?.required ?? sh?.qty ?? 0);
    return Number.isFinite(need) ? Math.max(0, need) : 0;
  };
  const matchingDailyShifts = [];
  for (const row of defs || []) {
    const rowDate = String(row?.date || '').slice(0, 10);
    const rowDay = Number(row?.day || 0);
    const dateMatches =
      (rowDate && rowDate === `${dateParts.y}-${String(dateParts.mon).padStart(2, '0')}-${String(dateParts.day).padStart(2, '0')}`) ||
      (Number.isFinite(rowDay) && rowDay === dateParts.day);
    if (!dateMatches || !Array.isArray(row?.shifts)) continue;
    for (const sh of row.shifts) {
      const directIdMatch = hasAnyDirectIdMatch(
        targetTokens,
        sh?.id,
        sh?.rowId,
        sh?.shiftId
      );
      const shiftTokens = buildTokens(
        sh?.id,
        sh?.rowId,
        sh?.shiftId,
        sh?.code,
        sh?.shiftCode
      );
      if (directIdMatch) return readNeed(sh);
      if (hasAnyTokenOverlap(targetTokens, shiftTokens)) matchingDailyShifts.push(sh);
    }
  }
  if (matchingDailyShifts.length) return readNeed(matchingDailyShifts[0]);
  return null;
}

function getPatternDefRequiredCount(defs = [], overrides = {}, targetTokens = [], dateParts = null) {
  if (!targetTokens.length || !dateParts) return null;
  const readNeed = (row = {}) => {
    const rowId = String(row?.id || row?.rowId || '').trim();
    let value = undefined;
    if (rowId && overrides?.[rowId] && Object.prototype.hasOwnProperty.call(overrides[rowId], String(dateParts.day))) {
      value = overrides[rowId][String(dateParts.day)];
    } else {
      const pattern = Array.isArray(row?.pattern) ? row.pattern : [];
      value = pattern[dateParts.weekdayMon0];
      if (value == null) value = row?.defaultCount;
    }

    if (row?.weekendOff && (dateParts.weekdaySun0 === 0 || dateParts.weekdaySun0 === 6)) {
      value = 0;
    }
    const need = Number(value || 0);
    return Number.isFinite(need) ? Math.max(0, need) : 0;
  };

  const overlapRows = [];
  for (const row of defs || []) {
    const directIdMatch = hasAnyDirectIdMatch(
      targetTokens,
      row?.id,
      row?.rowId
    );
    const rowTokens = buildTokens(
      row?.id,
      row?.rowId,
      row?.shiftCode,
      row?.code
    );
    if (directIdMatch) return readNeed(row);
    if (hasAnyTokenOverlap(targetTokens, rowTokens)) overlapRows.push(row);
  }
  if (overlapRows.length) return readNeed(overlapRows[0]);
  return null;
}

function getShiftCapacityForDate({ defs = [], overrides = {}, dateStr = '', shiftLike = {} }) {
  const dateParts = toDateParts(dateStr);
  if (!dateParts) return DEFAULT_FALLBACK_SHIFT_CAPACITY;
  const targetTokens = buildTokens(
    shiftLike?.shiftId,
    shiftLike?.shiftCode,
    shiftLike?.shift,
    shiftLike?.code
  );
  if (!targetTokens.length) return DEFAULT_FALLBACK_SHIFT_CAPACITY;

  const fromDaily = getDailyDefRequiredCount(defs, targetTokens, dateParts);
  if (fromDaily != null) return fromDaily;
  const fromPattern = getPatternDefRequiredCount(defs, overrides, targetTokens, dateParts);
  if (fromPattern != null) return fromPattern;
  return DEFAULT_FALLBACK_SHIFT_CAPACITY;
}

function slotKey(item = {}) {
  const date = String(item?.date || item?.day || '').slice(0, 10);
  const row = (
    item?.rowId ||
    item?.dutyRowId ||
    item?.definitionId ||
    item?.defId ||
    item?.slotId ||
    item?.templateRowId ||
    item?.lineId ||
    item?.rowKey ||
    item?.taskKey ||
    ''
  );
  const area = (
    item?.areaId ||
    item?.area ||
    item?.unit ||
    item?.location ||
    item?.task ||
    item?.label ||
    item?.roleLabel ||
    item?.rowLabel ||
    ''
  );
  const shift = normalizeShiftToken(item?.shiftId || item?.shiftCode || item?.shift || item?.code);
  const rowPart = normalizeShiftToken(row);
  const areaPart = normalizeShiftToken(area);
  return `${date}|${rowPart}|${areaPart}|${shift}`;
}

function trimOverbookedAssignments({ assignments = [], defs = [], overrides = {} }) {
  const grouped = new Map();
  assignments.forEach((item, idx) => {
    const key = slotKey(item);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push({ item, idx });
  });

  const keepIdx = new Set();
  let changed = false;
  let dropped = 0;

  for (const rows of grouped.values()) {
    if (!rows.length) continue;
    const sample = rows[0]?.item || {};
    const dateStr = String(sample?.date || sample?.day || '').slice(0, 10);
    const cap = getShiftCapacityForDate({
      defs,
      overrides,
      dateStr,
      shiftLike: sample,
    });

    if (!Number.isFinite(cap)) {
      rows.forEach((r) => keepIdx.add(r.idx));
      continue;
    }

    const capacity = Math.max(0, Number(cap));
    if (rows.length <= capacity) {
      rows.forEach((r) => keepIdx.add(r.idx));
      continue;
    }

    changed = true;
    if (capacity <= 0) {
      dropped += rows.length;
      continue;
    }

    const ranked = [...rows].sort((a, b) => {
      const ap = a.item?.pinned ? 1 : 0;
      const bp = b.item?.pinned ? 1 : 0;
      if (bp !== ap) return bp - ap;
      const at = new Date(a.item?.createdAt || 0).getTime() || 0;
      const bt = new Date(b.item?.createdAt || 0).getTime() || 0;
      if (bt !== at) return bt - at;
      return b.idx - a.idx;
    });
    const winners = ranked.slice(0, capacity).map((r) => r.idx);
    winners.forEach((idx) => keepIdx.add(idx));
    dropped += Math.max(0, rows.length - capacity);
  }

  const cleaned = assignments.filter((_row, idx) => keepIdx.has(idx));
  return { assignments: cleaned, changed, dropped };
}

function countNamedAssignments(namedAssignments = {}) {
  let total = 0;
  for (const byRow of Object.values(namedAssignments || {})) {
    if (!byRow || typeof byRow !== 'object') continue;
    for (const names of Object.values(byRow || {})) {
      if (Array.isArray(names)) total += names.length;
    }
  }
  return total;
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
      const def =
        defIndex.byId.get(rowId) ||
        defIndex.byShift.get(rowId) ||
        null;
      const shiftId = String(def?.id || def?.rowId || rowId).trim();
      const shiftCode = String(def?.shiftCode || def?.code || rowId).trim();
      const roleLabel = String(def?.label || def?.name || def?.area || rowId).trim();
      const supervisorTask = isServiceSupervisorLabel(roleLabel);
      for (const personNameRaw of names || []) {
        const personName = String(personNameRaw || '').trim();
        if (!personName) continue;
        const key = `${date}|${shiftId}|${personName}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          date,
          day: date,
          weekday,
          shiftId,
          shiftCode,
          roleLabel,
          ...(supervisorTask ? { supervisorTask: true } : {}),
          personName,
        });
      }
    }
  }
  return out;
}

function chooseMonthlyResponseAssignments({ year, month, defs = [], scheduleData = {} } = {}) {
  const assignments = Array.isArray(scheduleData.assignments) ? scheduleData.assignments : [];
  const namedAssignments =
    scheduleData?.roster?.namedAssignments && typeof scheduleData.roster.namedAssignments === 'object'
      ? scheduleData.roster.namedAssignments
      : scheduleData?.namedAssignments && typeof scheduleData.namedAssignments === 'object'
      ? scheduleData.namedAssignments
      : null;
  const namedCount = namedAssignments ? countNamedAssignments(namedAssignments) : 0;

  if (namedAssignments && namedCount > assignments.length) {
    const rebuilt = buildAssignmentsFromNamed({
      year,
      month,
      defs,
      namedAssignments,
    });
    if (rebuilt.length > assignments.length) {
      return {
        assignments: rebuilt,
        source: 'namedAssignments',
        assignmentCount: assignments.length,
        namedCount,
      };
    }
  }

  return {
    assignments,
    source: 'assignments',
    assignmentCount: assignments.length,
    namedCount,
  };
}

function findDefForAssignment(item = {}, defs = []) {
  const defIndex = buildDefsIndex(defs);
  const refCandidates = [
    item?.rowId,
    item?.shiftId,
    item?.shiftCode,
    item?.shift,
    item?.code,
  ]
    .map((v) => (v == null ? '' : String(v).trim()))
    .filter(Boolean);
  for (const ref of refCandidates) {
    const found = defIndex.byId.get(ref) || defIndex.byShift.get(ref);
    if (found) return found;
  }

  const targetShift = canonText(item?.shiftCode || item?.shiftId || item?.shift || item?.code || '');
  const targetLabel = canonText(item?.roleLabel || item?.rowLabel || item?.label || item?.area || '');
  if (!targetShift && !targetLabel) return null;

  return (defs || []).find((row) => {
    const rowShift = canonText(row?.shiftCode || row?.code || row?.shiftId || row?.id || row?.rowId || '');
    const rowLabel = canonText(row?.label || row?.name || row?.area || '');
    const shiftOk = !targetShift || rowShift === targetShift;
    const labelOk = !targetLabel || rowLabel === targetLabel;
    return shiftOk && labelOk;
  }) || null;
}

function assignmentDayInfo(item = {}, year, month) {
  const parsed = parseDateYmd(item?.date || item?.day);
  if (parsed) return parsed;
  const day = Number(item?.day);
  if (!Number.isFinite(day) || day < 1 || day > 31) return null;
  const pad2 = (n) => String(n).padStart(2, '0');
  return parseDateYmd(`${year}-${pad2(month)}-${pad2(day)}`);
}

function buildNamedAssignmentsFromAssignments({ year, month, defs = [], assignments = [] }) {
  const namedAssignments = {};
  const seen = new Set();

  for (const item of assignments || []) {
    const dateInfo = assignmentDayInfo(item, year, month);
    if (!dateInfo) continue;

    const def = findDefForAssignment(item, defs);
    const rowId = String(
      def?.id ||
      def?.rowId ||
      item?.rowId ||
      item?.shiftId ||
      item?.shiftCode ||
      item?.shift ||
      item?.code ||
      ''
    ).trim();
    if (!rowId) continue;

    const personName = String(item?.personName || item?.name || item?.fullName || '').trim();
    if (!personName) continue;

    const dayKey = String(dateInfo.d);
    const dedupeKey = `${dayKey}|${rowId}|${canonName(personName)}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    if (!namedAssignments[dayKey]) namedAssignments[dayKey] = {};
    if (!Array.isArray(namedAssignments[dayKey][rowId])) namedAssignments[dayKey][rowId] = [];
    namedAssignments[dayKey][rowId].push(personName);
  }

  return namedAssignments;
}

function syncRosterNamedAssignments(data = {}, assignments = [], defs = [], year, month) {
  const rosterBase =
    data?.roster && typeof data.roster === 'object' && !Array.isArray(data.roster)
      ? data.roster
      : {};
  return {
    ...rosterBase,
    namedAssignments: buildNamedAssignmentsFromAssignments({ year, month, defs, assignments }),
  };
}

function appendScheduleChangeLog(existing = [], entry = null) {
  const list = Array.isArray(existing) ? existing : [];
  if (!entry) return list;
  return [...list, entry].slice(-200);
}

function buildChangeLogEntry({ type, payload, removedItem = null, user = null, at = new Date().toISOString() } = {}) {
  const fromPersonId = String(removedItem?.personId || payload?.changedFromPersonId || '').trim();
  const fromPersonName = String(removedItem?.personName || removedItem?.name || payload?.changedFromPersonName || '').trim();
  const toPersonId = String(payload?.personId || '').trim();
  const toPersonName = String(payload?.personName || payload?.name || '').trim();
  const shiftId = String(payload?.shiftId || payload?.shiftCode || removedItem?.shiftId || removedItem?.shiftCode || '').trim();
  const roleLabel = String(payload?.roleLabel || removedItem?.roleLabel || '').trim();

  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: type || 'manualChange',
    date: String(payload?.date || removedItem?.date || '').slice(0, 10),
    day: Number(String(payload?.date || removedItem?.date || '').slice(8, 10)) || undefined,
    rowId: String(payload?.rowId || removedItem?.rowId || shiftId || '').trim(),
    shiftId,
    shiftCode: String(payload?.shiftCode || removedItem?.shiftCode || shiftId || '').trim(),
    roleLabel,
    from: { personId: fromPersonId, personName: fromPersonName },
    to: { personId: toPersonId, personName: toPersonName },
    changedAt: at,
    changedBy: user?.uid || null,
    changedByName: user?.name || user?.email || 'Yetkili',
    note: String(payload?.note || '').trim(),
  };
}

function parseDateYmd(raw) {
  const str = String(raw || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return null;
  const [y, m, d] = str.split('-').map((x) => Number(x));
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() + 1 !== m || dt.getDate() !== d) return null;
  return { y, m, d, date: str };
}

function buildAssignQuery(body) {
  const sectionIdRaw = body?.sectionId ?? 'calisma-cizelgesi';
  const serviceIdRaw = body?.serviceId ?? '';
  const roleRaw = body?.role ?? '';

  const sectionId = String(sectionIdRaw || '').trim();
  if (!sectionId) throw new Error('sectionId gerekli');

  const serviceId = serviceIdRaw != null ? String(serviceIdRaw).trim() : '';
  const role = roleRaw != null ? String(roleRaw).trim() : '';

  const dateInfo = parseDateYmd(body?.date ?? body?.day);
  if (!dateInfo) throw new Error('date YYYY-MM-DD formatında olmalı');

  return {
    sectionId,
    serviceId,
    role,
    year: dateInfo.y,
    month: dateInfo.m,
    day: dateInfo.d,
    dateStr: dateInfo.date,
  };
}

function normalizeOperationalRole(value) {
  if (value === undefined || value === null) return '';
  return String(value)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function requireSpecificDeleteRole(req, res, next) {
  const normalized = normalizeOperationalRole(req.body?.role);
  if (['', 'all', 'all roles', 'tumu', 'tum roller'].includes(normalized)) {
    return res.status(400).json({
      ok: false,
      code: 'SPECIFIC_ROLE_REQUIRED',
      message: 'A specific role must be selected before deleting assignments.',
    });
  }
  req.body = { ...(req.body || {}), role: String(req.body.role).trim() };
  return next();
}

function requireSpecificOperationalRole(req, res, next) {
  const normalized = normalizeOperationalRole(req.body?.role);
  if (['', 'all', 'all roles', 'tumu', 'tum roller'].includes(normalized)) {
    return res.status(400).json({
      ok: false,
      code: 'SPECIFIC_ROLE_REQUIRED',
      message: 'A specific role must be selected before carrying schedule templates forward.',
    });
  }
  req.body = { ...(req.body || {}), role: String(req.body.role).trim() };
  return next();
}

function normalizeAssignPayload(body, query, userId) {
  const personId = String(body?.personId ?? body?.personID ?? '').trim();
  const shiftId = String(body?.shiftId ?? body?.shiftCode ?? body?.shift ?? '').trim();
  if (!personId) throw new Error('personId gerekli');
  if (!shiftId) throw new Error('shiftId gerekli');

  const personName = String(body?.personName ?? body?.name ?? '').trim();
  const rowId = String(body?.rowId ?? body?.slotId ?? '').trim();
  const shiftCode = String(body?.shiftCode ?? body?.shiftId ?? body?.shift ?? '').trim();
  const roleLabel = String(body?.roleLabel ?? body?.roleName ?? body?.label ?? '').trim();
  const note = String(body?.note ?? '').trim();
  const previousShiftId = String(
    body?.previousShiftId ?? body?.prevShiftId ?? body?.previousShiftCode ?? ''
  ).trim();
  const pinnedRaw = body?.pinned;
  const pinned =
    pinnedRaw === true ||
    pinnedRaw === 1 ||
    pinnedRaw === '1' ||
    String(pinnedRaw || '').toLowerCase() === 'true';

  const payload = {
    date: query.dateStr,
    personId,
    personName: personName || undefined,
    rowId: rowId || undefined,
    shiftId,
    shiftCode: shiftCode || shiftId,
    roleLabel: roleLabel || undefined,
    note: note || undefined,
    serviceId: query.serviceId || undefined,
    role: query.role || undefined,
    createdBy: userId || null,
    createdAt: new Date().toISOString(),
  };
  if (pinnedRaw !== undefined) payload.pinned = !!pinned;
  if (previousShiftId) payload.previousShiftId = previousShiftId;
  return payload;
}

function assignmentKey(a) {
  const date = String(a?.date ?? a?.day ?? '').slice(0, 10);
  const personId = String(a?.personId ?? '').trim();
  const shiftId = String(a?.shiftId ?? a?.shiftCode ?? a?.shift ?? a?.code ?? '').trim();
  return `${date}|${personId}|${shiftId}`;
}

function canonName(str = '') {
  return String(str || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleUpperCase('tr-TR')
    .replace(/\s+/g, ' ')
    .trim();
}

function canonText(str = '') {
  return String(str || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleUpperCase('tr-TR')
    .replace(/\s+/g, ' ')
    .trim();
}

function shiftMatchLoose(item, payload) {
  const shiftCandidates = [
    item?.shiftId,
    item?.shiftCode,
    item?.shift,
    item?.code,
  ]
    .map((v) => (v == null ? '' : String(v).trim()))
    .filter(Boolean);
  const targetShifts = [
    payload?.shiftId,
    payload?.shiftCode,
    payload?.shift,
  ]
    .map((v) => (v == null ? '' : String(v).trim()))
    .filter(Boolean);
  if (!targetShifts.length) return false;
  const candSet = new Set(shiftCandidates);
  for (const t of targetShifts) {
    if (candSet.has(t)) return true;
    const tNorm = t.toUpperCase();
    if ([...candSet].some((c) => c.toUpperCase() === tNorm)) return true;
  }
  return false;
}

function normalizeReplaceTarget(body, payload) {
  const hasExplicitReplacePerson =
    body?.replacePersonId != null ||
    body?.departingPersonId != null ||
    body?.fromPersonId != null ||
    body?.replacePersonName != null ||
    body?.departingPersonName != null ||
    body?.fromPersonName != null;
  const personId = String(
    body?.replacePersonId ??
    body?.departingPersonId ??
    body?.fromPersonId ??
    (!hasExplicitReplacePerson && payload?.previousShiftId ? payload?.personId : '') ??
    ''
  ).trim();
  const personName = String(
    body?.replacePersonName ??
    body?.departingPersonName ??
    body?.fromPersonName ??
    (!hasExplicitReplacePerson && payload?.previousShiftId ? payload?.personName : '') ??
    ''
  ).trim();
  const shiftId = String(
    body?.replaceShiftId ??
    body?.replaceShiftCode ??
    body?.departingShiftId ??
    body?.fromShiftId ??
    payload?.previousShiftId ??
    ''
  ).trim();

  if (!personId && !personName && !shiftId) return null;

  return {
    date: String(payload?.date || '').slice(0, 10),
    personId,
    personName,
    shiftId,
    shiftCode: shiftId,
    roleLabel: String(
      body?.replaceRoleLabel ??
      body?.departingRoleLabel ??
      body?.fromRoleLabel ??
      payload?.roleLabel ??
      ''
    ).trim(),
  };
}

function removeReplaceTarget(assignments, target) {
  if (!target?.date) return { assignments, removed: [] };

  const targetPid = String(target.personId || '').trim();
  const targetName = canonName(target.personName || '');
  const targetLabel = canonText(target.roleLabel || '');
  const next = [];
  const removed = [];

  for (const item of assignments) {
    const itemDate = String(item?.date ?? item?.day ?? '').slice(0, 10);
    if (itemDate !== target.date) {
      next.push(item);
      continue;
    }

    const hasShiftTarget = !!String(target.shiftId || target.shiftCode || '').trim();
    const shiftMatches = !hasShiftTarget || shiftMatchLoose(item, target);
    if (!shiftMatches) {
      next.push(item);
      continue;
    }

    const itemPid = String(item?.personId ?? '').trim();
    const itemName = canonName(item?.personName ?? item?.name ?? '');
    const itemLabel = canonText(item?.roleLabel ?? item?.label ?? '');
    const personMatches =
      (targetPid && itemPid && targetPid === itemPid) ||
      (targetName && itemName && targetName === itemName);
    const labelMatches = targetLabel && itemLabel && targetLabel === itemLabel;

    if (personMatches || (!targetPid && !targetName && labelMatches)) {
      removed.push(item);
    } else {
      next.push(item);
    }
  }

  return { assignments: next, removed };
}

function applyDeleteFilter(assignments, payload, assignQuery) {
  const key = assignmentKey(payload);
  let filtered = assignments.filter(
    (a) => assignmentKey(a) !== key && !matchesAssignForDelete(a, payload, assignQuery)
  );

  if (filtered.length === assignments.length) {
    // Fallback: aynı gün + kişi bazlı tek atama varsa onu sil
    const candidates = assignments.filter((a) =>
      matchesByPersonAndDay(a, payload, assignQuery)
    );
    if (candidates.length === 1) {
      const target = candidates[0];
      filtered = assignments.filter((a) => a !== target);
    } else if (candidates.length > 1) {
      // Shift/label ile daraltmayı dene
      const byShift = candidates.filter((a) => shiftMatchLoose(a, payload));
      if (byShift.length === 1) {
        const target = byShift[0];
        filtered = assignments.filter((a) => a !== target);
      } else if (payload?.roleLabel) {
        const labelTarget = canonText(payload.roleLabel);
        const byLabel = candidates.filter((a) =>
          canonText(a?.roleLabel ?? a?.label ?? '') === labelTarget
        );
        if (byLabel.length === 1) {
          const target = byLabel[0];
          filtered = assignments.filter((a) => a !== target);
        } else {
          return { filtered: assignments, removed: false };
        }
      } else {
        return { filtered: assignments, removed: false };
      }
    } else {
      return { filtered: assignments, removed: false };
    }
  }

  return { filtered, removed: filtered.length !== assignments.length };
}

function matchesAssignForDelete(item, payload, query) {
  const date = String(item?.date ?? item?.day ?? '').slice(0, 10);
  if (date !== query.dateStr) return false;

  const shiftCandidates = [
    item?.shiftId,
    item?.shiftCode,
    item?.shift,
    item?.code,
  ]
    .map((v) => (v == null ? '' : String(v).trim()))
    .filter(Boolean);
  const targetShifts = [
    payload?.shiftId,
    payload?.shiftCode,
    payload?.shift,
  ]
    .map((v) => (v == null ? '' : String(v).trim()))
    .filter(Boolean);
  if (targetShifts.length && !targetShifts.some((s) => shiftCandidates.includes(s))) {
    return false;
  }

  const pidItem = String(item?.personId ?? '').trim();
  const pidTarget = String(payload?.personId ?? '').trim();
  if (pidTarget && pidItem) return pidTarget === pidItem;

  const nameItem = canonName(item?.personName ?? item?.name ?? '');
  const nameTarget = canonName(payload?.personName ?? payload?.name ?? '');
  if (nameTarget && nameItem) return nameTarget === nameItem;

  return false;
}

function matchesByPersonAndDay(item, payload, query) {
  const date = String(item?.date ?? item?.day ?? '').slice(0, 10);
  if (date !== query.dateStr) return false;

  const pidItem = String(item?.personId ?? '').trim();
  const pidTarget = String(payload?.personId ?? '').trim();
  if (pidTarget && pidItem) return pidTarget === pidItem;

  const nameItem = canonName(item?.personName ?? item?.name ?? '');
  const nameTarget = canonName(payload?.personName ?? payload?.name ?? '');
  if (nameTarget && nameItem) return nameTarget === nameItem;

  return false;
}

function buildQuery(req, defaults = {}) {
  const src = req.method === 'GET' ? req.query : req.body;
  // Express 5: req.query getter yeni obje döndürür — kopyaya al
  const { serviceId = '', role = '' } = src;
  const sectionId = src.sectionId || defaults.sectionId || '';

  const year = parseIntSafe(src.year);
  const month = parseIntSafe(src.month);

  if (!sectionId) throw new Error('sectionId gerekli');
  if (!year || year < 2000) throw new Error('year geçersiz');
  if (!month || month < 1 || month > 12) throw new Error('month 1..12 aralığında olmalı');

  const hospitalId = req.hospitalId || null;
  if (!hospitalId) throw new Error('hospitalId eksik');

  return {
    hospitalId,
    sectionId: String(sectionId),
    serviceId: serviceId != null ? String(serviceId) : '',
    role: role != null ? String(role) : '',
    year,
    month,
  };
}

async function loadRules(req, res, next) {
  try {
    const src = req.method === 'GET' ? req.query : req.body;
    const sectionId = String(src?.sectionId || '').trim();
    const serviceId = src?.serviceId != null ? String(src.serviceId).trim() : '';
    const role = src?.role != null ? String(src.role).trim() : '';
    if (!sectionId) {
      req.scheduleRules = { enabled: false };
      return next();
    }
    const rules = await ScheduleRules.findOne({
      sectionId,
      $or: [
        { serviceId, role },
        { serviceId, role: '' },
        { serviceId: '', role: '' },
      ],
    }).lean();
    req.scheduleRules = rules || { enabled: false };
    return next();
  } catch (err) {
    req.scheduleRules = { enabled: false };
    return next();
  }
}

// Root GET — eski frontend kodları /api/schedules?year=&month= çağırıyordu, /monthly'ye yönlendir
router.get('/',
  requireAuth,
  (req, res, next) => {
    try {
      // Express 5: req.query getter yeni obje döndürür, mutasyon çalışmaz
      // Bu yüzden buildQuery'e default olarak geçiyoruz
      const query = buildQuery(req, { sectionId: 'calisma-cizelgesi' });
      req.scheduleQuery = query;
      req.targetServiceId = query.serviceId;
      next();
    } catch (err) {
      return res.status(400).json({ ok: false, message: err.message });
    }
  },
  allowMonthlyRead,
  async (req, res) => {
    try {
      const query = req.scheduleQuery;
      const doc = await MonthlySchedule.findOne(query).lean();
      if (isDraftSchedule(doc) && !canViewDrafts(req.user)) {
        return res.json({ ok: true, data: { assignments: [], issues: [] }, assignments: [], issues: [], unpublished: true });
      }
      const data = doc?.data && typeof doc.data === 'object' ? doc.data : {};
      const assignments = Array.isArray(data?.assignments) ? data.assignments : [];
      const issues =
        data?.issues ||
        data?.roster?.issues ||
        doc?.meta?.issues ||
        [];
      return res.json({ ok: true, data: { assignments, issues }, assignments, issues });
    } catch (err) {
      return res.status(500).json({ ok: false, message: err.message });
    }
  }
);

// MonthlySchedule GET is the operational monthly read model.
// It serves assignment snapshot + editable monthly schedule data for existing UI paths.
router.get('/monthly',
  requireAuth,
  (req, res, next) => {
    try {
      const query = buildQuery(req);
      req.scheduleQuery = query;
      req.targetServiceId = query.serviceId;
      next();
    } catch (err) {
      return res.status(400).json({ ok: false, message: err.message || 'Geçersiz istek' });
    }
  },
  allowMonthlyRead,
  async (req, res) => {
    try {
      const query = req.scheduleQuery;
      const doc = await MonthlySchedule.findOne(query).lean();
      if (isDraftSchedule(doc) && !canViewDrafts(req.user)) {
        // Personel taslağı göremez; çizelge hiç yokmuş gibi döner.
        return res.json({ ok: true, schedule: null, issues: [], unpublished: true });
      }
      let scheduleData = doc?.data && typeof doc.data === 'object' ? doc.data : {};

      const defs = Array.isArray(scheduleData.defs)
        ? scheduleData.defs
        : Array.isArray(scheduleData.rows)
        ? scheduleData.rows
        : [];
      const selectedAssignments = chooseMonthlyResponseAssignments({
        year: query.year,
        month: query.month,
        defs,
        scheduleData,
      });
      if (selectedAssignments.source === 'namedAssignments') {
        scheduleData = { ...scheduleData, assignments: selectedAssignments.assignments };
      }

      if (doc && Array.isArray(scheduleData.assignments)) {
        // Keep light response shaping here for legacy monthly consumers.
        // Repair/persistence is intentionally not performed inside GET.
        const holidays = await listHolidays({ year: query.year, month: query.month, hospitalId: req.hospitalId });
        const holidayKindByDate = buildHolidayKindByDateMap(holidays);
        const sanitized = sanitizeSupervisorAssignments(
          scheduleData.assignments,
          defs,
          holidayKindByDate
        );
        if (sanitized.changed) {
          scheduleData = { ...scheduleData, assignments: sanitized.assignments };
        }

        const overbookTrim = trimOverbookedAssignments({
          assignments: scheduleData.assignments || [],
          defs,
          overrides:
            scheduleData?.overrides && typeof scheduleData.overrides === 'object'
              ? scheduleData.overrides
              : {},
        });
        if (overbookTrim.changed) {
          scheduleData = { ...scheduleData, assignments: overbookTrim.assignments };
        }
      }

      const issues =
        scheduleData?.issues
        || scheduleData?.roster?.issues
        || doc?.meta?.issues
        || [];
      return res.json({
        ok: true,
        schedule: doc ? {
          id: String(doc._id),
          ...query,
          data: scheduleData,
          meta: doc.meta || {},
          publication: doc.publication || { status: PUBLICATION_STATUS.PUBLISHED, legacy: true },
          ruleContext: doc.ruleContext || null,
          revision: currentRevisionOf(doc),
          hasUnpublishedChanges: require('../services/schedulePublicationService').hasUnpublishedChanges(doc),
          updatedByName: doc.updatedByName || null,
          rules: ruleStatusOf(doc, await resolveRulesForQuery(query).catch(() => null)),
          issues,
          createdAt: doc.createdAt,
          updatedAt: doc.updatedAt,
          createdBy: doc.createdBy || null,
          updatedBy: doc.updatedBy || null,
        } : null,
        issues: Array.isArray(issues) ? issues : [],
      });
    } catch (err) {
      console.error('[GET /api/schedules/monthly] ERR:', err);
      return res.status(500).json({ ok: false, message: 'Sunucu hatası' });
    }
  }
);

router.post('/monthly/carry-forward-template',
  requireAuth,
  requireRole('admin', 'staff', 'authorized'),
  requireSpecificServiceScope,
  requireSpecificOperationalRole,
  (req, res, next) => {
    try {
      const query = buildQuery(req);
      req.scheduleQuery = query;
      req.targetServiceId = query.serviceId;
      next();
    } catch (err) {
      if (err?.code === 'SPECIFIC_SERVICE_REQUIRED') {
        return res.status(400).json(specificServiceErrorPayload(err));
      }
      return res.status(400).json({ ok: false, message: err.message || 'Geçersiz istek' });
    }
  },
  sameServiceOrAdmin,
  async (req, res) => {
    try {
      const result = await carryForwardMonthlyTemplate({
        ...req.scheduleQuery,
        hospitalId: req.hospitalId,
        userId: req.user?.uid || null,
      });
      return res.json({ ok: true, ...result });
    } catch (err) {
      if (err?.code === 'PREVIOUS_TEMPLATE_NOT_FOUND') {
        return res.status(404).json({
          ok: false,
          code: err.code,
          message: err.message,
        });
      }
      console.error('[POST /api/schedules/monthly/carry-forward-template] ERR:', err);
      return res.status(500).json({ ok: false, message: safeMessage(err) });
    }
  }
);


/* ─── Eş zamanlı düzenleme (İP-3 / C) ─── */
function currentRevisionOf(doc) {
  return Number(doc?.revision || 0);
}
// Eski kayıtta revision alanı yok: "yok" ile 0 aynı sayılır.
function revisionFilter(doc) {
  return doc && doc.revision !== undefined && doc.revision !== null
    ? { revision: doc.revision }
    : { $or: [{ revision: { $exists: false } }, { revision: null }, { revision: 0 }] };
}
function revisionConflictPayload(doc) {
  return {
    ok: false,
    code: 'SCHEDULE_REVISION_CONFLICT',
    message: `Bu çizelge siz düzenlerken ${doc?.updatedByName || 'başka bir kullanıcı'} tarafından değiştirildi${doc?.updatedAt ? ` (${new Date(doc.updatedAt).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })})` : ''}. Değişiklikleriniz kaydedilmedi ve ekranda korunuyor.`,
    currentRevision: currentRevisionOf(doc),
    updatedAt: doc?.updatedAt || null,
    updatedBy: doc?.updatedBy || null,
    updatedByName: doc?.updatedByName || null,
  };
}
function monthlyResponse(doc, query) {
  return {
    id: String(doc._id),
    ...query,
    data: doc.data || {},
    meta: doc.meta || {},
    revision: currentRevisionOf(doc),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    createdBy: doc.createdBy || null,
    updatedBy: doc.updatedBy || null,
    updatedByName: doc.updatedByName || null,
  };
}


// Çizelge tablosundan (isim) gelen atamalarda personId olmayabilir; kaydederken kaybolmasın.
// Önce mevcut kayıttaki aynı isimli atamalardan, sonra hastanedeki benzersiz isimli personelden.
async function restorePersonIds(assignments = [], existing = [], hospitalId = null) {
  const norm = (v) => String(v || '').trim().toLocaleUpperCase('tr-TR');
  const missing = assignments.filter((a) => a && !a.personId && a.personName);
  if (!missing.length) return { assignments, restored: 0 };
  const byName = new Map();
  for (const a of existing || []) if (a?.personId && a?.personName) byName.set(norm(a.personName), String(a.personId));
  const unresolved = [...new Set(missing.map((a) => norm(a.personName)).filter((n) => !byName.has(n)))];
  if (unresolved.length) {
    const Person = require('../models/Person');
    const people = await Person.find({ ...(hospitalId ? { hospitalId } : {}) }).select('name').lean();
    const counts = new Map();
    for (const p of people) counts.set(norm(p.name), (counts.get(norm(p.name)) || 0) + 1);
    for (const p of people) if (counts.get(norm(p.name)) === 1 && unresolved.includes(norm(p.name))) byName.set(norm(p.name), String(p._id));
  }
  let restored = 0;
  const out = assignments.map((a) => {
    if (!a || a.personId || !a.personName) return a;
    const id = byName.get(norm(a.personName));
    if (!id) return a;
    restored += 1;
    return { ...a, personId: id };
  });
  return { assignments: out, restored };
}

async function upsertMonthly(req, res) {
  try {
    const query = req.scheduleQuery;
    let payload = req.body?.data || {};
    const meta = req.body?.meta || {};
    const existingDoc = await MonthlySchedule.findOne(query).lean();

    // Tekrarlanan istek (aynı opId): ikinci kez yazma; aynı sonucu döndür.
    const opId = typeof req.body?.opId === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(req.body.opId) ? req.body.opId : null;
    const { fingerprint, KEY_REUSED } = require('../utils/idempotency');
    const opHash = opId ? fingerprint({ data: req.body?.data || {}, meta: req.body?.meta || {} }) : null;
    if (opId && existingDoc?.lastOpId === opId) {
      // Aynı işlem kimliği farklı içerikle: eski sonucu döndürmek yanıltıcı olur → 409.
      if (existingDoc.lastOpHash && existingDoc.lastOpHash !== opHash) {
        return res.status(409).json({ ok: false, ...KEY_REUSED });
      }
      return res.json({ ok: true, replayed: true, schedule: monthlyResponse(existingDoc, query) });
    }
    // Eş zamanlı düzenleme: istemci üzerine çalıştığı revizyonu bildirir (baseRevision).
    const baseRevision = req.body?.baseRevision;
    if (baseRevision !== undefined && baseRevision !== null && Number(baseRevision) !== currentRevisionOf(existingDoc)) {
      return res.status(409).json(revisionConflictPayload(existingDoc));
    }

    // Kural sürümü kontrolü: istemci planı hangi kural sürümüyle düzenlediğini bildirirse
    // ve bu sürüm artık güncel değilse kaydetme 409 ile durur (sessizce eski kurala göre
    // kayıt yok). Sürüm bildirmeyen eski istemciler geri uyum için kabul edilir.
    const declaredRuleVersion = req.body?.ruleVersion;
    if (typeof declaredRuleVersion === 'string' && declaredRuleVersion) {
      const resolved = await resolveRulesForQuery(query);
      if (resolved.version !== declaredRuleVersion) {
        const status = ruleStatusOf({ ruleContext: { version: declaredRuleVersion } }, resolved);
        return res.status(409).json(ruleConflictPayload(
          'RULE_VERSION_CONFLICT',
          status,
          'Kurum kuralları siz düzenlerken değişti. Değişiklikleriniz kaydedilmedi; "Güncel kurallarla doğrula" ile planı yeni kurallara göre kontrol edip tekrar kaydedin.'
        ));
      }
    }
    const existingData = existingDoc?.data && typeof existingDoc.data === 'object' ? existingDoc.data : {};

    if (payload && typeof payload === 'object') {
      if (
        !Object.prototype.hasOwnProperty.call(payload, 'assignments') &&
        Array.isArray(existingData.assignments)
      ) {
        payload = { ...payload, assignments: existingData.assignments };
      }
      if (
        !Object.prototype.hasOwnProperty.call(payload, 'roster') &&
        existingData.roster &&
        typeof existingData.roster === 'object'
      ) {
        payload = { ...payload, roster: existingData.roster };
      }
    }

    if (payload && typeof payload === 'object' && Array.isArray(payload.assignments)) {
      const { assignments: withIds } = await restorePersonIds(payload.assignments, existingData.assignments, req.hospitalId || null);
      payload = { ...payload, assignments: withIds };
      const holidays = await listHolidays({ year: query.year, month: query.month, hospitalId: req.hospitalId });
      const holidayKindByDate = buildHolidayKindByDateMap(holidays);
      const defs = Array.isArray(payload.defs)
        ? payload.defs
        : Array.isArray(payload.rows)
        ? payload.rows
        : [];
      const sanitized = sanitizeSupervisorAssignments(
        payload.assignments,
        defs,
        holidayKindByDate
      );
      if (sanitized.changed) {
        payload = { ...payload, assignments: sanitized.assignments };
      }

      const overbookTrim = trimOverbookedAssignments({
        assignments: payload.assignments || [],
        defs,
        overrides:
          payload?.overrides && typeof payload.overrides === 'object'
            ? payload.overrides
            : {},
      });
      if (overbookTrim.changed) {
        payload = { ...payload, assignments: overbookTrim.assignments };
      }
    }

    const update = {
      data: payload,
      meta,
      updatedBy: req.user?.uid || null,
      updatedByName: req.user?.name || null,
      ...(opId ? { lastOpId: opId, lastOpHash: opHash } : {}),
    };

    // Atomik karşılaştır-ve-güncelle: yalnız okunan revizyon hâlâ geçerliyse yazar.
    const casFilter = existingDoc
      ? { ...query, _id: existingDoc._id, ...revisionFilter(existingDoc) }
      : query;
    const doc = await MonthlySchedule.findOneAndUpdate(
      casFilter,
      {
        $set: update,
        $inc: { revision: 1 },
        $setOnInsert: {
          ...query,
          publication: draftPublication(req.user, 'created'),
          createdBy: req.user?.uid || null,
        },
      },
      { new: true, upsert: !existingDoc, setDefaultsOnInsert: true }
    ).lean();
    if (!doc) {
      const latest = await MonthlySchedule.findOne(query).lean();
      return res.status(409).json(revisionConflictPayload(latest));
    }
    await scheduleChanges.recordChange({
      scope: query, scheduleId: doc._id, kind: 'edit', source: 'monthly-save',
      before: existingDoc?.data?.assignments || [], after: doc?.data?.assignments || [],
      contentRevision: currentRevisionOf(doc), user: req.user,
    });

    try {
      await replaceAssignmentsForSchedule({
        scope: {
          ...query,
          sourceScheduleId: doc?._id || null,
        },
        payload: doc?.data || payload || {},
        createdBy: doc?.createdBy || req.user?.uid || null,
        updatedBy: req.user?.uid || null,
        source: 'monthlySchedule',
      });
    } catch (syncErr) {
      console.error('[assignmentSync][upsertMonthly] ERR:', syncErr);
    }

    return res.json({ ok: true, schedule: monthlyResponse(doc, query) });
  } catch (err) {
    console.error('[PUT/POST /api/schedules/monthly] ERR:', err);
    if (err?.message?.includes('duplicate key')) {
      // Aynı anda iki ilk kayıt: ikincisi revizyon çakışması olarak bildirilir.
      const latest = await MonthlySchedule.findOne(req.scheduleQuery).lean().catch(() => null);
      return res.status(409).json(revisionConflictPayload(latest));
    }
    if (err.name === 'ValidationError' || err.name === 'CastError') {
      return res.status(400).json({ ok: false, message: err.message });
    }
    return res.status(500).json({ ok: false, message: 'Sunucu hatası' });
  }
}

router.put('/monthly',
  requireAuth,
  requireSpecificServiceScope,
  (req, res, next) => {
    try {
      const query = buildQuery(req);
      req.scheduleQuery = query;
      req.targetServiceId = query.serviceId;
      next();
    } catch (err) {
      if (err?.code === 'SPECIFIC_SERVICE_REQUIRED') {
        return res.status(400).json(specificServiceErrorPayload(err));
      }
      return res.status(400).json({ ok: false, message: err.message || 'Geçersiz istek' });
    }
  },
  sameServiceOrAdmin,
  upsertMonthly
);

// Backward-compat: eski clientlar /api/schedules POST çağırıyor olabilir
router.post('/',
  requireAuth,
  requireSpecificServiceScope,
  (req, res, next) => {
    try {
      const query = buildQuery(req);
      req.scheduleQuery = query;
      req.targetServiceId = query.serviceId;
      next();
    } catch (err) {
      if (err?.code === 'SPECIFIC_SERVICE_REQUIRED') {
        return res.status(400).json(specificServiceErrorPayload(err));
      }
      return res.status(400).json({ ok: false, message: err.message || 'Geçersiz istek' });
    }
  },
  sameServiceOrAdmin,
  upsertMonthly
);

router.post('/assign',
  requireAuth,
  requireSpecificServiceScope,
  validate(assignShiftSchema),
  (req, res, next) => {
    try {
      const query = buildAssignQuery(req.body || {});
      req.assignQuery = query;
      req.assignPayload = normalizeAssignPayload(req.body || {}, query, req.user?.uid || null);
      req.targetServiceId = query.serviceId;
      next();
    } catch (err) {
      if (err?.code === 'SPECIFIC_SERVICE_REQUIRED') {
        return res.status(400).json(specificServiceErrorPayload(err));
      }
      return res.status(400).json({ ok: false, message: err.message || 'Geçersiz istek' });
    }
  },
  sameServiceOrAdmin,
  loadRules,
  async (req, res) => {
    try {
      const query = {
        hospitalId: req.hospitalId,
        sectionId: req.assignQuery.sectionId,
        serviceId: req.assignQuery.serviceId,
        role: req.assignQuery.role,
        year: req.assignQuery.year,
        month: req.assignQuery.month,
      };
      if (!query.hospitalId) {
        return res.status(400).json({ ok: false, message: 'hospitalId eksik' });
      }

      const doc = await MonthlySchedule.findOne(query).lean();
      const data = doc?.data && typeof doc.data === 'object' ? doc.data : {};
      let assignments = Array.isArray(data.assignments) ? [...data.assignments] : [];

      const defs = Array.isArray(data.defs)
        ? data.defs
        : Array.isArray(data.rows)
        ? data.rows
        : [];
      const namedAssignments = data?.roster?.namedAssignments || data?.namedAssignments || null;
      if (
        namedAssignments &&
        typeof namedAssignments === 'object' &&
        countNamedAssignments(namedAssignments) > assignments.length
      ) {
        assignments = buildAssignmentsFromNamed({
          year: query.year,
          month: query.month,
          defs,
          namedAssignments,
        });
      }
      const beforeSnapshot = captureMonthlyScheduleSnapshot(doc || { data }, {
        assignments,
        rosterNamedAssignments:
          data?.roster?.namedAssignments !== undefined ? data.roster.namedAssignments : null,
        changeLog: Array.isArray(data.changeLog) ? data.changeLog : [],
      });
      const overrides =
        data?.overrides && typeof data.overrides === 'object'
          ? data.overrides
          : {};
      const supervisorRowIds = buildSupervisorRowIdSet(defs);
      const holidays = await listHolidays({ year: query.year, month: query.month, hospitalId: req.hospitalId });
      const holidayKindByDate = buildHolidayKindByDateMap(holidays);

      let payload = { ...req.assignPayload };
      const payloadLabel = String(payload?.roleLabel || payload?.label || '').trim();
      const payloadShiftId = String(payload?.shiftId || payload?.shiftCode || '').trim();
      const previousShiftId = String(payload?.previousShiftId || '').trim();
      const isSupervisor =
        payload?.supervisorTask === true ||
        supervisorRowIds.has(payloadShiftId) ||
        supervisorRowIds.has(previousShiftId) ||
        isServiceSupervisorLabel(payloadLabel);
      if (isSupervisor) {
        payload = {
          ...payload,
          supervisorTask: true,
          roleLabel: payloadLabel || SERVICE_SUPERVISOR_LABEL,
        };
        const dateStr = String(payload?.date || '').slice(0, 10);
        const kind = String(holidayKindByDate?.[dateStr] || '').toLowerCase();
        const dt = new Date(`${dateStr}T00:00:00`);
        const weekday = Number.isNaN(dt.getTime()) ? NaN : dt.getDay();
        if (weekday === 0 || weekday === 6 || kind === 'full') {
          return res.status(400).json({
            ok: false,
            message: 'Servis sorumlusu hafta sonu ve resmi tatilde atanamaz',
          });
        }
        if (kind === 'arife' || kind === 'half') {
          payload = {
            ...payload,
            shiftCode: 'A',
            shiftId: 'A',
            hours: HALF_DAY_A_HOURS,
          };
        }
      }

      let nextAssignments = [...assignments];
      const replaceTarget = normalizeReplaceTarget(req.body || {}, payload);
      const replaceRemoval = removeReplaceTarget(nextAssignments, replaceTarget);
      nextAssignments = replaceRemoval.assignments;
      const replacedAssignment = Array.isArray(replaceRemoval.removed) && replaceRemoval.removed.length
        ? replaceRemoval.removed[0]
        : null;
      let changeLogEntry = null;
      if (replacedAssignment) {
        const changedAt = new Date().toISOString();
        payload = {
          ...payload,
          source: 'quickReplace',
          changeType: 'quickReplace',
          changedAt,
          changedBy: req.user?.uid || null,
          changedFromPersonId: replacedAssignment.personId || null,
          changedFromPersonName: replacedAssignment.personName || replacedAssignment.name || null,
        };
        changeLogEntry = buildChangeLogEntry({
          type: 'quickReplace',
          payload,
          removedItem: replacedAssignment,
          user: req.user,
          at: changedAt,
        });
      }

      const key = assignmentKey(payload);
      // Edit senaryosunda aynı kaydı kendisiyle kıyaslayıp yalancı kural ihlali üretmemek için
      // validasyon sırasında mevcut kaydı geçici olarak hariç tut.
      const validationBase = nextAssignments.filter((a) => assignmentKey(a) !== key);
      const validation = validateAssignment(req.scheduleRules, payload, validationBase);
      if (!validation.valid) {
        if (!req.body?.force) {
          return res.status(409).json({
            ok: false,
            message: 'Nöbet yazma kuralı ihlali',
            errors: validation.errors,
            canForce: validation.canForce,
            conflictType: 'RULE_VIOLATION',
          });
        }
        // force:true — admin rule override; log for audit trail
        console.warn('[assign] force override kural ihlali:', validation.errors, { personId: payload.personId, date: payload.date });
      }

      // Kurum kuralları (motor ve risk paneliyle aynı denetçi): bu atamanın YENİ doğurduğu ihlaller.
      // force:true ile yönetici devam edebilir; ihlal risk panelinde kalır ve yayın öncesi karar ister.
      if (payload.personId && doc) {
        try {
          const pid = String(payload.personId);
          const keysOf = (r) => new Set((r?.risks || []).filter((x) => x.type === 'KURAL' && String(x.personId) === pid).map((x) => x.key));
          const before = await loadScheduleRisks(query, { assignmentsOverride: nextAssignments });
          const after = await loadScheduleRisks(query, { assignmentsOverride: [...validationBase, payload] });
          const was = keysOf(before);
          const fresh = (after?.risks || []).filter((x) => x.type === 'KURAL' && String(x.personId) === pid && !was.has(x.key));
          if (fresh.length && !req.body?.force) {
            return res.status(409).json({
              ok: false,
              message: 'Kurum kuralı ihlali',
              errors: fresh.map((x) => x.message),
              rules: fresh.map((x) => x.rule),
              canForce: true,
              conflictType: 'INSTITUTION_RULE_VIOLATION',
            });
          }
          if (fresh.length) console.warn('[assign] force ile kurum kuralı ihlali:', fresh.map((x) => x.rule), { personId: pid, date: payload.date });
        } catch (ruleErr) {
          console.warn('[assign] kurum kuralı kontrolü yapılamadı:', ruleErr?.message);
        }
      }

      // Aynı gün çakışma — bu kişi başka bir vardiyaya zaten atanmış mı?
      if (!req.body?.force && payload.personId) {
        const dayConflicts = await checkSameDayConflict({
          personId: payload.personId,
          personName: payload.personName,
          date: payload.date,
          excludeShiftId: previousShiftId || null,
        });
        if (dayConflicts.length > 0) {
          return res.status(409).json({
            ok: false,
            message: 'Bu kişi bu tarihte başka bir vardiyaya zaten atanmış',
            conflictType: 'SHIFT_CONFLICT',
            conflicts: dayConflicts,
          });
        }

        // İzin çakışması — kişi bu gün izinli mi?
        const leaveConflict = await checkLeaveConflict({
          personId: payload.personId,
          date: payload.date,
          serviceId: req.assignQuery.serviceId || '',
        });
        if (leaveConflict) {
          return res.status(409).json({
            ok: false,
            message: `Bu kişi ${leaveConflict.date} tarihinde izinli (${leaveConflict.code}). Zorla atamak için force:true gönderin.`,
            conflictType: 'LEAVE_CONFLICT',
            leave: leaveConflict,
          });
        }
      }

      const idx = nextAssignments.findIndex((a) => assignmentKey(a) === key);
      const existingAssignment = idx === -1 ? null : (nextAssignments[idx] || null);
      const undoOperationType = replacedAssignment
        ? 'QUICK_REPLACE'
        : existingAssignment
        ? 'MANUAL_ASSIGNMENT_EDIT'
        : 'MANUAL_ASSIGNMENT_ADD';
      const slotCapacity = getShiftCapacityForDate({
        defs,
        overrides,
        dateStr: req.assignQuery?.dateStr || String(payload?.date || '').slice(0, 10),
        shiftLike: payload,
      });
      if (idx === -1 && Number.isFinite(slotCapacity)) {
        // Kapasite satır (def) bazlı çözülür; kullanım da aynı satırla sınırlanmalı.
        // Aksi halde aynı vardiya kodunu (ör. N) paylaşan farklı satırlar birbirini
        // "dolu" gösterir. Def çözülemezse eski (loose) davranışa güvenli şekilde düşülür.
        const targetDef = findDefForAssignment(payload, defs);
        const targetDefId = String(targetDef?.id || targetDef?.rowId || '').trim();
        const slotUsage = nextAssignments.filter((a) => {
          const aDate = String(a?.date || a?.day || '').slice(0, 10);
          if (aDate !== req.assignQuery?.dateStr) return false;
          if (!shiftMatchLoose(a, payload)) return false;
          if (!targetDefId) return true;
          const aDef = findDefForAssignment(a, defs);
          const aDefId = String(aDef?.id || aDef?.rowId || '').trim();
          if (!aDefId) return true;
          return aDefId === targetDefId;
        }).length;
        if (slotUsage >= Math.max(0, Number(slotCapacity))) {
          return res.status(409).json({
            ok: false,
            message: 'Bu satır dolu. Önce mevcut kişiyi kaldırıp tekrar deneyin.',
            errors: [{ type: 'SHIFT_CAPACITY', capacity: Number(slotCapacity), used: slotUsage }],
          });
        }
      }
      if (idx === -1) {
        nextAssignments.push(payload);
      } else {
        const existing = nextAssignments[idx] || {};
        const merged = { ...existing, ...payload };
        if (payload.pinned === undefined && existing.pinned !== undefined) {
          merged.pinned = existing.pinned;
        }
        nextAssignments[idx] = merged;
      }

      const overbookTrim = trimOverbookedAssignments({ assignments: nextAssignments, defs, overrides });
      if (overbookTrim.changed) {
        nextAssignments = overbookTrim.assignments;
      }

      const nextData = {
        ...data,
        assignments: nextAssignments,
        roster: syncRosterNamedAssignments(data, nextAssignments, defs, query.year, query.month),
        changeLog: appendScheduleChangeLog(data.changeLog, changeLogEntry),
      };

      const update = {
        $set: {
          data: nextData,
          updatedBy: req.user?.uid || null,
          updatedByName: req.user?.name || null,
        },
        $inc: { revision: 1 },
        $setOnInsert: {
          ...query,
          publication: draftPublication(req.user, 'created'),
          createdBy: req.user?.uid || null,
        },
      };

      const saved = await MonthlySchedule.findOneAndUpdate(
        query,
        update,
        { new: true, upsert: true, setDefaultsOnInsert: true }
      ).lean();
      await scheduleChanges.recordChange({
        scope: query, scheduleId: saved?._id || null, kind: 'edit', source: 'assign',
        before: assignments, after: saved?.data?.assignments || [],
        contentRevision: currentRevisionOf(saved), user: req.user,
      });

      let projectionSyncOk = true;
      try {
        await replaceAssignmentsForSchedule({
          scope: {
            ...query,
            sourceScheduleId: saved?._id || null,
          },
          createdBy: existingAssignment?.createdBy || req.user?.uid || null,
          updatedBy: req.user?.uid || null,
          payload: saved?.data || nextData,
          source: 'monthlySchedule',
        });
      } catch (syncErr) {
        projectionSyncOk = false;
        console.error('[assignmentSync][assign] ERR:', syncErr);
      }

      if (projectionSyncOk) {
        await recordScheduleUndoOperation({
          scope: query,
          operationType: undoOperationType,
          payload,
          beforeSnapshot,
          afterSnapshot: captureMonthlyScheduleSnapshot(saved || { data: nextData }),
          scheduleId: saved?._id || null,
          user: req.user,
        });
      }

      const outAssignments = Array.isArray(saved?.data?.assignments)
        ? saved.data.assignments
        : nextAssignments;

      const changedByName = req.user?.name || req.user?.email || 'Yetkili';
      const previousShift =
        String(payload?.previousShiftId || existingAssignment?.shiftCode || existingAssignment?.shiftId || '').trim() || '-';
      const newShift = String(payload?.shiftCode || payload?.shiftId || '').trim() || '-';
      // Taslak çizelgede personele değişiklik bildirimi gitmez; yayınlanınca toplu bildirim gider.
      if (!isDraftSchedule(saved)) void sendShiftChanged({
        personId: payload?.personId,
        personName: payload?.personName || existingAssignment?.personName || '',
        date: payload?.date || req.assignQuery?.dateStr,
        previousShift,
        newShift,
        roleLabel: payload?.roleLabel || existingAssignment?.roleLabel || '',
        note: payload?.note || '',
        changedByName,
        action: 'updated',
      }).catch((notifyErr) => {
        console.error('[notify][shift-updated] ERR:', notifyErr?.message || notifyErr);
      });

      return res.json({
        ok: true,
        assignments: outAssignments,
        scheduleId: saved?._id ? String(saved._id) : null,
        updatedAt: saved?.updatedAt || null,
      });
    } catch (err) {
      console.error('[POST /api/schedules/assign] ERR:', err);
      return res.status(500).json({ ok: false, message: 'Sunucu hatası' });
    }
  }
);

router.delete('/assign',
  requireAuth,
  requireSpecificServiceScope,
  requireSpecificDeleteRole,
  (req, res, next) => {
    try {
      const query = buildAssignQuery(req.body || {});
      req.assignQuery = query;
      req.assignPayload = normalizeAssignPayload(req.body || {}, query, req.user?.uid || null);
      req.targetServiceId = query.serviceId;
      next();
    } catch (err) {
      if (err?.code === 'SPECIFIC_SERVICE_REQUIRED') {
        return res.status(400).json(specificServiceErrorPayload(err));
      }
      return res.status(400).json({ ok: false, message: err.message || 'Geçersiz istek' });
    }
  },
  sameServiceOrAdmin,
  async (req, res) => {
    try {
      const exactQuery = Object.freeze({
        hospitalId: req.hospitalId,
        sectionId: req.assignQuery.sectionId,
        serviceId: req.assignQuery.serviceId,
        role: req.assignQuery.role,
        year: req.assignQuery.year,
        month: req.assignQuery.month,
      });
      if (!exactQuery.hospitalId) {
        return res.status(400).json({ ok: false, message: 'hospitalId eksik' });
      }

      const doc = await MonthlySchedule.findOne(exactQuery).lean();
      if (!doc) {
        return res.status(404).json({
          ok: false,
          code: 'SCHEDULE_NOT_FOUND_IN_SCOPE',
          message: 'No schedule was found in the requested scope.',
        });
      }

      const attemptRemove = async (targetDoc, targetQuery) => {
        const data = targetDoc?.data && typeof targetDoc.data === 'object' ? targetDoc.data : {};
        let assignments = Array.isArray(data.assignments) ? [...data.assignments] : [];
        const defs = Array.isArray(data.defs)
          ? data.defs
          : Array.isArray(data.rows)
          ? data.rows
          : [];
        const namedAssignments = data?.roster?.namedAssignments || data?.namedAssignments || null;
        const scheduleYear = Number(targetDoc?.year || req.assignQuery.year);
        const scheduleMonth = Number(targetDoc?.month || req.assignQuery.month);
        if (
          namedAssignments &&
          typeof namedAssignments === 'object' &&
          countNamedAssignments(namedAssignments) > assignments.length
        ) {
          assignments = buildAssignmentsFromNamed({
            year: scheduleYear,
            month: scheduleMonth,
            defs,
            namedAssignments,
          });
        }
        const beforeSnapshot = captureMonthlyScheduleSnapshot(targetDoc || { data }, {
          assignments,
          rosterNamedAssignments:
            data?.roster?.namedAssignments !== undefined ? data.roster.namedAssignments : null,
          changeLog: Array.isArray(data.changeLog) ? data.changeLog : [],
        });
        const { filtered, removed } = applyDeleteFilter(assignments, req.assignPayload, req.assignQuery);
        if (!removed) return { removed: false };
        const removedAssignment = assignments.find((item) => !filtered.includes(item)) || null;
        const changedAt = new Date().toISOString();
        const removeChangeEntry = buildChangeLogEntry({
          type: 'manualRemove',
          payload: {
            ...(removedAssignment || req.assignPayload),
            date: req.assignQuery?.dateStr || removedAssignment?.date || req.assignPayload?.date,
          },
          removedItem: removedAssignment || req.assignPayload,
          user: req.user,
          at: changedAt,
        });
        removeChangeEntry.to = { personId: '', personName: '' };
        const nextData = {
          ...data,
          assignments: filtered,
          roster: syncRosterNamedAssignments(data, filtered, defs, scheduleYear, scheduleMonth),
          changeLog: appendScheduleChangeLog(data.changeLog, removeChangeEntry),
        };

        const saved = await MonthlySchedule.findOneAndUpdate(
          targetQuery,
          {
            $set: {
              data: nextData,
              updatedBy: req.user?.uid || null,
              updatedByName: req.user?.name || null,
            },
            $inc: { revision: 1 },
          },
          { new: true }
        ).lean();
        await scheduleChanges.recordChange({
          scope: targetQuery, scheduleId: saved?._id || null, kind: 'edit', source: 'unassign',
          before: doc?.data?.assignments || [], after: saved?.data?.assignments || [],
          contentRevision: currentRevisionOf(saved), user: req.user,
        });

        return {
          removed: true,
          assignments: Array.isArray(saved?.data?.assignments) ? saved.data.assignments : filtered,
          updatedAt: saved?.updatedAt || null,
          removedAssignment,
          beforeSnapshot,
          afterSnapshot: captureMonthlyScheduleSnapshot(saved || { data: nextData }),
          scheduleId: saved?._id || targetDoc?._id || null,
          isDraft: isDraftSchedule(saved || targetDoc),
        };
      };

      const result = await attemptRemove(doc, exactQuery);
      if (!result.removed) {
        return res.status(404).json({
          ok: false,
          code: 'ASSIGNMENT_NOT_FOUND_IN_SCOPE',
          message: 'No matching assignment was found in the requested schedule scope.',
        });
      }

      const removedItem = result.removedAssignment || null;
      let projectionSyncOk = true;
      try {
        await removeAssignment({
          scope: {
            ...exactQuery,
            sourceScheduleId: doc?._id || null,
          },
          assignment: removedItem || req.assignPayload,
        });
      } catch (syncErr) {
        projectionSyncOk = false;
        console.error('[assignmentSync][unassign-primary] ERR:', syncErr);
      }
      if (projectionSyncOk) {
        await recordScheduleUndoOperation({
          scope: exactQuery,
          operationType: 'MANUAL_ASSIGNMENT_DELETE',
          payload: removedItem || req.assignPayload,
          beforeSnapshot: result.beforeSnapshot,
          afterSnapshot: result.afterSnapshot,
          scheduleId: result.scheduleId || doc?._id || null,
          user: req.user,
        });
      }
      const {
        removedAssignment: _ignoredRemovedAssignment,
        beforeSnapshot: _ignoredBeforeSnapshot,
        afterSnapshot: _ignoredAfterSnapshot,
        scheduleId: _ignoredScheduleId,
        isDraft: removedFromDraft,
        ...responsePayload
      } = result;
      const changedByName = req.user?.name || req.user?.email || 'Yetkili';
      // Taslak çizelgede personele değişiklik bildirimi gitmez.
      if (!removedFromDraft) void sendShiftChanged({
        personId: req.assignPayload?.personId || removedItem?.personId,
        personName: req.assignPayload?.personName || removedItem?.personName || '',
        date: req.assignQuery?.dateStr,
        previousShift: removedItem?.shiftCode || removedItem?.shiftId || req.assignPayload?.shiftCode || req.assignPayload?.shiftId || '-',
        newShift: '-',
        roleLabel: removedItem?.roleLabel || req.assignPayload?.roleLabel || '',
        note: req.assignPayload?.note || removedItem?.note || '',
        changedByName,
        action: 'removed',
      }).catch((notifyErr) => {
        console.error('[notify][shift-removed] ERR:', notifyErr?.message || notifyErr);
      });
      return res.json({ ok: true, removed: true, ...responsePayload });
    } catch (err) {
      console.error('[DELETE /api/schedules/assign] ERR:', err);
      return res.status(500).json({ ok: false, message: 'Sunucu hatası' });
    }
  }
);

// Kuralları getir
router.get('/rules',
  requireAuth,
  (req, res, next) => {
    req.targetServiceId = req.query?.serviceId || '';
    next();
  },
  sameServiceOrAdmin,
  async (req, res) => {
    try {
      const { sectionId, serviceId = '', role = '' } = req.query || {};
      if (!sectionId) {
        return res.status(400).json({ ok: false, message: 'sectionId gerekli' });
      }
      const rules = await ScheduleRules.findOne({
        sectionId,
        serviceId: String(serviceId || ''),
        role: String(role || ''),
      }).lean();
      return res.json({ ok: true, rules: rules || null });
    } catch (err) {
      return res.status(500).json({ ok: false, message: safeMessage(err) });
    }
  }
);

// Kuralları güncelle (ADMIN)
router.put('/rules',
  requireAuth,
  requireRole('admin'),
  async (req, res) => {
    try {
      const { sectionId, serviceId = '', role = '' } = req.body || {};
      if (!sectionId) {
        return res.status(400).json({ ok: false, message: 'sectionId gerekli' });
      }

      // Sadece şema'da tanımlı alanları kabul et — mass assignment önlemi
      const ALLOWED = ['enabled','maxShiftsPerPerson','minRestDaysBetween',
        'maxConsecutiveShifts','restrictedDays','allowedHours','notes'];
      const ruleData = {};
      for (const key of ALLOWED) {
        if (Object.prototype.hasOwnProperty.call(req.body, key)) {
          ruleData[key] = req.body[key];
        }
      }

      const update = {
        sectionId,
        serviceId: String(serviceId || ''),
        role: String(role || ''),
        ...ruleData,
        updatedAt: new Date(),
        updatedBy: req.user?.uid || null,
        createdBy: req.user?.uid || null,
      };
      const rules = await ScheduleRules.findOneAndUpdate(
        { sectionId, serviceId: String(serviceId || ''), role: String(role || '') },
        { $set: update },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      ).lean();
      return res.json({ ok: true, rules });
    } catch (err) {
      return res.status(500).json({ ok: false, message: safeMessage(err) });
    }
  }
);

// Kuralları etkinleştir/devre dışı bırak (ADMIN)
router.patch('/rules/toggle',
  requireAuth,
  requireRole('admin'),
  async (req, res) => {
    try {
      const { sectionId, serviceId = '', role = '', enabled } = req.body || {};
      if (!sectionId) {
        return res.status(400).json({ ok: false, message: 'sectionId gerekli' });
      }
      const rules = await ScheduleRules.findOneAndUpdate(
        { sectionId, serviceId: String(serviceId || ''), role: String(role || '') },
        { $set: { enabled: !!enabled, updatedAt: new Date() } },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      ).lean();
      return res.json({
        ok: true,
        rules,
        message: enabled ? 'Kurallar etkinleştirildi' : 'Kurallar devre dışı bırakıldı',
      });
    } catch (err) {
      return res.status(500).json({ ok: false, message: safeMessage(err) });
    }
  }
);

// Hybrid comparison kaydı (hafif uyumluluk endpoint'i)
router.post('/comparison',
  requireAuth,
  async (req, res) => {
    try {
      const {
        sectionId = 'calisma-cizelgesi',
        serviceId = '',
        year,
        month,
        userDecision = '',
      } = req.body || {};
      return res.json({
        ok: true,
        comparison: {
          sectionId: String(sectionId),
          serviceId: String(serviceId || ''),
          year: Number(year) || null,
          month: Number(month) || null,
          userDecision: String(userDecision || ''),
          savedAt: new Date().toISOString(),
        },
      });
    } catch (err) {
      return res.status(500).json({ ok: false, message: safeMessage(err) });
    }
  }
);

function escapeIcal(str = '') {
  return String(str || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// RFC 5545 §3.1 — 75 oktet'ten uzun satırları CRLF + boşluk ile kat
function foldIcalLine(line) {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const parts = [];
  let offset = 0;
  while (offset < bytes.length) {
    const limit = parts.length === 0 ? 75 : 74;
    parts.push(bytes.slice(offset, offset + limit).toString('utf8'));
    offset += limit;
  }
  return parts.join('\r\n ');
}

/* ─── GET /api/schedules/export/ical ───────────────────────────
   iCal (.ics) dışa aktarma — personId veya serviceId bazlı.
   Query: year, month, personId?, serviceId?
   ─────────────────────────────────────────────────────────────── */
router.get('/export/ical', requireAuth, requireRole('admin', 'authorized'), async (req, res) => {
  try {
    const year  = Number(req.query.year  || new Date().getFullYear());
    const month = Number(req.query.month || new Date().getMonth() + 1);
    const { personId, serviceId } = req.query;

    if (!req.hospitalId) return res.status(400).json({ ok: false, message: 'hospitalId eksik' });
    const q = { year, month, hospitalId: req.hospitalId };
    if (serviceId) q.serviceId = serviceId;
    const docs = await MonthlySchedule.find(q).lean();

    let assignments = docs.flatMap((d) => d?.data?.assignments || []);
    if (personId) {
      assignments = assignments.filter((a) =>
        String(a?.personId || '') === String(personId) ||
        String(a?.personName || '').toLowerCase() === String(personId).toLowerCase()
      );
    }

    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Hastane Nöbet Sistemi//TR',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:Nöbet Çizelgesi',
      'X-WR-TIMEZONE:Europe/Istanbul',
    ];

    for (const a of assignments) {
      const dateStr = String(a?.date || '').replace(/-/g, '');
      if (!dateStr || dateStr.length < 8) continue;

      // All-day event: DTEND is next day
      const d = new Date(`${a.date}T00:00:00`);
      d.setDate(d.getDate() + 1);
      const endStr = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;

      const uid = `${dateStr}-${String(a?.shiftId||'').replace(/[^A-Z0-9]/g,'')||'S'}-${String(a?.personId||'').slice(-6)||'X'}@hastane.nobet`;
      const summary = `${escapeIcal(a?.shiftId || 'Nöbet')} — ${escapeIcal(a?.personName || 'Çalışan')}`;
      const desc = `Vardiya: ${escapeIcal(a?.shiftId || '—')} | Kişi: ${escapeIcal(a?.personName || '—')} | Saat: ${escapeIcal(String(a?.hours || '—'))}s`;

      lines.push(
        'BEGIN:VEVENT',
        `DTSTART;VALUE=DATE:${dateStr}`,
        `DTEND;VALUE=DATE:${endStr}`,
        `SUMMARY:${summary}`,
        `DESCRIPTION:${desc}`,
        `UID:${uid}`,
        'END:VEVENT'
      );
    }

    lines.push('END:VCALENDAR');
    const icsContent = lines.map(foldIcalLine).join('\r\n') + '\r\n';

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="nobetler-${year}-${String(month).padStart(2,'0')}.ics"`);
    return res.send(icsContent);
  } catch (err) {
    return res.status(500).json({ ok: false, message: safeMessage(err, 'iCal oluşturma hatası') });
  }
});

/* ─── GET /api/schedules/export/excel ──────────────────────────
   Excel (.xlsx) dışa aktarma.
   Query: year, month, serviceId?
   ─────────────────────────────────────────────────────────────── */
router.get('/export/excel', requireAuth, requireRole('admin', 'authorized'), async (req, res) => {
  try {
    const year  = Number(req.query.year  || new Date().getFullYear());
    const month = Number(req.query.month || new Date().getMonth() + 1);
    const { serviceId } = req.query;

    if (!req.hospitalId) return res.status(400).json({ ok: false, message: 'hospitalId eksik' });
    const q = { year, month, hospitalId: req.hospitalId };
    if (serviceId) q.serviceId = serviceId;
    const docs = await MonthlySchedule.find(q).lean();
    const assignments = docs.flatMap((d) => d?.data?.assignments || []);

    const TR_MONTHS = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
    const monthLabel = `${TR_MONTHS[month-1]} ${year}`;

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Hastane Nöbet Sistemi';
    const ws = wb.addWorksheet(monthLabel);

    // Başlık satırı
    ws.columns = [
      { header: 'Tarih', key: 'date', width: 14 },
      { header: 'Gün',   key: 'weekday', width: 10 },
      { header: 'Vardiya', key: 'shiftId', width: 14 },
      { header: 'Kişi', key: 'personName', width: 28 },
      { header: 'Saat', key: 'hours', width: 8 },
    ];

    // Header style
    ws.getRow(1).eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF6366F1' } };
      cell.alignment = { horizontal: 'center' };
    });

    // Rows
    const TR_DAYS = ['Pazar','Pazartesi','Salı','Çarşamba','Perşembe','Cuma','Cumartesi'];
    assignments
      .sort((a, b) => (a.date || '') < (b.date || '') ? -1 : 1)
      .forEach((a, i) => {
        const d = new Date((a.date || '') + 'T00:00:00');
        ws.addRow({
          date: a.date || '—',
          weekday: isNaN(d.getTime()) ? '—' : TR_DAYS[d.getDay()],
          shiftId: a.shiftId || a.shiftCode || '—',
          personName: a.personName || '—',
          hours: a.hours || '—',
        });
        // Zebra striping
        if (i % 2 === 1) {
          ws.getRow(i + 2).eachCell((cell) => {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8F9FF' } };
          });
        }
      });

    // Auto filter
    ws.autoFilter = { from: 'A1', to: 'E1' };

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="nobetler-${year}-${String(month).padStart(2,'0')}.xlsx"`);
    await wb.xlsx.write(res);
    return res.end();
  } catch (err) {
    return res.status(500).json({ ok: false, message: safeMessage(err, 'Excel oluşturma hatası') });
  }
});

/* =========================================================
   GET /api/schedules/export/excel-ik
   Kurumsal İK Formatı — personel başına tek satır özet Excel
   Kolonlar: Ad Soyad | Servis | Toplam Nöbet | Toplam Saat | İzin (türe göre) | Toplam İzin
========================================================= */
router.get('/export/excel-ik', requireAuth, requireRole('admin', 'authorized'), async (req, res) => {
  try {
    const year  = Number(req.query.year  || new Date().getFullYear());
    const month = Number(req.query.month || new Date().getMonth() + 1);
    const hid   = req.hospitalId;
    if (!hid) return res.status(400).json({ ok: false, message: 'hospitalId eksik' });

    const mongoose = require('mongoose');
    const Setting  = require('../models/Setting');

    // ── 1. Atamaları personel bazında topla ───────────────────────────────
    const mongoose_oid = (id) => { try { return new mongoose.Types.ObjectId(String(id)); } catch { return null; } };
    const hoid = mongoose_oid(hid);
    const assignAgg = hoid
      ? await Assignment.aggregate([
          { $match: { hospitalId: hoid, year, month, status: 'active' } },
          { $group: {
              _id: '$personId',
              personName:  { $first: '$personName' },
              serviceId:   { $first: '$serviceId' },
              totalShifts: { $sum: 1 },
              totalHours:  { $sum: { $ifNull: ['$hours', 0] } },
          }},
          { $sort: { personName: 1 } },
        ])
      : [];

    // ── 2. İzinleri personel bazında topla (leavesV2 Setting) ─────────────
    const pad2 = (n) => String(n).padStart(2, '0');
    const ym   = `${year}-${pad2(month)}`;
    const leaveDoc = await Setting.findOne({ hospitalId: hid, key: 'leavesV2', serviceId: '' }).lean();
    const allLeaves = leaveDoc?.value && typeof leaveDoc.value === 'object' ? leaveDoc.value : {};

    // personId → { total: N, byCode: { Y:2, R:1 ... } }
    const leaveMap = {};
    for (const [pid, byMonth] of Object.entries(allLeaves)) {
      const monthData = byMonth?.[ym];
      if (!monthData || typeof monthData !== 'object') continue;
      const byCode = {};
      for (const entry of Object.values(monthData)) {
        const code = typeof entry === 'string' ? entry : entry?.code;
        if (!code) continue;
        byCode[code] = (byCode[code] || 0) + 1;
      }
      leaveMap[pid] = { total: Object.values(byCode).reduce((a, b) => a + b, 0), byCode };
    }

    // ── 3. Tüm benzersiz izin kodlarını bul (kolon başlıkları için) ───────
    const allLeaveCodes = [...new Set(
      Object.values(leaveMap).flatMap((l) => Object.keys(l.byCode))
    )].sort();

    // ── 4. Excel yaz ──────────────────────────────────────────────────────
    const TR_MONTHS = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran',
                       'Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
    const monthLabel = `${TR_MONTHS[month - 1]} ${year}`;

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Hastane Nöbet Sistemi';
    const ws = wb.addWorksheet(`İK — ${monthLabel}`);

    // Standart aylık saat (haftalık 40s × ortalama 4.33 hafta ≈ 173; veya sabit 160)
    const standardMonthlyHours = Number(req.query.standardHours) || 160;

    // Sabit kolonlar
    const cols = [
      { header: 'Ad Soyad',          key: 'personName',    width: 28 },
      { header: 'Servis',             key: 'serviceId',     width: 18 },
      { header: 'Toplam Nöbet',       key: 'shifts',        width: 14 },
      { header: 'Toplam Saat',        key: 'hours',         width: 14 },
      { header: 'Fazla Mesai Saati',  key: 'overtimeHours', width: 18 },
      ...allLeaveCodes.map((c) => ({ header: `İzin (${c})`, key: `lv_${c}`, width: 12 })),
      { header: 'Toplam İzin',        key: 'totalLeave',    width: 14 },
    ];
    ws.columns = cols;

    // Başlık stili
    ws.getRow(1).eachCell((cell) => {
      cell.font  = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4ED8' } };
      cell.alignment = { horizontal: 'center' };
    });

    // Satırları yaz — ataması olanlar
    const added = new Set();
    assignAgg.forEach((a, i) => {
      const lv = leaveMap[String(a._id)] || { total: 0, byCode: {} };
      const row = {
        personName:    a.personName || '—',
        serviceId:     a.serviceId  || '—',
        shifts:        a.totalShifts,
        hours:         a.totalHours,
        overtimeHours: Math.max(0, (a.totalHours || 0) - standardMonthlyHours),
        totalLeave:    lv.total,
        ...Object.fromEntries(allLeaveCodes.map((c) => [`lv_${c}`, lv.byCode[c] || 0])),
      };
      ws.addRow(row);
      if (i % 2 === 1) {
        ws.getRow(i + 2).eachCell((cell) => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F5FF' } };
        });
      }
      added.add(String(a._id));
    });

    // İzni olan ama ataması olmayanlar (sıfır nöbet)
    let extraIdx = assignAgg.length;
    for (const [pid, lv] of Object.entries(leaveMap)) {
      if (added.has(pid)) continue;
      const row = {
        personName:    pid,
        serviceId:     '—',
        shifts:        0,
        hours:         0,
        overtimeHours: 0,
        totalLeave:    lv.total,
        ...Object.fromEntries(allLeaveCodes.map((c) => [`lv_${c}`, lv.byCode[c] || 0])),
      };
      ws.addRow(row);
      if (extraIdx % 2 === 1) {
        ws.getRow(extraIdx + 2).eachCell((cell) => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F5FF' } };
        });
      }
      extraIdx++;
    }

    ws.autoFilter = { from: 'A1', to: ws.getColumn(cols.length).letter + '1' };

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition',
      `attachment; filename="ik-rapor-${year}-${pad2(month)}.xlsx"`);
    await wb.xlsx.write(res);
    return res.end();
  } catch (err) {
    return res.status(500).json({ ok: false, message: safeMessage(err, 'İK Excel oluşturma hatası') });
  }
});

/* =========================================================
   GET /api/schedules/assignments
   Assignment koleksiyonundan aylık atama listesi döner.
   Tüm ekranlar için SSOT okuma ucu. scheduleRowsV2/generatedRosterFlat
   localStorage kaynaklarının yerini alır.
========================================================= */
/* =========================================================
   POST /api/schedules/validate-batch
   Pre-save validation for bulk schedule payloads (DutyRowsEditor).
   Body: { sectionId, serviceId?, role?, year, month, assignments: [...] }
   Returns: { ok, violations: [{ personId?, personName, date, errors: string[] }], canForce }
========================================================= */
router.post('/validate-batch',
  requireAuth,
  async (req, res) => {
    try {
      const { sectionId, serviceId, role, year, month, assignments } = req.body || {};
      if (!sectionId || !year || !month || !Array.isArray(assignments)) {
        return res.status(400).json({ ok: false, message: 'sectionId, year, month, assignments zorunlu' });
      }

      const rulesDoc = await ScheduleRules.findOne({
        sectionId: String(sectionId).trim(),
        ...(serviceId != null ? { serviceId: String(serviceId).trim() } : {}),
      }).lean();
      const rules = rulesDoc || {};

      if (!rules.enabled) {
        return res.json({ ok: true, violations: [], canForce: false });
      }

      const violations = [];
      for (const assg of assignments) {
        if (!assg || typeof assg !== 'object') continue;
        const existing = assignments.filter(
          (a) => a !== assg && (String(a?.personId || '') === String(assg.personId || '') || String(a?.personName || '') === String(assg.personName || ''))
        );
        const result = validateAssignment(rules, assg, existing);
        if (!result.valid) {
          violations.push({
            personId: assg.personId || '',
            personName: assg.personName || '',
            date: assg.date || assg.day || '',
            errors: result.errors,
          });
        }
      }

      return res.json({
        ok: true,
        violations,
        canForce: violations.length > 0,
        violationCount: violations.length,
      });
    } catch (err) {
      return res.status(500).json({ ok: false, message: safeMessage(err, 'Hata') });
    }
  }
);

router.get('/assignments',
  requireAuth,
  async (req, res) => {
    try {
      const { sectionId, serviceId, role, year, month } = req.query;
      if (!sectionId || !year || !month) {
        return res.status(400).json({ ok: false, message: 'sectionId, year, month zorunlu' });
      }
      const callerRole = String(req.user?.role || '').toLowerCase();
      const isPrivileged = ['admin', 'superadmin', 'authorized', 'staff'].includes(callerRole);
      if (!isPrivileged) {
        // role=user can only see their own assignments
        const personId = req.user?.personId ? String(req.user.personId) : null;
        if (!personId) return res.json({ ok: true, assignments: [], count: 0 });
        const baseQuery = {
          personId,
          sectionId: String(sectionId).trim(),
          year: Number(year),
          month: Number(month),
        };
        if (req.hospitalId) baseQuery.hospitalId = req.hospitalId;
        const draftScopes = await findDraftScopes({
          hospitalId: req.hospitalId, year, month, sectionId: baseQuery.sectionId,
        });
        const assignments = await Assignment.find(excludeDraftScopes(baseQuery, draftScopes)).lean();
        return res.json({ ok: true, assignments, count: assignments.length });
      }
      const query = {
        sectionId: String(sectionId).trim(),
        serviceId: serviceId != null ? String(serviceId).trim() : '',
        year: Number(year),
        month: Number(month),
      };
      if (role != null && String(role).trim()) query.role = String(role).trim();
      if (req.hospitalId) query.hospitalId = req.hospitalId;
      const assignments = await Assignment.find(query).lean();
      return res.json({ ok: true, assignments, count: assignments.length });
    } catch (err) {
      return res.status(500).json({ ok: false, message: safeMessage(err, 'Hata') });
    }
  }
);

/* =========================================================
   GET /api/schedules/person-calendar
   Read-model: all assignments for a single person in a month.
   Query: personId (required), sectionId, year, month, serviceId?, role?
========================================================= */
router.get('/person-calendar',
  requireAuth,
  async (req, res) => {
    try {
      const { personId, sectionId, year, month, serviceId, role } = req.query;
      if (!personId || !year || !month) {
        return res.status(400).json({ ok: false, message: 'personId, year, month zorunlu' });
      }
      const callerRole = String(req.user?.role || '').toLowerCase();
      const isPrivileged = ['admin', 'superadmin', 'authorized', 'staff'].includes(callerRole);
      if (!isPrivileged) {
        const ownPersonId = req.user?.personId ? String(req.user.personId) : null;
        if (!ownPersonId || ownPersonId !== String(personId).trim()) {
          return res.status(403).json({ ok: false, message: 'Yalnızca kendi takvimini görebilirsin' });
        }
      }
      const query = {
        personId: String(personId).trim(),
        year: Number(year),
        month: Number(month),
      };
      if (sectionId) query.sectionId = String(sectionId).trim();
      if (serviceId != null && String(serviceId).trim()) query.serviceId = String(serviceId).trim();
      if (role != null && String(role).trim()) query.role = String(role).trim();
      if (req.hospitalId) query.hospitalId = req.hospitalId;

      let finalQuery = query;
      if (!canViewDrafts(req.user)) {
        const draftScopes = await findDraftScopes({
          hospitalId: req.hospitalId, year, month, sectionId: query.sectionId || null,
        });
        finalQuery = excludeDraftScopes(query, draftScopes);
      }

      const assignments = await Assignment.find(finalQuery)
        .sort({ date: 1 })
        .lean();

      const calendar = assignments.map((a) => ({
        id: String(a._id),
        date: String(a.date || '').slice(0, 10),
        shiftCode: a.shiftCode || '',
        shiftId: a.shiftId || a.shiftCode || '',
        roleLabel: a.roleLabel || '',
        hours: a.hours || 0,
        pinned: !!a.pinned,
        note: a.note || '',
        overrideReason: a.overrideReason || '',
        sectionId: a.sectionId || '',
        serviceId: a.serviceId || '',
        role: a.role || '',
      }));

      return res.json({ ok: true, personId: String(personId).trim(), year: Number(year), month: Number(month), assignments: calendar, count: calendar.length });
    } catch (err) {
      return res.status(500).json({ ok: false, message: safeMessage(err, 'Hata') });
    }
  }
);

/* =========================================================
   POST /api/schedules/publish-notify
   Çizelge yayınlama bildirimi: her personele kendi adillik skoruyla
   profesyonel bir SSE + DB bildirimi gönderir.
   Body: { sectionId, year, month, serviceId? }
========================================================= */
router.post('/publish-notify',
  requireAuth,
  requireRole('admin', 'authorized'),
  async (req, res) => {
    try {
      const { year, month, serviceId } = req.body || {};
      if (!year || !month) return res.status(400).json({ ok: false, message: 'year ve month zorunlu' });

      const { computeMonthlyFairnessScores } = require('../services/fairnessEngine');
      const { sendSchedulePublished } = require('../services/notificationService');

      const result = await computeMonthlyFairnessScores({
        hospitalId: req.hospitalId,
        year:  Number(year),
        month: Number(month),
      });

      void sendSchedulePublished({
        hospitalId: req.hospitalId,
        year:   Number(year),
        month:  Number(month),
        people: result.people,
      });

      return res.json({
        ok: true,
        message: `${result.people.length} personele nöbet çizelgesi bildirimi gönderildi`,
        groupStats: result.groupStats,
      });
    } catch (err) {
      return res.status(500).json({ ok: false, message: safeMessage(err, 'Bildirim gönderilemedi') });
    }
  }
);

/* =========================================================
   POST /api/schedules/publish   — taslağı yayınla (personel görür + bildirim)
   POST /api/schedules/unpublish — yayını geri al (taslağa döner)
   Body: { sectionId, serviceId, role, year, month }
========================================================= */
function publicationScope(req, res, next) {
  try {
    const query = buildQuery(req);
    req.scheduleQuery = query;
    req.targetServiceId = query.serviceId;
    return next();
  } catch (err) {
    return res.status(400).json({ ok: false, message: err.message || 'Geçersiz istek' });
  }
}

async function notifyScheduleAudience(query) {
  const { computeMonthlyFairnessScores } = require('../services/fairnessEngine');
  const { sendSchedulePublished } = require('../services/notificationService');
  const personIds = new Set(
    (await Assignment.distinct('personId', {
      hospitalId: query.hospitalId,
      sectionId: query.sectionId,
      serviceId: query.serviceId,
      role: query.role,
      year: query.year,
      month: query.month,
    })).map(String)
  );
  const result = await computeMonthlyFairnessScores({
    hospitalId: query.hospitalId,
    year: query.year,
    month: query.month,
  });
  const people = (result.people || []).filter((p) => personIds.has(String(p.personId)));
  await sendSchedulePublished({ hospitalId: query.hospitalId, year: query.year, month: query.month, people });
  return people.length;
}


/* ─── Kurum kuralı sürümü (plan ↔ yetkili kural kaydı) ─── */
async function resolveRulesForQuery(query) {
  return institutionRules.resolveInstitutionRules({
    hospitalId: query.hospitalId || null,
    sectionId: query.sectionId,
    serviceId: query.serviceId,
    role: query.role,
  });
}

// unknown: planda sürüm kaydı yok (eski plan) · current: güncel · outdated: kurallar sonradan değişti
function ruleStatusOf(doc, resolved) {
  const planVersion = doc?.ruleContext?.version || null;
  const currentVersion = resolved?.version || null;
  let status = 'unknown';
  if (planVersion) status = planVersion === currentVersion ? 'current' : 'outdated';
  return {
    status,
    planVersion,
    currentVersion,
    planCapturedAt: doc?.ruleContext?.capturedAt || null,
    planMode: doc?.ruleContext?.mode || null,
    rulesConfigured: !!resolved?.configured,
    rulesComplete: !!resolved?.complete,
    missingRequired: resolved?.missingRequired || [],
  };
}

function ruleConflictPayload(code, ruleStatus, message) {
  return { ok: false, code, message, rules: ruleStatus };
}

/* ─── Yayın öncesi riskler (scheduleRiskService) ─── */
async function loadScheduleRisks(query, { assignmentsOverride = null } = {}) {
  const { buildSchedulerInput } = require('../services/scheduler/inputBuilder');
  const { applyHolidayPolicies } = require('../services/scheduler/holidayPolicyAdapter');
  const { resolveStaff } = require('../services/scheduler/staffResolver');
  const { loadPreferencesFromDb } = require('../services/preferenceRequestService');
  const { computeScheduleRisks } = require('../services/scheduleRiskService');

  const doc = await MonthlySchedule.findOne(query).lean();
  if (!doc) return null;
  const holidays = await listHolidays({ year: query.year, month: query.month, hospitalId: query.hospitalId });
  const input = buildSchedulerInput({ scheduleDoc: doc, payload: {}, year: query.year, month: query.month, hospitalId: query.hospitalId, holidays });
  const days = applyHolidayPolicies({
    days: input.days || [],
    holidayKindByDate: input.holidayKindByDate,
    shiftMetaByCode: input.shiftMetaByCode,
  });
  const { staff = [] } = await resolveStaff({ serviceId: query.serviceId, role: query.role, hospitalId: query.hospitalId });
  const personIds = staff.map((p) => String(p?._id || p?.id || ''));
  const { buildLeavesByPersonFromDb } = require('../services/schedulerService');
  const [preferencesByPerson, ruleInfo, leavesByPerson] = await Promise.all([
    loadPreferencesFromDb({ hospitalId: query.hospitalId, personIds, year: query.year, month: query.month }).catch(() => ({})),
    // Kural limitleri yetkili kaynaktan (kurum kuralları); tanımsızsa boş + durum bilgisi.
    resolveRulesForQuery(query).catch(() => null),
    // Onaylı izin günleri — motorla aynı kaynak (leavesV2); elle yazılan izin günü nöbeti yakalanır.
    buildLeavesByPersonFromDb({ serviceId: query.serviceId, year: query.year, month: query.month, hospitalId: query.hospitalId }).catch(() => ({})),
  ]);
  const assignments = Array.isArray(assignmentsOverride) ? assignmentsOverride
    : Array.isArray(doc?.data?.assignments) ? doc.data.assignments : [];
  const limits = ruleInfo ? institutionRules.toSchedulerRules(ruleInfo) : {};
  // Aylar arası (İP-2): planlamayla aynı geriye bakış ve aynı veri kaynağı.
  const monthBoundary = require('../services/scheduler/monthBoundary');
  const lookback = monthBoundary.computeLookbackDays({ rules: limits, shiftMetaByCode: input.shiftMetaByCode, year: query.year, month: query.month });
  const boundary = await monthBoundary.loadPriorAssignments({
    hospitalId: query.hospitalId, sectionId: query.sectionId, serviceId: query.serviceId, role: query.role,
    year: query.year, month: query.month, staff: staff.map((p) => ({ ...p, id: String(p?._id || p?.id || '') })),
    lookbackDays: lookback.days, shiftMetaByCode: input.shiftMetaByCode,
  }).catch(() => ({ assignments: [], status: 'missing', message: 'Önceki dönem görevleri okunamadı; ay başı kontrolü sınırlı.', lookbackDays: lookback.days }));
  const boundarySummary = {
    status: boundary.status, message: boundary.message, lookbackDays: boundary.lookbackDays,
    from: boundary.from || null, to: boundary.to || null, priorCount: (boundary.assignments || []).length,
  };
  const context = { assignments, days, staff, preferencesByPerson, limits, resolvedRules: ruleInfo, priorAssignments: boundary.assignments || [], boundary: boundarySummary, leavesByPerson };
  return {
    doc,
    context,
    ...computeScheduleRisks({ ...context, acks: doc.riskAcks || {} }),
    boundary: boundarySummary,
  };
}

// Boş slot için uygun adaylar ("Yerine ata"). Query: kapsam + date + rowId
router.get('/slot-candidates',
  requireAuth,
  publicationScope,
  allowMonthlyRead,
  async (req, res) => {
    try {
      if (!canViewDrafts(req.user)) return res.status(403).json({ ok: false, message: 'Yetki yok' });
      const date = String(req.query?.date || '').slice(0, 10);
      const rowId = String(req.query?.rowId || '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !rowId) {
        return res.status(400).json({ ok: false, message: 'date (YYYY-MM-DD) ve rowId zorunlu' });
      }
      const { rankSlotCandidates } = require('../services/scheduleRiskService');
      const result = await loadScheduleRisks(req.scheduleQuery);
      if (!result) return res.status(404).json({ ok: false, code: 'SCHEDULE_NOT_FOUND_IN_SCOPE', message: 'Bu kapsamda çizelge bulunamadı.' });
      const ranked = rankSlotCandidates({ ...result.context, date, rowId });
      if (!ranked.slot) return res.status(404).json({ ok: false, message: 'Bu gün için böyle bir görev yok' });
      return res.json({ ok: true, ...ranked });
    } catch (err) {
      console.error('[GET /api/schedules/slot-candidates] ERR:', err);
      return res.status(500).json({ ok: false, message: 'Sunucu hatası' });
    }
  }
);

router.get('/risks',
  requireAuth,
  publicationScope,
  allowMonthlyRead,
  async (req, res) => {
    try {
      if (!canViewDrafts(req.user)) return res.status(403).json({ ok: false, message: 'Yetki yok' });
      const result = await loadScheduleRisks(req.scheduleQuery);
      if (!result) return res.json({ ok: true, risks: [], total: 0, pending: 0 });
      const { doc, context, ...payload } = result; // iç veri (atamalar, personel) yanıta girmez
      return res.json({ ok: true, ...payload });
    } catch (err) {
      console.error('[GET /api/schedules/risks] ERR:', err);
      return res.status(500).json({ ok: false, message: 'Sunucu hatası' });
    }
  }
);

// Yönetici "Bu şekilde devam" kararı. Body: { ...kapsam, keys: [riskKey], note? }
router.post('/risks/ack',
  requireAuth,
  requireRole('admin', 'authorized', 'manager'),
  publicationScope,
  sameServiceOrAdmin,
  async (req, res) => {
    try {
      const keys = (Array.isArray(req.body?.keys) ? req.body.keys : [])
        .map((k) => String(k || '').trim())
        .filter((k) => k && k.length <= 300)
        .slice(0, 500);
      if (!keys.length) return res.status(400).json({ ok: false, message: 'keys zorunlu' });
      const note = String(req.body?.note || '').slice(0, 300);
      const ack = { by: req.user?.uid || null, byName: req.user?.name || req.user?.email || '', at: new Date(), note };
      const $set = { updatedBy: req.user?.uid || null };
      // Nokta içeren anahtarlar Mongo yolunu bozmasın diye "riskAcks.<key>" yerine tüm nesneyi birleştir.
      const doc = await MonthlySchedule.findOne(req.scheduleQuery).select('_id riskAcks').lean();
      if (!doc) return res.status(404).json({ ok: false, code: 'SCHEDULE_NOT_FOUND_IN_SCOPE', message: 'Bu kapsamda çizelge bulunamadı.' });
      const riskAcks = { ...(doc.riskAcks || {}) };
      for (const k of keys) riskAcks[k] = ack;
      $set.riskAcks = riskAcks;
      await MonthlySchedule.updateOne({ _id: doc._id }, { $set });
      return res.json({ ok: true, acknowledged: keys.length });
    } catch (err) {
      console.error('[POST /api/schedules/risks/ack] ERR:', err);
      return res.status(500).json({ ok: false, message: 'Sunucu hatası' });
    }
  }
);

// Güncel kurum kurallarıyla yeniden doğrula: riskleri güncel kurallarla hesaplar ve planın
// kural sürümünü günceller. Kural ihlali varsa risk paneline düşer (yayın kararı yöneticide).
router.post('/monthly/revalidate',
  requireAuth,
  requireRole('admin', 'authorized', 'manager'),
  publicationScope,
  sameServiceOrAdmin,
  async (req, res) => {
    try {
      const query = req.scheduleQuery;
      const resolved = await resolveRulesForQuery(query);
      if (!resolved.complete) {
        const err = new institutionRules.RulesNotReadyError(resolved);
        return res.status(422).json({ ok: false, code: err.code, message: err.message, missingRequired: err.missingRequired });
      }
      const riskResult = await loadScheduleRisks(query);
      if (!riskResult) {
        return res.status(404).json({ ok: false, code: 'SCHEDULE_NOT_FOUND_IN_SCOPE', message: 'Bu kapsamda çizelge bulunamadı.' });
      }
      const ruleContext = institutionRules.buildRuleSnapshot(resolved, { by: req.user?.uid || null, mode: 'revalidated' });
      await MonthlySchedule.updateOne({ _id: riskResult.doc._id }, { $set: { ruleContext } });
      const ruleViolations = (riskResult.risks || []).filter((r) => r.type === 'KURAL');
      return res.json({
        ok: true,
        ruleContext,
        rules: ruleStatusOf({ ruleContext }, resolved),
        risks: riskResult.risks,
        total: riskResult.total,
        pending: riskResult.pending,
        ruleViolations: ruleViolations.length,
        boundary: riskResult.boundary,
      });
    } catch (err) {
      console.error('[POST /api/schedules/monthly/revalidate] ERR:', err);
      return res.status(500).json({ ok: false, message: 'Sunucu hatası' });
    }
  }
);

router.post('/publish',
  requireAuth,
  requireRole('admin', 'authorized', 'manager'),
  publicationScope,
  sameServiceOrAdmin,
  async (req, res) => {
    try {
      const query = req.scheduleQuery;
      const riskResult = await loadScheduleRisks(query);
      if (!riskResult) {
        return res.status(404).json({ ok: false, code: 'SCHEDULE_NOT_FOUND_IN_SCOPE', message: 'Bu kapsamda çizelge bulunamadı.' });
      }
      // Yayın yalnızca GÜNCEL kurum kurallarıyla üretilmiş/doğrulanmış plan için.
      const resolvedRules = riskResult.context?.resolvedRules || await resolveRulesForQuery(query);
      const ruleStatus = ruleStatusOf(riskResult.doc, resolvedRules);
      if (!resolvedRules?.complete) {
        return res.status(422).json(ruleConflictPayload(
          resolvedRules?.configured ? 'RULES_INCOMPLETE' : 'RULES_NOT_CONFIGURED',
          ruleStatus,
          new institutionRules.RulesNotReadyError(resolvedRules).message
        ));
      }
      if (ruleStatus.status !== 'current') {
        return res.status(409).json(ruleConflictPayload(
          ruleStatus.status === 'unknown' ? 'RULE_VERSION_UNKNOWN' : 'RULE_VERSION_CONFLICT',
          ruleStatus,
          ruleStatus.status === 'unknown'
            ? 'Bu planın hangi kurallarla oluşturulduğu bilinmiyor. Yayından önce "Güncel kurallarla doğrula" ile kontrol edin.'
            : 'Plan oluşturulduktan sonra kurum kuralları değişti. Yayından önce "Güncel kurallarla doğrula" ile kontrol edin.'
        ));
      }
      // Karara bağlanmamış risk varken yayın yok (hastane kararı 2026-11-16).
      if (riskResult.pending > 0) {
        return res.status(409).json({
          ok: false,
          code: 'RISKS_PENDING',
          message: `${riskResult.pending} risk yönetici kararı bekliyor. Her biri için "Yerine ata" ya da "Bu şekilde devam" seçin.`,
          pending: riskResult.pending,
          risks: riskResult.risks.filter((r) => !r.acknowledged).slice(0, 50),
        });
      }
      const current = riskResult.doc;
      const contentRevision = currentRevisionOf(current);
      // Tekrarlanan yayın: içerik son yayından beri değişmediyse yeniden yayın / bildirim yok.
      if (current?.publication?.status === PUBLICATION_STATUS.PUBLISHED
        && current?.publication?.contentRevision === contentRevision) {
        return res.json({ ok: true, alreadyPublished: true, publication: current.publication, notified: 0 });
      }

      // Yayın sürümü ve önceki yayına göre fark (revizyon ise yalnız etkilenenlere bildirim).
      const prep = await scheduleChanges.preparePublish(query, current?.data?.assignments || []);
      // Yayın kaydı önce yazılır ve "hak" yerine geçer: aynı sürüm için tekil dizin ikinci eş zamanlı
      // isteği durdurur → ikinci istek yayın durumu, geçmiş ve bildirim üretmez.
      try {
        await scheduleChanges.recordChange({
          scope: query, scheduleId: current?._id || null, kind: 'publish', source: 'publish',
          contentRevision, publishVersion: prep.version, snapshot: prep.snapshot, user: req.user,
          added: prep.isRevision ? prep.added : [], removed: prep.isRevision ? prep.removed : [],
          note: prep.isRevision ? `Sürüm ${prep.previousVersion} → ${prep.version}: ${prep.added.length} eklendi, ${prep.removed.length} çıkarıldı` : 'İlk yayın',
          throwOnDuplicate: true,
        });
      } catch (dupErr) {
        if (dupErr?.code !== 11000) throw dupErr;
        const now = await MonthlySchedule.findOne(query).lean();
        return res.json({ ok: true, alreadyPublished: true, concurrent: true, publication: now?.publication || null, notified: 0, version: prep.version });
      }
      const saved = await setPublicationStatus(query, PUBLICATION_STATUS.PUBLISHED, req.user, {
        contentRevision,
        version: prep.version,
      });

      let notified = 0;
      try {
        if (prep.isRevision) {
          const { sendScheduleRevised } = require('../services/notificationService');
          notified = await sendScheduleRevised({
            hospitalId: query.hospitalId, year: query.year, month: query.month,
            scopeKey: [query.sectionId, query.serviceId, query.role].map((x) => String(x || '')).join('|'),
            version: prep.version, added: prep.added, removed: prep.removed,
          });
        } else {
          notified = await notifyScheduleAudience(query);
        }
      } catch (notifyErr) {
        console.error('[POST /api/schedules/publish] bildirim ERR:', notifyErr?.message || notifyErr);
      }

      return res.json({
        ok: true,
        publication: saved?.publication || null,
        notified,
        version: prep.version,
        revision: prep.isRevision ? { previousVersion: prep.previousVersion, added: prep.added.length, removed: prep.removed.length, affected: prep.affectedPersonIds.length } : null,
      });
    } catch (err) {
      console.error('[POST /api/schedules/publish] ERR:', err);
      return res.status(500).json({ ok: false, message: 'Sunucu hatası' });
    }
  }
);

router.post('/unpublish',
  requireAuth,
  requireRole('admin', 'authorized', 'manager'),
  publicationScope,
  sameServiceOrAdmin,
  async (req, res) => {
    try {
      const saved = await setPublicationStatus(req.scheduleQuery, PUBLICATION_STATUS.DRAFT, req.user);
      if (!saved) {
        return res.status(404).json({ ok: false, code: 'SCHEDULE_NOT_FOUND_IN_SCOPE', message: 'Bu kapsamda çizelge bulunamadı.' });
      }
      await scheduleChanges.recordChange({
        scope: req.scheduleQuery, scheduleId: saved._id, kind: 'unpublish', source: 'unpublish',
        contentRevision: currentRevisionOf(saved), user: req.user,
      });
      return res.json({ ok: true, publication: saved.publication || null });
    } catch (err) {
      console.error('[POST /api/schedules/unpublish] ERR:', err);
      return res.status(500).json({ ok: false, message: 'Sunucu hatası' });
    }
  }
);

// İşlem geçmişi: kim, hangi nöbeti, ne zaman değiştirdi; yayın sürümleri.
router.get('/changes',
  requireAuth,
  publicationScope,
  allowMonthlyRead,
  async (req, res) => {
    try {
      if (!canViewDrafts(req.user)) return res.status(403).json({ ok: false, message: 'Yetki yok' });
      const items = await scheduleChanges.listChanges(req.scheduleQuery, { limit: req.query?.limit });
      const doc = await MonthlySchedule.findOne(req.scheduleQuery).select('revision publication').lean();
      const { hasUnpublishedChanges } = require('../services/schedulePublicationService');
      return res.json({
        ok: true,
        items: items.map(({ snapshot, ...rest }) => rest),
        contentRevision: currentRevisionOf(doc),
        publication: doc?.publication || null,
        hasUnpublishedChanges: hasUnpublishedChanges(doc),
      });
    } catch (err) {
      console.error('[GET /api/schedules/changes] ERR:', err);
      return res.status(500).json({ ok: false, message: 'Sunucu hatası' });
    }
  }
);

router.__test = {
  restorePersonIds,
  chooseMonthlyResponseAssignments,
  slotKey,
  trimOverbookedAssignments,
};

module.exports = router;
module.exports.ruleStatusOf = ruleStatusOf;

/* =========================================================
   GET /api/schedules/generated
   GeneratedSchedule explainability/full-output read model.
   Returns the latest scheduler write-model document for a month.
========================================================= */
const GeneratedSchedule = require('../models/GeneratedSchedule');

router.get('/generated',
  requireAuth,
  (req, _res, next) => {
    req.targetServiceId = req.query?.serviceId != null ? String(req.query.serviceId).trim() : '';
    next();
  },
  allowMonthlyRead,
  async (req, res) => {
  try {
    if (!req.hospitalId) return res.status(400).json({ ok: false, message: 'hospitalId eksik' });
    const { sectionId = 'calisma-cizelgesi', serviceId = '', role = '', year, month } = req.query;
    const filter = { hospitalId: req.hospitalId, sectionId };
    if (serviceId) filter.serviceId = serviceId;
    if (role) filter.role = role;
    if (year) filter.year = Number(year);
    if (month) filter.month = Number(month);

    const doc = await GeneratedSchedule
      .findOne(filter)
      .sort({ createdAt: -1 })
      .lean();

    if (!doc) return res.json({ ok: true, data: null });

    if (!canViewDrafts(req.user)) {
      // Personel, taslaktaki ayın üretim çıktısını göremez.
      const draftScopes = await findDraftScopes({
        hospitalId: req.hospitalId, year: doc.year, month: doc.month, sectionId: doc.sectionId,
      });
      const hidden = draftScopes.some((s) =>
        s.serviceId === String(doc.serviceId || '') && s.role === String(doc.role || '')
      );
      if (hidden) return res.json({ ok: true, data: null, unpublished: true });
    }
    res.json({ ok: true, data: doc });
  } catch (e) {
    res.status(500).json({ ok: false, message: safeMessage(e, 'Sunucu hatası') });
  }
});
