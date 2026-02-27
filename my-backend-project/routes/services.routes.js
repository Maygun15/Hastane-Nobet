// routes/services.routes.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

// Inline schema — ayrı model dosyası açmak istemedik
const serviceSchema = new mongoose.Schema({
  name:   { type: String, required: true, trim: true },
  code:   { type: String, required: true, trim: true, uppercase: true },
  active: { type: Boolean, default: true },
}, { timestamps: true });
serviceSchema.index({ code: 1 }, { unique: true });

const Service = mongoose.models.Service || mongoose.model('Service', serviceSchema);

// GET /api/services  — herkese açık (auth zaten index.js'de)
router.get('/', async (req, res) => {
  try {
    const filter = {};
    if (req.query.active !== undefined) filter.active = req.query.active !== 'false';
    const items = await Service.find(filter).sort({ name: 1 }).lean();
    res.json({ ok: true, data: items });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/services  — sadece admin/authorized
router.post('/', async (req, res) => {
  const role = req.user?.role;
  if (!['admin', 'authorized'].includes(role))
    return res.status(403).json({ ok: false, error: 'Yetersiz yetki' });
  try {
    const { name, code, active } = req.body;
    if (!name || !code) return res.status(400).json({ ok: false, error: 'name ve code zorunlu' });
    const item = await Service.create({ name, code: code.toUpperCase(), active: active !== false });
    res.status(201).json({ ok: true, data: item });
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ ok: false, error: 'Bu kod zaten var' });
    res.status(500).json({ ok: false, error: e.message });
  }
});

// PATCH /api/services/:id
router.patch('/:id', async (req, res) => {
  const role = req.user?.role;
  if (!['admin', 'authorized'].includes(role))
    return res.status(403).json({ ok: false, error: 'Yetersiz yetki' });
  try {
    const patch = {};
    if (req.body.name  !== undefined) patch.name   = req.body.name;
    if (req.body.code  !== undefined) patch.code   = req.body.code.toUpperCase();
    if (req.body.active !== undefined) patch.active = req.body.active;
    const item = await Service.findByIdAndUpdate(req.params.id, patch, { new: true }).lean();
    if (!item) return res.status(404).json({ ok: false, error: 'Bulunamadı' });
    res.json({ ok: true, data: item });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// DELETE /api/services/:id
router.delete('/:id', async (req, res) => {
  const role = req.user?.role;
  if (role !== 'admin')
    return res.status(403).json({ ok: false, error: 'Sadece admin silebilir' });
  try {
    await Service.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
