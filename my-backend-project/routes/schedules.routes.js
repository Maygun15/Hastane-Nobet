// routes/schedules.routes.js
const express = require('express');
const router = express.Router();

const MonthlySchedule = require('../models/MonthlySchedule');
const ScheduleRules = require('../models/ScheduleRules');
const { validateAssignment } = require('../utils/rulesValidator');
const { requireAuth, sameServiceOrAdmin, requireRole } = require('../middleware/authz');

function parseIntSafe(val, def = null) {
  const n = Number(val);
  return Number.isFinite(n) ? n : def;
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
  sameServiceOrAdmin,
  async (req, res) => {
    try {
      const query = req.scheduleQuery;
      const doc = await MonthlySchedule.findOne(query).lean();
      const issues =
        doc?.data?.issues
        || doc?.data?.roster?.issues
        || doc?.meta?.issues
        || [];
      return res.json({
        ok: true,
        schedule: doc ? {
          id: String(doc._id),
          ...query,
          data: doc.data || {},
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
    const payload = req.body?.data || {};
    const meta = req.body?.meta || {};

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

      const payload = req.assignPayload;

      const validation = validateAssignment(req.scheduleRules, payload, assignments);
      if (!validation.valid) {
        return res.status(400).json({
          ok: false,
          message: 'Nöbet yazma kuralı ihlali',
          errors: validation.errors,
        });
      }

      const key = assignmentKey(payload);
      const idx = assignments.findIndex((a) => assignmentKey(a) === key);
      if (idx === -1) {
        assignments.push(payload);
      } else {
        const existing = assignments[idx] || {};
        const merged = { ...existing, ...payload };
        if (payload.pinned === undefined && existing.pinned !== undefined) {
          merged.pinned = existing.pinned;
        }
        assignments[idx] = merged;
      }

      const update = {
        $set: {
          ...query,
          data: { ...data, assignments },
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
        : assignments;

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
      if (!doc) {
        return res.json({ ok: true, assignments: [], removed: false });
      }

      const data = doc?.data && typeof doc.data === 'object' ? doc.data : {};
      const assignments = Array.isArray(data.assignments) ? [...data.assignments] : [];
      const key = assignmentKey(req.assignPayload);
      let filtered = assignments.filter(
        (a) => assignmentKey(a) !== key && !matchesAssignForDelete(a, req.assignPayload, req.assignQuery)
      );

      if (filtered.length === assignments.length) {
        // Fallback: aynı gün + kişi bazlı tek atama varsa onu sil
        const candidates = assignments.filter((a) =>
          matchesByPersonAndDay(a, req.assignPayload, req.assignQuery)
        );
        if (candidates.length === 1) {
          const target = candidates[0];
          filtered = assignments.filter((a) => a !== target);
        } else {
          return res.json({ ok: true, assignments, removed: false });
        }
      }

      const saved = await MonthlySchedule.findOneAndUpdate(
        query,
        {
          $set: {
            data: { ...data, assignments: filtered },
            updatedBy: req.user?.uid || null,
          },
        },
        { new: true }
      ).lean();

      return res.json({
        ok: true,
        assignments: Array.isArray(saved?.data?.assignments) ? saved.data.assignments : filtered,
        removed: true,
        updatedAt: saved?.updatedAt || null,
      });
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

module.exports = router;

/* =========================================================
   GET /api/schedules/generated
   Son generate edilmiş planı döndürür
========================================================= */
const GeneratedSchedule = require('../models/GeneratedSchedule');

router.get('/generated', async (req, res) => {
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
