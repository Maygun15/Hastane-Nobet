const express = require('express');
const router = express.Router();
const {
  generateHolidays,
  listHolidays,
  upsertHoliday,
  deleteHoliday,
} = require('../services/holidayService');

// GET /api/holidays?y=2026&m=3
router.get('/', async (req, res) => {
  try {
    const year = Number(req.query.y || req.query.year);
    const month = req.query.m != null ? Number(req.query.m) : (req.query.month != null ? Number(req.query.month) : undefined);

    if (!Number.isFinite(year)) {
      return res.json({ items: [] });
    }

    const count = await listHolidays({ year });
    if (!count || count.length === 0) {
      await generateHolidays(year);
    }

    const items = await listHolidays({ year, month });
    return res.json({ items });
  } catch (err) {
    console.error('holidays list error:', err?.message || err);
    return res.status(500).json({ message: 'Tatil listesi alınamadı' });
  }
});

// GET /api/holidays/generate/:year
router.get('/generate/:year', async (req, res) => {
  try {
    const year = Number(req.params.year);
    const result = await generateHolidays(year);
    return res.json({ success: true, added: result.added, total: result.total });
  } catch (err) {
    console.error('holidays generate error:', err?.message || err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/holidays
router.post('/', async (req, res) => {
  try {
    const { date, kind, name } = req.body || {};
    const row = await upsertHoliday({ date, kind, name, source: 'manual' });
    return res.json({ ok: true, item: row });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
});

// DELETE /api/holidays/:date
router.delete('/:date', async (req, res) => {
  try {
    const date = req.params.date;
    const row = await deleteHoliday(date);
    return res.json({ ok: true, item: row });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
});

module.exports = router;
