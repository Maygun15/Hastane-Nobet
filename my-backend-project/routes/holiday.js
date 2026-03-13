const express = require('express');
const router = express.Router();
const { requireRole } = require('../middleware/authz');
const {
  generateHolidays,
  listHolidays,
  upsertHoliday,
  deleteHoliday,
} = require('../services/holidayService');
const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
const safeMessage = (err, fallback = 'Sunucu hatası') =>
  isProd ? fallback : (err?.message || fallback);

// GET /api/holidays?y=2026&m=3
router.get('/', async (req, res) => {
  try {
    const year = Number(req.query.y || req.query.year);
    const month = req.query.m != null ? Number(req.query.m) : (req.query.month != null ? Number(req.query.month) : undefined);

    if (!Number.isFinite(year)) {
      return res.json({ items: [] });
    }

    const count = await listHolidays({ year, hospitalId: req.hospitalId });
    if (!count || count.length === 0) {
      await generateHolidays(year, { hospitalId: req.hospitalId });
    }

    const items = await listHolidays({ year, month, hospitalId: req.hospitalId });
    return res.json({ items });
  } catch (err) {
    console.error('holidays list error:', err?.message || err);
    return res.status(500).json({ message: 'Tatil listesi alınamadı' });
  }
});

// GET /api/holidays/generate/:year
router.get('/generate/:year', requireRole('admin', 'staff'), async (req, res) => {
  try {
    const year = Number(req.params.year);
    const result = await generateHolidays(year, { hospitalId: req.hospitalId });
    return res.json({ success: true, added: result.added, total: result.total });
  } catch (err) {
    console.error('holidays generate error:', err?.message || err);
    return res.status(500).json({ success: false, message: safeMessage(err) });
  }
});

// POST /api/holidays
router.post('/', requireRole('admin', 'staff'), async (req, res) => {
  try {
    const { date, kind, name } = req.body || {};
    const row = await upsertHoliday({ date, kind, name, source: 'manual', hospitalId: req.hospitalId });
    return res.json({ ok: true, item: row });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
});

// DELETE /api/holidays/:date
router.delete('/:date', requireRole('admin', 'staff'), async (req, res) => {
  try {
    const date = req.params.date;
    const row = await deleteHoliday(date, { hospitalId: req.hospitalId });
    return res.json({ ok: true, item: row });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
});

module.exports = router;
