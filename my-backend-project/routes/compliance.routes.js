'use strict';
// routes/compliance.routes.js — ComplianceGuard HTTP Katmanı

const express = require('express');
const router  = express.Router();
const { requireRole } = require('../middleware/authz');
const {
  checkMonthCompliance,
  runPrePublishCheck,
  loadConfig,
  saveConfig,
  DEFAULT_CONFIG,
} = require('../services/complianceEngine');

// GET /api/compliance/report?year=&month=
router.get('/report', requireRole('admin', 'authorized', 'staff'), async (req, res) => {
  try {
    const year  = Number(req.query.year)  || new Date().getFullYear();
    const month = Number(req.query.month) || new Date().getMonth() + 1;
    if (!req.hospitalId) return res.status(400).json({ ok: false, message: 'hospitalId gerekli' });

    const result = await checkMonthCompliance({ hospitalId: req.hospitalId, year, month });
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message });
  }
});

// POST /api/compliance/pre-publish-check
// Body: { year, month }
router.post('/pre-publish-check', requireRole('admin', 'authorized'), async (req, res) => {
  try {
    const { year, month } = req.body || {};
    if (!year || !month) return res.status(400).json({ ok: false, message: 'year ve month zorunlu' });
    if (!req.hospitalId) return res.status(400).json({ ok: false, message: 'hospitalId gerekli' });

    const result = await runPrePublishCheck({
      hospitalId: req.hospitalId,
      year:  Number(year),
      month: Number(month),
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message });
  }
});

// GET /api/compliance/config
router.get('/config', requireRole('admin', 'authorized'), async (req, res) => {
  try {
    if (!req.hospitalId) return res.status(400).json({ ok: false, message: 'hospitalId gerekli' });
    const config = await loadConfig(req.hospitalId);
    res.json({ ok: true, config, defaults: DEFAULT_CONFIG });
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message });
  }
});

// PUT /api/compliance/config
// Body: { weeklyMaxHours?, dailyMaxHours?, minRestHoursBetween?, maxConsecutiveDays?, nightShiftMonthlyLimit? }
router.put('/config', requireRole('admin'), async (req, res) => {
  try {
    if (!req.hospitalId) return res.status(400).json({ ok: false, message: 'hospitalId gerekli' });

    // Sadece sayısal değerleri kabul et
    const allowed = ['weeklyMaxHours', 'dailyMaxHours', 'minRestHoursBetween', 'maxConsecutiveDays', 'nightShiftMonthlyLimit'];
    const incoming = {};
    for (const key of allowed) {
      if (req.body[key] != null) {
        const val = Number(req.body[key]);
        if (Number.isFinite(val) && val >= 0) incoming[key] = val;
      }
    }

    const config = await saveConfig(req.hospitalId, incoming);
    res.json({ ok: true, config });
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message });
  }
});

module.exports = router;
