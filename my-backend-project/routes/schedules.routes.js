// routes/schedules.routes.js
const express = require('express');
const router = express.Router();

const MonthlySchedule = require('../models/MonthlySchedule');
const { requireAuth, sameServiceOrAdmin } = require('../middleware/authz');

function parseIntSafe(val, def = null) {
  const n = Number(val);
  return Number.isFinite(n) ? n : def;
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
      return res.json({
        ok: true,
        schedule: doc ? {
          id: String(doc._id),
          ...query,
          data: doc.data || {},
          meta: doc.meta || {},
          createdAt: doc.createdAt,
          updatedAt: doc.updatedAt,
          createdBy: doc.createdBy || null,
          updatedBy: doc.updatedBy || null,
        } : null,
      });
    } catch (err) {
      console.error('[GET /api/schedules/monthly] ERR:', err);
      return res.status(500).json({ ok: false, message: 'Sunucu hatası' });
    }
  }
);

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
  async (req, res) => {
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
      console.error('[PUT /api/schedules/monthly] ERR:', err);
      if (err?.message?.includes('duplicate key')) {
        return res.status(409).json({ ok: false, message: 'Çakışan kayıt' });
      }
      if (err.name === 'ValidationError' || err.name === 'CastError') {
        return res.status(400).json({ ok: false, message: err.message });
      }
      return res.status(500).json({ ok: false, message: 'Sunucu hatası' });
    }
  }
);

module.exports = router;
