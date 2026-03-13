// routes/requests.routes.js
const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();
const Request = require('../models/Request');
const User = require('../models/User');
const Person = require('../models/Person');
const {
  sendLeaveApproved,
  sendLeaveRejected,
} = require('../services/notificationService');
const { withHospitalFilter, isSuperAdminRole } = require('../middleware/hospital');
const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
const safeMessage = (err, fallback = 'Sunucu hatası') =>
  isProd ? fallback : (err?.message || fallback);
const REQUEST_STATUS = new Set(['pending', 'approved', 'rejected', 'deleted']);
const SOFT_DELETE_KEEP_DAYS = 180;

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
    const role = String(user?.role || '').toLowerCase();
    if (!isSuperAdminRole(role) && !user?.hospitalId) {
      return res.status(403).json({ message: 'hospitalId gerekli' });
    }
    req.user = user;
    req.hospitalId = user?.hospitalId ? String(user.hospitalId) : null;
    next();
  } catch {
    res.status(401).json({ message: 'Yetkisiz' });
  }
}

function isAdminOrStaff(user) {
  const role = String(user?.role || '').toLowerCase();
  return role === 'admin' || role === 'staff';
}

function parseStatusFilter(status) {
  const value = String(status || '').trim().toLowerCase();
  if (!value || value === 'all') return null;
  return REQUEST_STATUS.has(value) ? value : null;
}

// POST /api/requests — kullanıcı talep gönderir
router.post('/', requireAuth, async (req, res) => {
  try {
    const { type, targetDate, targetDateEnd, message, swapWithPersonId } = req.body;
    if (!type || !message) {
      return res.status(400).json({ message: 'Tür ve mesaj zorunlu' });
    }

    const person = await Person.findOne(withHospitalFilter(req, { userId: req.user._id })).lean();

    const request = await Request.create(withHospitalFilter(req, {
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
    }));

    res.json({ ok: true, request });
  } catch (err) {
    res.status(500).json({ message: safeMessage(err) });
  }
});

// GET /api/requests — kullanıcı kendi taleplerini, yetkili/admin tümünü görür
router.get('/', requireAuth, async (req, res) => {
  try {
    const statusFilter = parseStatusFilter(req.query?.status);
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
    if (statusFilter) filter.status = statusFilter;

    const requests = await Request.find(withHospitalFilter(req, filter))
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

    const request = await Request.findOne(withHospitalFilter(req, { _id: req.params.id }));
    if (!request) return res.status(404).json({ message: 'Talep bulunamadı' });
    if (String(request.status || '') === 'deleted') {
      return res.status(409).json({ message: 'Silinmiş talep güncellenemez' });
    }

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

    const previousStatus = String(request.status || 'pending');
    request.status = status;
    request.adminNote = adminNote || '';
    request.resolvedBy = req.user._id;
    request.resolvedAt = new Date();
    await request.save();

    const isLeaveRequest = String(request.type || '').toLowerCase() === 'izin';
    const hasStatusChange = previousStatus !== String(status);
    const actorName = req.user?.name || req.user?.email || 'Yetkili';
    if (isLeaveRequest && hasStatusChange && status === 'approved') {
      void sendLeaveApproved({ request, actorName }).catch((notifyErr) => {
        console.error('[notify][leave-approved] ERR:', notifyErr?.message || notifyErr);
      });
    } else if (isLeaveRequest && hasStatusChange && status === 'rejected') {
      void sendLeaveRejected({ request, actorName }).catch((notifyErr) => {
        console.error('[notify][leave-rejected] ERR:', notifyErr?.message || notifyErr);
      });
    }

    res.json({ ok: true, request });
  } catch (err) {
    res.status(500).json({ message: safeMessage(err) });
  }
});

// DELETE /api/requests/:id — soft delete (180 gün sonra otomatik temizlenir)
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const request = await Request.findOne(withHospitalFilter(req, { _id: req.params.id }));
    if (!request) return res.status(404).json({ message: 'Talep bulunamadı' });

    const userIsManager = isAdminOrStaff(req.user);
    const isOwner = String(request.fromUserId || '') === String(req.user?._id || '');

    if (!userIsManager && !isOwner) {
      return res.status(403).json({ message: 'Bu talebi silme yetkiniz yok' });
    }

    const role = String(req.user.role || '').toLowerCase();
    if (userIsManager && role === 'staff') {
      const serviceIds = Array.isArray(req.user.serviceIds)
        ? req.user.serviceIds.filter(Boolean)
        : [];
      if (serviceIds.length && !serviceIds.includes(request.serviceId)) {
        return res.status(403).json({ message: 'Bu talep sizin servisinize ait değil' });
      }
    }

    if (String(request.status || '') === 'deleted') {
      return res.json({ ok: true, request });
    }

    const now = new Date();
    const keepMs = SOFT_DELETE_KEEP_DAYS * 24 * 60 * 60 * 1000;
    const reason = String(req.body?.reason || '').trim().slice(0, 500);

    request.status = 'deleted';
    request.deletedAt = now;
    request.deletedBy = req.user._id;
    request.deletedReason = reason;
    request.purgeAt = new Date(now.getTime() + keepMs);
    request.resolvedBy = req.user._id;
    request.resolvedAt = now;
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

    const count = await Request.countDocuments(withHospitalFilter(req, filter));
    res.json({ count });
  } catch {
    res.json({ count: 0 });
  }
});

module.exports = router;
