const AuditLog = require('../models/AuditLog');

function auditLogger(req, res, next) {
  res.on('finish', () => {
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
}

module.exports = auditLogger;
