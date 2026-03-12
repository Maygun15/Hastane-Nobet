// routes/schedules.routes.js
const express = require('express');
const router = express.Router();

const MonthlySchedule = require('../models/MonthlySchedule');
const ScheduleRules = require('../models/ScheduleRules');
const { listHolidays } = require('../services/holidayService');
const { validateAssignment } = require('../utils/rulesValidator');
const { requireAuth, sameServiceOrAdmin, requireRole } = require('../middleware/authz');

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

function normalizeAssignPayload(body, query, userId) {
  const personId = String(body?.personId ?? body?.personID ?? '').trim();
  const shiftId = String(body?.shiftId ?? body?.shiftCode ?? body?.shift ?? '').trim();
  if (!personId) throw new Error('personId gerekli');
  if (!shiftId) throw new Error('shiftId gerekli');

  const personName = String(body?.personName ?? body?.name ?? '').trim();
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

function buildQuery(req) {
  const { sectionId, serviceId = '', role = '' } = req.method === 'GET'
    ? req.query
    : req.body;

  const year = parseIntSafe(req.method === 'GET' ? req.query.year : req.body.year);
  const month = parseIntSafe(req.method === 'GET' ? req.query.month : req.body.month);

  if (!sectionId) throw new Error('sectionId gerekli');
  if (!year || year < 2000) throw new Error('year geçersiz');
  if (!month || month < 1 || month > 12) throw new Error('month 1..12 aralığında olmalı');

  return {
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
      let scheduleData = doc?.data && typeof doc.data === 'object' ? doc.data : {};
      let dataChanged = false;

      const defs = Array.isArray(scheduleData.defs)
        ? scheduleData.defs
        : Array.isArray(scheduleData.rows)
        ? scheduleData.rows
        : [];
      const namedAssignments =
        scheduleData?.roster?.namedAssignments && typeof scheduleData.roster.namedAssignments === 'object'
          ? scheduleData.roster.namedAssignments
          : null;
      const assignmentCount = Array.isArray(scheduleData.assignments) ? scheduleData.assignments.length : 0;
      const namedCount = namedAssignments ? countNamedAssignments(namedAssignments) : 0;

      if (namedAssignments && namedCount > 0) {
        const looksCorrupted =
          assignmentCount === 0 ||
          (assignmentCount > 0 && assignmentCount < Math.ceil(namedCount * 0.2));
        if (looksCorrupted) {
          const rebuilt = buildAssignmentsFromNamed({
            year: query.year,
            month: query.month,
            defs,
            namedAssignments,
          });
          if (rebuilt.length > assignmentCount) {
            scheduleData = { ...scheduleData, assignments: rebuilt };
            dataChanged = true;
          }
        }
      }

      if (doc && Array.isArray(scheduleData.assignments)) {
        const holidays = await listHolidays({ year: query.year, month: query.month });
        const holidayKindByDate = buildHolidayKindByDateMap(holidays);
        const sanitized = sanitizeSupervisorAssignments(
          scheduleData.assignments,
          defs,
          holidayKindByDate
        );
        if (sanitized.changed) {
          scheduleData = { ...scheduleData, assignments: sanitized.assignments };
          dataChanged = true;
        }
      }

      if (doc && dataChanged) {
        await MonthlySchedule.findByIdAndUpdate(
          doc._id,
          { $set: { data: scheduleData } },
          { new: false }
        );
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

async function upsertMonthly(req, res) {
  try {
    const query = req.scheduleQuery;
    let payload = req.body?.data || {};
    const meta = req.body?.meta || {};
    const existingDoc = await MonthlySchedule.findOne(query).lean();
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
      const holidays = await listHolidays({ year: query.year, month: query.month });
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
    }

    const update = {
      ...query,
      data: payload,
      meta,
      updatedBy: req.user?.uid || null,
    };
    if (!req.body?.id) {
      update.createdBy = req.user?.uid || null;
    }

    const doc = await MonthlySchedule.findOneAndUpdate(
      query,
      { $set: update },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();

    return res.json({
      ok: true,
      schedule: {
        id: String(doc._id),
        ...query,
        data: doc.data || {},
        meta: doc.meta || {},
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        createdBy: doc.createdBy || null,
        updatedBy: doc.updatedBy || null,
      },
    });
  } catch (err) {
    console.error('[PUT/POST /api/schedules/monthly] ERR:', err);
    if (err?.message?.includes('duplicate key')) {
      return res.status(409).json({ ok: false, message: 'Çakışan kayıt' });
    }
    if (err.name === 'ValidationError' || err.name === 'CastError') {
      return res.status(400).json({ ok: false, message: err.message });
    }
    return res.status(500).json({ ok: false, message: 'Sunucu hatası' });
  }
}

router.put('/monthly',
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
  sameServiceOrAdmin,
  upsertMonthly
);

// Backward-compat: eski clientlar /api/schedules POST çağırıyor olabilir
router.post('/',
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
  sameServiceOrAdmin,
  upsertMonthly
);

router.post('/assign',
  requireAuth,
  (req, res, next) => {
    try {
      const query = buildAssignQuery(req.body || {});
      req.assignQuery = query;
      req.assignPayload = normalizeAssignPayload(req.body || {}, query, req.user?.uid || null);
      req.targetServiceId = query.serviceId;
      next();
    } catch (err) {
      return res.status(400).json({ ok: false, message: err.message || 'Geçersiz istek' });
    }
  },
  sameServiceOrAdmin,
  loadRules,
  async (req, res) => {
    try {
      const query = {
        sectionId: req.assignQuery.sectionId,
        serviceId: req.assignQuery.serviceId,
        role: req.assignQuery.role,
        year: req.assignQuery.year,
        month: req.assignQuery.month,
      };

      const doc = await MonthlySchedule.findOne(query).lean();
      const data = doc?.data && typeof doc.data === 'object' ? doc.data : {};
      const assignments = Array.isArray(data.assignments) ? [...data.assignments] : [];

      const defs = Array.isArray(data.defs)
        ? data.defs
        : Array.isArray(data.rows)
        ? data.rows
        : [];
      const supervisorRowIds = buildSupervisorRowIdSet(defs);
      const holidays = await listHolidays({ year: query.year, month: query.month });
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
      if (previousShiftId) {
        const prevNorm = previousShiftId.toUpperCase();
        const payloadDate = String(payload?.date || '').slice(0, 10);
        const payloadPid = String(payload?.personId || '').trim();
        const payloadPname = canonName(payload?.personName || '');
        nextAssignments = nextAssignments.filter((a) => {
          const aDate = String(a?.date || a?.day || '').slice(0, 10);
          if (aDate !== payloadDate) return true;
          const aShift = String(a?.shiftId || a?.shiftCode || a?.shift || a?.code || '').trim().toUpperCase();
          if (aShift !== prevNorm) return true;
          const aPid = String(a?.personId || '').trim();
          const aPname = canonName(a?.personName || a?.name || '');
          if (payloadPid && aPid) return aPid !== payloadPid;
          if (payloadPname && aPname) return aPname !== payloadPname;
          return true;
        });
      }

      const key = assignmentKey(payload);
      // Edit senaryosunda aynı kaydı kendisiyle kıyaslayıp yalancı kural ihlali üretmemek için
      // validasyon sırasında mevcut kaydı geçici olarak hariç tut.
      const validationBase = nextAssignments.filter((a) => assignmentKey(a) !== key);
      const validation = validateAssignment(req.scheduleRules, payload, validationBase);
      if (!validation.valid) {
        return res.status(400).json({
          ok: false,
          message: 'Nöbet yazma kuralı ihlali',
          errors: validation.errors,
        });
      }

      const idx = nextAssignments.findIndex((a) => assignmentKey(a) === key);
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

      const update = {
        $set: {
          ...query,
          data: { ...data, assignments: nextAssignments },
          updatedBy: req.user?.uid || null,
        },
        $setOnInsert: {
          createdBy: req.user?.uid || null,
        },
      };

      const saved = await MonthlySchedule.findOneAndUpdate(
        query,
        update,
        { new: true, upsert: true, setDefaultsOnInsert: true }
      ).lean();

      const outAssignments = Array.isArray(saved?.data?.assignments)
        ? saved.data.assignments
        : nextAssignments;

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
  (req, res, next) => {
    try {
      const query = buildAssignQuery(req.body || {});
      req.assignQuery = query;
      req.assignPayload = normalizeAssignPayload(req.body || {}, query, req.user?.uid || null);
      req.targetServiceId = query.serviceId;
      next();
    } catch (err) {
      return res.status(400).json({ ok: false, message: err.message || 'Geçersiz istek' });
    }
  },
  sameServiceOrAdmin,
  async (req, res) => {
    try {
      const base = {
        sectionId: req.assignQuery.sectionId,
        year: req.assignQuery.year,
        month: req.assignQuery.month,
      };
      const serviceId = req.assignQuery.serviceId || '';
      const role = req.assignQuery.role || '';
      const candidates = [
        { ...base, serviceId, role },
        { ...base, serviceId, role: '' },
        { ...base, serviceId: '', role },
        { ...base, serviceId: '', role: '' },
      ];

      let doc = null;
      let query = null;
      for (const q of candidates) {
        const found = await MonthlySchedule.findOne(q).lean();
        if (found) {
          doc = found;
          query = q;
          break;
        }
      }
      const attemptRemove = async (targetDoc, targetQuery) => {
        const data = targetDoc?.data && typeof targetDoc.data === 'object' ? targetDoc.data : {};
        const assignments = Array.isArray(data.assignments) ? [...data.assignments] : [];
        const { filtered, removed } = applyDeleteFilter(assignments, req.assignPayload, req.assignQuery);
        if (!removed) return { removed: false };

        const saved = await MonthlySchedule.findOneAndUpdate(
          targetQuery,
          {
            $set: {
              data: { ...data, assignments: filtered },
              updatedBy: req.user?.uid || null,
            },
          },
          { new: true }
        ).lean();

        return {
          removed: true,
          assignments: Array.isArray(saved?.data?.assignments) ? saved.data.assignments : filtered,
          updatedAt: saved?.updatedAt || null,
        };
      };

      if (doc && query) {
        const res1 = await attemptRemove(doc, query);
        if (res1.removed) {
          return res.json({ ok: true, removed: true, ...res1 });
        }
      }

      // Son çare: aynı ay için tüm schedule'larda ara
      const allDocs = await MonthlySchedule.find(base).lean();
      for (const d of allDocs) {
        const res2 = await attemptRemove(d, { _id: d._id });
        if (res2.removed) {
          return res.json({ ok: true, removed: true, ...res2 });
        }
      }

      return res.json({ ok: true, assignments: doc?.data?.assignments || [], removed: false });
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
      return res.status(500).json({ ok: false, message: err.message });
    }
  }
);

// Kuralları güncelle (ADMIN)
router.put('/rules',
  requireAuth,
  requireRole('admin'),
  async (req, res) => {
    try {
      const { sectionId, serviceId = '', role = '', ...ruleData } = req.body || {};
      if (!sectionId) {
        return res.status(400).json({ ok: false, message: 'sectionId gerekli' });
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
      return res.status(500).json({ ok: false, message: err.message });
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
      return res.status(500).json({ ok: false, message: err.message });
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
      return res.status(500).json({ ok: false, message: err.message || 'Sunucu hatası' });
    }
  }
);

module.exports = router;

/* =========================================================
   GET /api/schedules/generated
   Son generate edilmiş planı döndürür
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
    const { sectionId = 'calisma-cizelgesi', serviceId = '', role = '', year, month } = req.query;
    const filter = { sectionId };
    if (serviceId) filter.serviceId = serviceId;
    if (role) filter.role = role;
    if (year) filter.year = Number(year);
    if (month) filter.month = Number(month);

    const doc = await GeneratedSchedule
      .findOne(filter)
      .sort({ createdAt: -1 })
      .lean();

    if (!doc) return res.json({ ok: true, data: null });
    res.json({ ok: true, data: doc });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
