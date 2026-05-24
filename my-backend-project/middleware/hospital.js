const { AsyncLocalStorage } = require('async_hooks');
const Hospital = require('../models/Hospital');

const hospitalContext = new AsyncLocalStorage();
const DEFAULT_HOSPITAL_CACHE_MS = 60 * 1000;
let defaultHospitalCache = { id: '', at: 0 };

function normalizeRole(role) {
  return String(role || '').trim().toLowerCase();
}

function isSuperAdminRole(role) {
  return normalizeRole(role) === 'superadmin';
}

async function resolveHospitalIdFromExistingData() {
  const db = Hospital?.db?.db;
  if (!db) return '';

  const sources = ['users', 'people', 'services', 'settings', 'requests', 'schedules'];
  for (const name of sources) {
    try {
      const row = await db.collection(name).findOne(
        { hospitalId: { $exists: true, $ne: null } },
        { projection: { hospitalId: 1 } }
      );
      if (row?.hospitalId) return String(row.hospitalId);
    } catch {
      // koleksiyon yoksa sıradakine geç
    }
  }
  return '';
}

async function resolveDefaultHospitalId() {
  const envId = String(process.env.DEFAULT_HOSPITAL_ID || '').trim();
  if (envId) return envId;

  const now = Date.now();
  if (defaultHospitalCache.id && now - defaultHospitalCache.at < DEFAULT_HOSPITAL_CACHE_MS) {
    return defaultHospitalCache.id;
  }

  const row = await Hospital.findOne({ active: true })
    .sort({ createdAt: 1, _id: 1 })
    .select('_id')
    .lean();
  let id = row?._id ? String(row._id) : '';
  if (!id) {
    id = await resolveHospitalIdFromExistingData();
    if (id) {
      defaultHospitalCache = { id, at: now };
      return id;
    }
  }
  if (!id) {
    try {
      const created = await Hospital.create({
        name: 'Default Hospital',
        slug: 'default-hospital',
        contactEmail: '',
        active: true,
      });
      id = created?._id ? String(created._id) : '';
    } catch (err) {
      // paralel isteklerde unique slug çakışırsa tekrar oku
      if (err?.code === 11000) {
        const again = await Hospital.findOne({ slug: 'default-hospital' }).select('_id').lean();
        id = again?._id ? String(again._id) : '';
      } else {
        throw err;
      }
    }
  }
  defaultHospitalCache = { id, at: now };
  return id;
}

async function extractHospital(req, res, next) {
  const role = normalizeRole(req.user?.role);
  const rawHospitalId = req.user?.hospitalId ? String(req.user.hospitalId).trim() : '';

  if (isSuperAdminRole(role)) {
    // Superadmin için da hospitalId zorunlu — izolasyon kırılmamalı.
    // Sadece route seviyesinde açıkça `req.bypassHospitalFilter = true` atandıysa
    // filtre atlanır (sistem geneli admin operasyonları için).
    if (req.bypassHospitalFilter === true) {
      req.hospitalId = null;
      return next();
    }

    if (rawHospitalId) {
      req.hospitalId = rawHospitalId;
      return next();
    }

    // Superadmin body/query'den explicit hospitalId göndermiş olabilir
    const explicitId = String(req.body?.hospitalId || req.query?.hospitalId || '').trim();
    if (explicitId) {
      req.hospitalId = explicitId;
      return next();
    }

    // Tek-hastane deployment için default'a düş
    try {
      const fallbackId = await resolveDefaultHospitalId();
      if (fallbackId) {
        req.hospitalId = fallbackId;
        return next();
      }
    } catch (err) {
      console.error('[hospital] superadmin default resolve failed:', err?.message || err);
    }

    return res.status(403).json({
      message: 'Superadmin için hospitalId zorunlu. İstek body/query içinde hospitalId gönderin ya da kullanıcıya hospitalId atayın.',
    });
  }

  // Normal kullanıcılar
  if (!rawHospitalId) {
    try {
      const fallbackHospitalId = await resolveDefaultHospitalId();
      if (fallbackHospitalId) {
        req.hospitalId = fallbackHospitalId;
        if (req.user && typeof req.user === 'object' && !req.user.hospitalId) {
          req.user.hospitalId = fallbackHospitalId;
        }
        return next();
      }
    } catch (err) {
      console.error('[hospital] default hospital resolve failed:', err?.message || err);
    }
    return res.status(403).json({ message: 'hospitalId gerekli' });
  }

  req.hospitalId = rawHospitalId;
  return next();
}

function applyHospitalContext(req, _res, next) {
  hospitalContext.run(
    {
      hospitalId: req.hospitalId || null,
      role: normalizeRole(req.user?.role),
    },
    () => next()
  );
}

function getHospitalContext() {
  return hospitalContext.getStore() || { hospitalId: null, role: '' };
}

// getHospitalContext() her zaman non-null döner (fallback nedeniyle).
// Request context'inin gerçekten kurulup kurulmadığını anlamak için bu fonksiyon kullanılır.
function hasHospitalContext() {
  return hospitalContext.getStore() != null;
}

function withHospitalFilter(req, base = {}) {
  const filter = base && typeof base === 'object' ? { ...base } : {};
  // bypassHospitalFilter yalnızca route seviyesinde açıkça atandığında filtre atlanır.
  // Superadmin dahil tüm roller için hospitalId her zaman zorunlu.
  if (req.bypassHospitalFilter === true) return filter;
  filter.hospitalId = req.hospitalId || null;
  return filter;
}

function withHospitalPipeline(req, pipeline = []) {
  const stages = Array.isArray(pipeline) ? [...pipeline] : [];
  if (req.bypassHospitalFilter === true) return stages;
  if (!req.hospitalId) return [{ $match: { hospitalId: '__missing_hospital__' } }, ...stages];
  const hasMatch = stages.some(
    (stage) => stage?.$match && Object.prototype.hasOwnProperty.call(stage.$match, 'hospitalId'),
  );
  if (hasMatch) return stages;
  if (stages[0]?.$geoNear) {
    return [stages[0], { $match: { hospitalId: req.hospitalId } }, ...stages.slice(1)];
  }
  return [{ $match: { hospitalId: req.hospitalId } }, ...stages];
}

module.exports = {
  applyHospitalContext,
  extractHospital,
  getHospitalContext,
  hasHospitalContext,
  isSuperAdminRole,
  withHospitalFilter,
  withHospitalPipeline,
};
