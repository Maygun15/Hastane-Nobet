const AuditLog = require('../models/AuditLog');

const SENSITIVE_KEYS = new Set(['password', 'token', 'secret', 'accessToken', 'refreshToken', 'authorization', 'tc', 'tckn', 'nationalId', 'passwordHash']);

function sanitizeBody(body) {
  if (!body || typeof body !== 'object') return undefined;
  const out = {};
  for (const [k, v] of Object.entries(body)) {
    out[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? '[REDACTED]' : v;
  }
  return out;
}

module.exports = async function auditLogger(req, res, next) {
  if (req.method === 'OPTIONS') return next();
  if (req.path === '/health' || req.path === '/api/health') return next();

  const startTime = Date.now();

  res.on('finish', async () => {
    const userId = req.user
      ? String(req.user.id || req.user._id || req.user.uid || 'anonymous')
      : 'anonymous';

    const body = sanitizeBody(req.body);

    AuditLog.create({
      userId,
      action:       `${req.method} ${req.path}`,
      endpoint:     req.path,
      method:       req.method,
      statusCode:   res.statusCode,
      responseTime: Date.now() - startTime,
      ip:           req.ip,
      requestId:    req.requestId || '',
      changes:      body && Object.keys(body).length ? { body } : null,
    }).catch((err) => {
      console.error('[auditLogger]', err?.message || err);
    });
  });

  next();
};
