const express = require('express');
const router = express.Router();
const Setting = require('../models/Setting');
const { requireAuth, requireRole } = require('../middleware/authz');
const { isSuperAdminRole, withHospitalFilter } = require('../middleware/hospital');
const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
const safeMessage = (err, fallback = 'Sunucu hatası') =>
  isProd ? fallback : (err?.message || fallback);

const normalizeKey = (k) => String(k || '').trim();
const normalizeServiceId = (s) => {
  const value = String(s == null ? '' : s).trim();
  return !value || value.toLowerCase() === 'global' ? '' : value;
};

function buildSettingScopeFilter(req, key, serviceId) {
  const filter = { key, serviceId };
  if (isSuperAdminRole(req.user?.role)) return filter;
  if (!req.hospitalId) return withHospitalFilter(req, filter);
  return {
    ...filter,
    $or: [
      { hospitalId: req.hospitalId },
      { hospitalId: null },
      { hospitalId: { $exists: false } },
    ],
  };
}

function buildScopedSettingFilter(req, key, serviceId) {
  return withHospitalFilter(req, { key, serviceId });
}

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
    const serviceId = normalizeServiceId(req.body?.serviceId ?? req.query?.serviceId);
    const value = req.body?.value ?? null;
    // First update an existing scoped/legacy record; if none exists, create the scoped record.
    let doc = await Setting.findOneAndUpdate(
      buildSettingScopeFilter(req, key, serviceId),
      {
        $set: {
          key,
          serviceId,
          value,
          updatedBy: req.user?.uid || null,
        },
      },
      { new: true }
    ).lean();
    if (!doc) {
      doc = await Setting.findOneAndUpdate(
        buildScopedSettingFilter(req, key, serviceId),
        {
          $set: {
            key,
            serviceId,
            value,
            updatedBy: req.user?.uid || null,
          },
          $setOnInsert: {
            ...(req.hospitalId ? { hospitalId: req.hospitalId } : {}),
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
