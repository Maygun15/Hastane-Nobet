// routes/audit-logs.routes.js
const express = require('express');
const router = express.Router();
const AuditLog = require('../models/AuditLog');
const User = require('../models/User');
const mongoose = require('mongoose');
const { withHospitalFilter } = require('../middleware/hospital');

const SEGMENT_LABELS = {
  users:          'Kullanıcı',
  schedules:      'Çizelge',
  requests:       'Talep',
  services:       'Servis',
  people:         'Personel',
  personnel:      'Personel',
  settings:       'Ayarlar',
  notifications:  'Bildirim',
  'audit-logs':   'Denetim Günlüğü',
  parameters:     'Parametre',
  holiday:        'Tatil',
  holidays:       'Tatil',
  'duty-rules':   'Nöbet Kuralı',
  assignments:    'Görev',
  reports:        'Rapor',
  leaves:         'İzin',
  'leave-balances': 'İzin Bakiyesi',
  'leave-types':  'İzin Türü',
  plannings:      'Planlama',
  admin:          'Yönetim',
  auth:           'Kimlik Doğrulama',
  scheduler:      'Zamanlayıcı',
  'work-areas':   'Çalışma Alanı',
  'working-hours': 'Çalışma Saati',
  'schedule-rules': 'Çizelge Kuralı',
  'duty-rule':    'Nöbet Kuralı',
};

const METHOD_VERBS = {
  GET:    'listelendi',
  POST:   'oluşturuldu',
  PUT:    'güncellendi',
  PATCH:  'güncellendi',
  DELETE: 'silindi',
};

function buildDescription(method, endpoint, statusCode) {
  const success = !statusCode || statusCode < 400;
  const segment = String(endpoint || '').replace(/^\/api\//, '').split('/')[0];
  const label = SEGMENT_LABELS[segment] || segment || 'İşlem';
  if (!success) return `${label} işlemi başarısız (${statusCode})`;
  return `${label} ${METHOD_VERBS[method] || 'işlendi'}`;
}

// GET /api/audit-logs
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const search = String(req.query.search || '').trim();

    const filter = withHospitalFilter(req, {});
    if (search) {
      filter.$or = [
        { userId:   { $regex: search, $options: 'i' } },
        { endpoint: { $regex: search, $options: 'i' } },
      ];
    }

    const [logs, total] = await Promise.all([
      AuditLog.find(filter).sort({ createdAt: -1 }).limit(limit).lean(),
      AuditLog.countDocuments(filter),
    ]);

    // Resolve userId → name/email
    const uniqueIds = [
      ...new Set(
        logs
          .map((l) => l.userId)
          .filter((id) => id && id !== 'anonymous' && mongoose.Types.ObjectId.isValid(id)),
      ),
    ].map((id) => new mongoose.Types.ObjectId(id));

    const userMap = {};
    if (uniqueIds.length > 0) {
      const users = await User.find({ _id: { $in: uniqueIds } }).select('name email').lean();
      for (const u of users) userMap[String(u._id)] = u.name || u.email || null;
    }

    const result = logs.map((log) => ({
      _id:          log._id,
      timestamp:    log.createdAt,
      user:         userMap[log.userId] || (log.userId !== 'anonymous' ? log.userId : null),
      userId:       log.userId,
      endpoint:     log.endpoint,
      method:       log.method,
      statusCode:   log.statusCode,
      responseTime: log.responseTime,
      description:  buildDescription(log.method, log.endpoint, log.statusCode),
    }));

    res.json({ logs: result, total });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

module.exports = router;
