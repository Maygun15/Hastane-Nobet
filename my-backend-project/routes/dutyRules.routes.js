// routes/dutyRules.routes.js
const express = require('express');
const router = express.Router();
const DutyRule = require('../models/DutyRule');
const { requireAuth, requireRole } = require('../middleware/authz');
const { DEFAULT_RULES, DEFAULT_WEIGHTS } = require('../services/schedulerService');

function parseQuery(req) {
  const sectionId = (req.query.sectionId || req.body?.sectionId || '').toString().trim();
  const serviceId = (req.query.serviceId || req.body?.serviceId || '').toString().trim();
  const role = (req.query.role || req.body?.role || '').toString().trim();
  if (!sectionId) throw new Error('sectionId gerekli');
  return { sectionId, serviceId, role };
}

router.get('/', requireAuth, async (req, res) => {
  try {
    const { sectionId, serviceId, role } = parseQuery(req);
    const doc = await DutyRule.findOne({ sectionId, serviceId, role }).lean();
    const rules = { ...DEFAULT_RULES, ...(doc?.rules || {}) };
    const weights = { ...DEFAULT_WEIGHTS, ...(doc?.weights || {}) };
    return res.json({
      ok: true,
      rule: doc
        ? {
            id: String(doc._id),
            sectionId,
            serviceId,
            role,
            rules,
            weights,
            enabled: doc.enabled !== false,
            createdAt: doc.createdAt,
            updatedAt: doc.updatedAt,
          }
        : {
            id: null,
            sectionId,
            serviceId,
            role,
            rules,
            weights,
            enabled: true,
          },
    });
  } catch (err) {
    return res.status(400).json({ ok: false, message: err.message || 'Geçersiz istek' });
  }
});

router.put('/', requireAuth, requireRole('admin', 'authorized'), async (req, res) => {
  try {
    const { sectionId, serviceId, role } = parseQuery(req);
    const rules = req.body?.rules && typeof req.body.rules === 'object' ? req.body.rules : {};
    const weights = req.body?.weights && typeof req.body.weights === 'object' ? req.body.weights : {};
    const enabled = req.body?.enabled !== false;

    const doc = await DutyRule.findOneAndUpdate(
      { sectionId, serviceId, role },
      {
        $set: {
          sectionId,
          serviceId,
          role,
          rules,
          weights,
          enabled,
          updatedBy: req.user?.uid || null,
        },
        $setOnInsert: {
          createdBy: req.user?.uid || null,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();

    return res.json({
      ok: true,
      rule: {
        id: String(doc._id),
        sectionId,
        serviceId,
        role,
        rules: doc.rules || {},
        weights: doc.weights || {},
        enabled: doc.enabled !== false,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      },
    });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message || 'Sunucu hatası' });
  }
});

// POST /api/duty-rules — yeni kayıt oluştur (varsa 409)
router.post('/', requireAuth, requireRole('admin', 'authorized'), async (req, res) => {
  try {
    const { sectionId, serviceId, role } = parseQuery(req);
    const rules = req.body?.rules && typeof req.body.rules === 'object' ? req.body.rules : {};
    const weights = req.body?.weights && typeof req.body.weights === 'object' ? req.body.weights : {};
    const enabled = req.body?.enabled !== false;

    const exists = await DutyRule.findOne({ sectionId, serviceId, role }).lean();
    if (exists) {
      return res.status(409).json({ ok: false, message: 'Kayıt zaten var (PUT kullanın)' });
    }

    const doc = await DutyRule.create({
      sectionId,
      serviceId,
      role,
      rules,
      weights,
      enabled,
      createdBy: req.user?.uid || null,
    });

    return res.status(201).json({
      ok: true,
      rule: {
        id: String(doc._id),
        sectionId,
        serviceId,
        role,
        rules: doc.rules || {},
        weights: doc.weights || {},
        enabled: doc.enabled !== false,
        createdAt: doc.createdAt,
      },
    });
  } catch (err) {
    if (err?.message?.includes('duplicate key')) {
      return res.status(409).json({ ok: false, message: 'Kayıt zaten var (PUT kullanın)' });
    }
    return res.status(500).json({ ok: false, message: err.message || 'Sunucu hatası' });
  }
});

module.exports = router;
