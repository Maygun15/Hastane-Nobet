// middleware/authz.js
function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Auth gerekli' });
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Auth gerekli' });
    if (roles.includes(req.user.role)) return next();
    return res.status(403).json({ error: 'Yetki yok' });
  };
}

// target serviceId => body/query/param içinden alınır
function sameServiceOrAdmin(req, res, next) {
  const me = req.user; // {_id, role, serviceIds: [..]}
  if (me?.role === 'admin' || me?.role === 'authorized') return next();

  const targetServiceId =
    req.targetServiceId ||
    req.body?.serviceId ||
    req.query?.serviceId ||
    req.params?.serviceId;

  if (me?.role === 'staff') {
    if (!targetServiceId) return res.status(400).json({ error: 'serviceId gerekli' });
    const has = Array.isArray(me.serviceIds) && me.serviceIds.includes(String(targetServiceId));
    if (!has) return res.status(403).json({ error: 'Servis kapsamı dışı' });
    return next();
  }
  return res.status(403).json({ error: 'Yetki yok' });
}

module.exports = { requireAuth, requireRole, sameServiceOrAdmin };
