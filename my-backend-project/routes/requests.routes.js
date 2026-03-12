// routes/requests.routes.js
const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();
const Request = require('../models/Request');
const User = require('../models/User');
const Person = require('../models/Person');
const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
const safeMessage = (err, fallback = 'Sunucu hatası') =>
  isProd ? fallback : (err?.message || fallback);

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET tanımlı değil');
}

// Auth middleware
async function requireAuth(req, res, next) {
  try {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) return res.status(401).json({ message: 'Yetkisiz' });
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    const user = await User.findById(decoded.uid).lean();
    if (!user) return res.status(401).json({ message: 'Yetkisiz' });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ message: 'Yetkisiz' });
  }
}

function isAdminOrStaff(user) {
  const role = String(user?.role || '').toLowerCase();
  return role === 'admin' || role === 'staff';
}

// POST /api/requests — kullanıcı talep gönderir
router.post('/', requireAuth, async (req, res) => {
  try {
    const { type, targetDate, targetDateEnd, message, swapWithPersonId } = req.body;
    if (!type || !message) {
      return res.status(400).json({ message: 'Tür ve mesaj zorunlu' });
    }

    const person = await Person.findOne({ userId: req.user._id }).lean();

    const request = await Request.create({
      type,
      fromUserId:   req.user._id,
      fromPersonId: person?._id || null,
      fromName:     req.user.name || '',
      serviceId:    person?.serviceId || '',
      targetDate:   targetDate || '',
      targetDateEnd: targetDateEnd || '',
      swapWithPersonId: swapWithPersonId || null,
      message,
      status: 'pending',
    });

    res.json({ ok: true, request });
  } catch (err) {
    res.status(500).json({ message: safeMessage(err) });
  }
});

// GET /api/requests — kullanıcı kendi taleplerini, yetkili/admin tümünü görür
router.get('/', requireAuth, async (req, res) => {
  try {
    let filter = {};

    if (isAdminOrStaff(req.user)) {
      const role = String(req.user.role || '').toLowerCase();
      if (role === 'staff') {
        // Yetkili sadece kendi serviceId'lerini görür
        const serviceIds = Array.isArray(req.user.serviceIds)
          ? req.user.serviceIds.filter(Boolean)
          : [];
        if (serviceIds.length) {
          filter.serviceId = { $in: serviceIds };
        }
      }
      // Admin hiçbir filtre olmadan tümünü görür
    } else {
      // Normal kullanıcı sadece kendi taleplerini görür
      filter.fromUserId = req.user._id;
    }

    const requests = await Request.find(filter)
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    res.json({ items: requests });
  } catch (err) {
    res.status(500).json({ message: safeMessage(err) });
  }
});

// PUT /api/requests/:id — yetkili/admin onayla veya reddet
router.put('/:id', requireAuth, async (req, res) => {
  try {
    if (!isAdminOrStaff(req.user)) {
      return res.status(403).json({ message: 'Yetkiniz yok' });
    }

    const { status, adminNote } = req.body;
    if (!['approved', 'rejected', 'pending'].includes(status)) {
      return res.status(400).json({ message: 'Geçersiz durum' });
    }

    const request = await Request.findById(req.params.id);
    if (!request) return res.status(404).json({ message: 'Talep bulunamadı' });

    // Yetkili sadece kendi servisindeki talebi işleyebilir
    const role = String(req.user.role || '').toLowerCase();
    if (role === 'staff') {
      const serviceIds = Array.isArray(req.user.serviceIds)
        ? req.user.serviceIds.filter(Boolean)
        : [];
      if (serviceIds.length && !serviceIds.includes(request.serviceId)) {
        return res.status(403).json({ message: 'Bu talep sizin servisinize ait değil' });
      }
    }

    request.status = status;
    request.adminNote = adminNote || '';
    request.resolvedBy = req.user._id;
    request.resolvedAt = new Date();
    await request.save();

    res.json({ ok: true, request });
  } catch (err) {
    res.status(500).json({ message: safeMessage(err) });
  }
});

// GET /api/requests/unread-count — header'daki zil için
router.get('/unread-count', requireAuth, async (req, res) => {
  try {
    if (!isAdminOrStaff(req.user)) return res.json({ count: 0 });

    const role = String(req.user.role || '').toLowerCase();
    const filter = { status: 'pending' };

    if (role === 'staff') {
      const serviceIds = Array.isArray(req.user.serviceIds)
        ? req.user.serviceIds.filter(Boolean)
        : [];
      if (serviceIds.length) filter.serviceId = { $in: serviceIds };
    }

    const count = await Request.countDocuments(filter);
    res.json({ count });
  } catch {
    res.json({ count: 0 });
  }
});

module.exports = router;
