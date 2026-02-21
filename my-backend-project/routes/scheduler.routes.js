// routes/scheduler.routes.js
const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/authz');
const { generateSchedule } = require('../services/schedulerService');

function parseBody(req) {
  const b = req.body || {};
  const sectionId = String(b.sectionId || '').trim();
  const serviceId = String(b.serviceId || '').trim();
  const role = String(b.role || '').trim();
  const year = Number(b.year);
  const month = Number(b.month);
  if (!sectionId) throw new Error('sectionId gerekli');
  if (!year || year < 2000) throw new Error('year geçersiz');
  if (!month || month < 1 || month > 12) throw new Error('month 1..12 aralığında olmalı');
  return { sectionId, serviceId, role, year, month, dryRun: !!b.dryRun, payload: b };
}

router.post('/generate', requireAuth, requireRole('admin', 'authorized'), async (req, res) => {
  try {
    const params = parseBody(req);
    const result = await generateSchedule({
      ...params,
      userId: req.user?.uid || null,
      payload: params.payload,
    });
    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[POST /api/scheduler/generate] ERR:', err);
    return res.status(400).json({ ok: false, message: err.message || 'Sunucu hatası' });
  }
});

module.exports = router;
