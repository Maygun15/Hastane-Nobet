// routes/schedules.routes.js
const express = require('express');
const router = express.Router();

const MonthlySchedule = require('../models/MonthlySchedule');
const { requireAuth, sameServiceOrAdmin } = require('../middleware/authz');

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
      const query = {
        sectionId: req.assignQuery.sectionId,
        serviceId: req.assignQuery.serviceId,
        role: req.assignQuery.role,
        year: req.assignQuery.year,
        month: req.assignQuery.month,
      };

      const doc = await MonthlySchedule.findOne(query).lean();
      if (!doc) {
        return res.json({ ok: true, assignments: [], removed: false });
      }

      const data = doc?.data && typeof doc.data === 'object' ? doc.data : {};
      const assignments = Array.isArray(data.assignments) ? [...data.assignments] : [];
      const key = assignmentKey(req.assignPayload);
      const filtered = assignments.filter((a) => assignmentKey(a) !== key);

      if (filtered.length === assignments.length) {
        return res.json({ ok: true, assignments, removed: false });
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

