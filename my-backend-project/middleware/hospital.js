const { AsyncLocalStorage } = require('async_hooks');

const hospitalContext = new AsyncLocalStorage();

function normalizeRole(role) {
  return String(role || '').trim().toLowerCase();
}

function isSuperAdminRole(role) {
  return normalizeRole(role) === 'superadmin';
}

function extractHospital(req, res, next) {
  const role = normalizeRole(req.user?.role);
  const rawHospitalId = req.user?.hospitalId ? String(req.user.hospitalId).trim() : '';

  if (isSuperAdminRole(role)) {
    req.hospitalId = rawHospitalId || null;
    return next();
  }

  if (!rawHospitalId) {
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

function withHospitalFilter(req, base = {}) {
  const filter = base && typeof base === 'object' ? { ...base } : {};
  const role = normalizeRole(req.user?.role);
  if (isSuperAdminRole(role)) return filter;
  if (!req.hospitalId) return { ...filter, hospitalId: '__missing_hospital__' };
  if (!Object.prototype.hasOwnProperty.call(filter, 'hospitalId')) {
    filter.hospitalId = req.hospitalId;
  }
  return filter;
}

function withHospitalPipeline(req, pipeline = []) {
  const stages = Array.isArray(pipeline) ? [...pipeline] : [];
  const role = normalizeRole(req.user?.role);
  if (isSuperAdminRole(role)) return stages;
  if (!req.hospitalId) return [{ $match: { hospitalId: '__missing_hospital__' } }, ...stages];
  const hasMatch = stages.some((stage) => stage?.$match && Object.prototype.hasOwnProperty.call(stage.$match, 'hospitalId'));
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
  isSuperAdminRole,
  withHospitalFilter,
  withHospitalPipeline,
};
