'use strict';

const Setting = require('../models/Setting');

const LEAVES_V2_KEY = 'leavesV2';
const CONFLICT_CODE = 'LEAVESV2_SETTINGS_CONFLICT';
const CONFLICT_MESSAGE = 'Leave settings could not be saved because the settings document scope is inconsistent.';

function normalizeServiceId(value) {
  return String(value == null ? '' : value).trim();
}

function isDuplicateKeyError(err) {
  return Number(err?.code) === 11000;
}

function makeLeavesV2ConflictError(cause) {
  const err = new Error(CONFLICT_MESSAGE);
  err.code = CONFLICT_CODE;
  err.status = 409;
  if (cause) err.cause = cause;
  return err;
}

function assertLeavesV2Size(value) {
  if (!value || typeof value !== 'object') return;
  const approxBytes = Buffer.byteLength(JSON.stringify(value), 'utf8');
  if (approxBytes > 12 * 1024 * 1024) {
    throw new Error(`leavesV2 değeri BSON limitine yaklaşıyor (${Math.round(approxBytes / 1024 / 1024)}MB). Veriyi ayırın.`);
  }
}

function scopedFilter(req, serviceId) {
  return {
    hospitalId: req?.hospitalId || null,
    key: LEAVES_V2_KEY,
    serviceId: normalizeServiceId(serviceId),
  };
}

function legacyNullFilter(serviceId) {
  return {
    hospitalId: null,
    key: LEAVES_V2_KEY,
    serviceId: normalizeServiceId(serviceId),
  };
}

function legacyMissingFilter(serviceId) {
  return {
    hospitalId: { $exists: false },
    key: LEAVES_V2_KEY,
    serviceId: normalizeServiceId(serviceId),
  };
}

function afterDocument(result) {
  if (!result) return null;
  if (result._id) return result;
  return result.value || result;
}

function writePayload(req, serviceId, value) {
  return {
    $set: {
      key: LEAVES_V2_KEY,
      serviceId: normalizeServiceId(serviceId),
      value: value && typeof value === 'object' ? value : {},
      updatedBy: req?.user?.uid || null,
    },
    $setOnInsert: {
      ...(req?.hospitalId ? { hospitalId: req.hospitalId } : {}),
      createdBy: req?.user?.uid || null,
    },
  };
}

async function findLeavesV2Doc(req, serviceId = '') {
  const sid = normalizeServiceId(serviceId);
  const exact = await Setting.findOne(scopedFilter(req, sid));
  if (exact) return exact;

  const legacyNull = await Setting.collection.findOne(legacyNullFilter(sid));
  if (legacyNull) return legacyNull;

  return Setting.collection.findOne(legacyMissingFilter(sid));
}

async function updateExistingLeavesV2(req, serviceId, value) {
  const sid = normalizeServiceId(serviceId);
  const update = {
    $set: {
      key: LEAVES_V2_KEY,
      serviceId: sid,
      value: value && typeof value === 'object' ? value : {},
      updatedBy: req?.user?.uid || null,
    },
  };

  const exact = await Setting.findOneAndUpdate(scopedFilter(req, sid), update, { new: true });
  if (exact) return exact;

  const legacyNull = afterDocument(await Setting.collection.findOneAndUpdate(
    legacyNullFilter(sid),
    update,
    { returnDocument: 'after' }
  ));
  if (legacyNull) return legacyNull;

  return afterDocument(await Setting.collection.findOneAndUpdate(
    legacyMissingFilter(sid),
    update,
    { returnDocument: 'after' }
  ));
}

async function saveLeavesV2Value(req, serviceId = '', value = {}) {
  const sid = normalizeServiceId(serviceId);
  assertLeavesV2Size(value);

  const existing = await updateExistingLeavesV2(req, sid, value);
  if (existing) return existing;

  try {
    return await Setting.findOneAndUpdate(
      scopedFilter(req, sid),
      writePayload(req, sid, value),
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err;

    const recovered = await updateExistingLeavesV2(req, sid, value);
    if (recovered) return recovered;
    throw makeLeavesV2ConflictError(err);
  }
}

/**
 * İki leavesV2 değerini kişi → ay → gün düzeyinde birleştirir.
 * `overlay` içindeki günler `base`'dekileri ezer; hiçbir girdi değiştirilmez.
 */
function mergeLeavesV2Values(base, overlay) {
  const out = {};
  for (const src of [base, overlay]) {
    if (!src || typeof src !== 'object') continue;
    for (const [pid, monthMap] of Object.entries(src)) {
      if (!pid || !monthMap || typeof monthMap !== 'object') continue;
      out[pid] ??= {};
      for (const [monthKey, dayMap] of Object.entries(monthMap)) {
        if (!dayMap || typeof dayMap !== 'object') continue;
        out[pid][monthKey] = { ...(out[pid][monthKey] || {}), ...dayMap };
      }
    }
  }
  return out;
}

/**
 * Bir hastane + servis için geçerli izin haritasını döner.
 * İzin onayı ve AI izin girişi global kovaya (serviceId: '') yazar; servis
 * bazlı kova da olabilir. İkisi birleştirilir, servise özel günler önceliklidir.
 * Sadece okuma yapar.
 */
async function loadMergedLeavesV2Value({ hospitalId = null, serviceId = '' } = {}) {
  const sid = normalizeServiceId(serviceId);
  const filter = { key: LEAVES_V2_KEY, serviceId: { $in: sid ? ['', sid] : [''] } };
  if (hospitalId) filter.hospitalId = hospitalId;

  const docs = (await Setting.find(filter).lean()) || [];
  const globalDoc = docs.find((d) => normalizeServiceId(d?.serviceId) === '');
  const serviceDoc = sid ? docs.find((d) => normalizeServiceId(d?.serviceId) === sid) : null;
  return mergeLeavesV2Values(globalDoc?.value, serviceDoc?.value);
}

module.exports = {
  CONFLICT_CODE,
  CONFLICT_MESSAGE,
  LEAVES_V2_KEY,
  findLeavesV2Doc,
  isDuplicateKeyError,
  loadMergedLeavesV2Value,
  makeLeavesV2ConflictError,
  mergeLeavesV2Values,
  normalizeServiceId,
  saveLeavesV2Value,
};
