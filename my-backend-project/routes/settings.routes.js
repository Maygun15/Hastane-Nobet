const express = require('express');
const router = express.Router();
const Setting = require('../models/Setting');
const { requireAuth, requireRole } = require('../middleware/authz');

const normalizeKey = (k) => String(k || '').trim();
const normalizeServiceId = (s) => String(s || '').trim();

// GET /api/settings/:key?serviceId=
router.get('/:key', requireAuth, async (req, res) => {
  try {
    const key = normalizeKey(req.params.key);
    if (!key) return res.status(400).json({ ok: false, message: 'key gerekli' });
    const serviceId = normalizeServiceId(req.query?.serviceId || '');
    const doc = await Setting.findOne({ key, serviceId }).lean();
    return res.json({
      ok: true,
      key,
      serviceId,
      value: doc?.value ?? null,
      updatedAt: doc?.updatedAt || null,
      createdAt: doc?.createdAt || null,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message || 'Sunucu hatası' });
  }
});

// PUT /api/settings/:key  body: { value, serviceId }
router.put('/:key', requireAuth, requireRole('admin', 'authorized'), async (req, res) => {
  try {
    const key = normalizeKey(req.params.key);
    if (!key) return res.status(400).json({ ok: false, message: 'key gerekli' });
    const serviceId = normalizeServiceId(req.body?.serviceId || req.query?.serviceId || '');
    const value = req.body?.value ?? null;
    const doc = await Setting.findOneAndUpdate(
      { key, serviceId },
      {
        $set: {
          key,
          serviceId,
          value,
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
      key,
      serviceId,
      value: doc?.value ?? null,
      updatedAt: doc?.updatedAt || null,
      createdAt: doc?.createdAt || null,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message || 'Sunucu hatası' });
  }
});

module.exports = router;
