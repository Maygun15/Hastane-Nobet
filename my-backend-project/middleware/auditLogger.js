const AuditLog = require('../models/AuditLog');

module.exports = async function auditLogger(req, res, next) {
  // noise filter
  if (req.method === 'OPTIONS') return next();
  if (req.path === '/health' || req.path === '/api/health') return next();

  res.on('finish', async () => {
    const userId = req.user
      ? String(req.user.id || req.user._id || req.user.uid || 'anonymous')
      : 'anonymous';

    AuditLog.create({
      userId,
      action: `${req.method} ${req.path}`,
      endpoint: req.path,
      method: req.method,
      ip: req.ip,
      requestId: req.requestId || '',
    }).catch((err) => {
      console.error('[auditLogger]', err?.message || err);
    });
  });

  next();
};
