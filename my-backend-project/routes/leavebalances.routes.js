// routes/leavebalances.routes.js
const express = require('express');
const router = express.Router();
const LeaveBalance = require('../models/LeaveBalance');
const { requireAuth, requireRole } = require('../middleware/authz');

// GET / — Bakiyeleri getir (isteğe bağlı ?personId=&year=&page=&limit= filtresi)
router.get('/', requireAuth, requireRole('admin', 'authorized', 'staff'), async (req, res) => {
  try {
    const filter = {};
    if (req.query.personId) filter.personId = String(req.query.personId).trim();
    if (req.query.year) filter.year = Number(req.query.year);

    const page  = Math.max(1, Number(req.query.page)  || 1);
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
    const skip  = (page - 1) * limit;

    const [items, total] = await Promise.all([
      LeaveBalance.find(filter).sort({ personName: 1, leaveTypeName: 1 }).skip(skip).limit(limit).lean(),
      LeaveBalance.countDocuments(filter),
    ]);
    return res.json({ ok: true, items, total, page, limit });
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
});

// GET /summary?year= — Tüm personel için o yılın bakiye özeti
router.get('/summary', requireAuth, requireRole('admin', 'authorized', 'staff'), async (req, res) => {
  try {
    const year  = req.query.year ? Number(req.query.year) : new Date().getFullYear();
    const page  = Math.max(1, Number(req.query.page)  || 1);
    const limit = Math.min(1000, Math.max(1, Number(req.query.limit) || 500));
    const skip  = (page - 1) * limit;

    const [items, total] = await Promise.all([
      LeaveBalance.find({ year }).sort({ personName: 1, leaveTypeName: 1 }).skip(skip).limit(limit).lean(),
      LeaveBalance.countDocuments({ year }),
    ]);
    return res.json({ ok: true, year, items, total, page, limit });
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
});

// POST / — Yeni bakiye oluştur
router.post('/', requireAuth, requireRole('admin', 'authorized'), async (req, res) => {
  try {
    const { personId, personName, leaveTypeId, leaveTypeName, year, allocated } = req.body || {};
    if (!personId || !leaveTypeId || !year) {
      return res.status(400).json({ message: 'personId, leaveTypeId ve year zorunludur' });
    }
    const alloc = Number(allocated) || 0;
    const doc = await LeaveBalance.create({
      personId: String(personId).trim(),
      personName: String(personName || '').trim(),
      leaveTypeId: String(leaveTypeId).trim(),
      leaveTypeName: String(leaveTypeName || '').trim(),
      year: Number(year),
      allocated: alloc,
      used: 0,
      remaining: alloc,
    });
    return res.status(201).json({ ok: true, item: doc });
  } catch (e) {
    if (e.code === 11000) {
      return res.status(409).json({ message: 'Bu personel ve izin türü için bu yıla ait bakiye zaten mevcut' });
    }
    return res.status(500).json({ message: e.message });
  }
});

// PUT /:id — Bakiye güncelle (allocated değiştirme)
router.put('/:id', requireAuth, requireRole('admin', 'authorized'), async (req, res) => {
  try {
    const { allocated, personName, leaveTypeName } = req.body || {};
    const updateFields = {};
    if (allocated !== undefined) {
      const alloc = Number(allocated);
      updateFields.allocated = alloc;
    }
    if (personName !== undefined) updateFields.personName = String(personName).trim();
    if (leaveTypeName !== undefined) updateFields.leaveTypeName = String(leaveTypeName).trim();

    const doc = await LeaveBalance.findByIdAndUpdate(
      req.params.id,
      { $set: updateFields },
      { new: true }
    ).lean();

    if (!doc) return res.status(404).json({ message: 'Bakiye kaydı bulunamadı' });

    // remaining'i allocated - used olarak hesapla ve güncelle
    if (allocated !== undefined) {
      const updated = await LeaveBalance.findByIdAndUpdate(
        req.params.id,
        { $set: { remaining: doc.allocated - doc.used } },
        { new: true }
      ).lean();
      return res.json({ ok: true, item: updated });
    }

    return res.json({ ok: true, item: doc });
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
});

// DELETE /:id — Bakiye sil
router.delete('/:id', requireAuth, requireRole('admin', 'authorized'), async (req, res) => {
  try {
    const doc = await LeaveBalance.findByIdAndDelete(req.params.id).lean();
    if (!doc) return res.status(404).json({ message: 'Bakiye kaydı bulunamadı' });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
});

// PATCH /:id/use — Kullanım kaydı: body: { days: 1 }
router.patch('/:id/use', requireAuth, requireRole('admin', 'authorized', 'staff'), async (req, res) => {
  try {
    const days = Number(req.body?.days);
    if (!Number.isFinite(days) || days === 0) {
      return res.status(400).json({ message: 'days alanı zorunlu ve sıfırdan farklı olmalıdır' });
    }
    const current = await LeaveBalance.findById(req.params.id).lean();
    if (!current) return res.status(404).json({ message: 'Bakiye kaydı bulunamadı' });

    const newUsed = current.used + days;
    const newRemaining = current.allocated - newUsed;

    const updated = await LeaveBalance.findByIdAndUpdate(
      req.params.id,
      { $set: { used: newUsed, remaining: newRemaining } },
      { new: true }
    ).lean();

    return res.json({ ok: true, item: updated });
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
});

module.exports = router;
