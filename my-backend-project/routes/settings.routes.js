const express = require('express');
const router = express.Router();
const Setting = require('../models/Setting');
const { requireAuth, requireRole } = require('../middleware/authz');
const { withHospitalFilter } = require('../middleware/hospital');
const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
const safeMessage = (err, fallback = 'Sunucu hatası') =>
  isProd ? fallback : (err?.message || fallback);

const normalizeKey = (k) => String(k || '').trim();
const normalizeServiceId = (s) => String(s || '').trim();

async function findLegacySetting(req, key, serviceId) {
  if (!req.hospitalId) return null;
  return Setting.findOne({
    key,
    serviceId,
    $or: [{ hospitalId: { $exists: false } }, { hospitalId: null }],
  });
}

async function ensureScopedSetting(req, key, serviceId) {
  const scoped = await Setting.findOne(withHospitalFilter(req, { key, serviceId }));
  if (scoped || !req.hospitalId) return scoped;

  const legacy = await findLegacySetting(req, key, serviceId);
  if (!legacy) return null;

  legacy.hospitalId = req.hospitalId;
  await legacy.save();
  return legacy;
}

// GET /api/settings/:key?serviceId=
router.get('/:key', requireAuth, async (req, res) => {
  try {
    const key = normalizeKey(req.params.key);
    if (!key) return res.status(400).json({ ok: false, message: 'key gerekli' });
    const serviceId = normalizeServiceId(req.query?.serviceId || '');
    const doc = await ensureScopedSetting(req, key, serviceId);
    return res.json({
      ok: true,
      key,
      serviceId,
      value: doc?.value ?? null,
      updatedAt: doc?.updatedAt || null,
      createdAt: doc?.createdAt || null,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, message: safeMessage(err) });
  }
});

// PUT /api/settings/:key  body: { value, serviceId }
router.put('/:key', requireAuth, requireRole('admin', 'authorized'), async (req, res) => {
  try {
    const key = normalizeKey(req.params.key);
    if (!key) return res.status(400).json({ ok: false, message: 'key gerekli' });
    const serviceId = normalizeServiceId(req.body?.serviceId || req.query?.serviceId || '');
    const value = req.body?.value ?? null;
    const existing = await ensureScopedSetting(req, key, serviceId);
    let doc;

    if (existing) {
      existing.value = value;
      existing.updatedBy = req.user?.uid || null;
      if (!existing.createdBy) existing.createdBy = req.user?.uid || null;
      await existing.save();
      doc = existing.toObject ? existing.toObject() : existing;
    } else {
      doc = await Setting.findOneAndUpdate(
        withHospitalFilter(req, { key, serviceId }),
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
    }
    return res.json({
      ok: true,
      key,
      serviceId,
      value: doc?.value ?? null,
      updatedAt: doc?.updatedAt || null,
      createdAt: doc?.createdAt || null,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, message: safeMessage(err) });
  }
});

module.exports = router;
