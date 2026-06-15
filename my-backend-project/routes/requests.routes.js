'use strict';
// routes/requests.routes.js — HTTP Katmanı (iş mantığı requestService.js içinde)

const express  = require('express');
const router   = express.Router();
const mongoose = require('mongoose');
const Request  = require('../models/Request');
const Person   = require('../models/Person');
const { withHospitalFilter, isSuperAdminRole } = require('../middleware/hospital');
const { sendNewRequestNotification } = require('../services/notificationService');
const { broadcastAll }    = require('../services/sseService');
const { suggestSwaps }    = require('../services/swapSuggestionService');
const Assignment          = require('../models/Assignment');
const {
  verifySwapCreationAssignments,
} = require('../services/swapRequestCreationService');
const {
  approveLeaveRequest,
  approveSwapRequest,
  rejectLeaveRequest,
  emitRequestUpdated,
  revertLeaveBalance,
  validateSwap,
} = require('../services/requestService');

const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
const safeMessage = (err, fallback = 'Sunucu hatası') =>
  isProd ? fallback : (err?.message || fallback);

const REQUEST_STATUS     = new Set(['pending', 'approved', 'rejected', 'deleted']);
const SOFT_DELETE_KEEP_DAYS = 180;

/* ─── HTTP yardımcıları (route'lara özgü) ─── */

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ message: 'Yetkisiz' });
  if (!req.hospitalId && !isSuperAdminRole(req.user?.role)) {
    return res.status(403).json({ message: 'hospitalId gerekli' });
  }
  return next();
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

/* ─── Rotalar ─── */

// POST /api/requests — kullanıcı talep gönderir
router.post('/', requireAuth, async (req, res) => {
  try {
    const {
      type, targetDate, targetDateEnd, message, swapWithPersonId,
      leaveTypeCode,
      swapMyAssignmentId, swapTargetAssignmentId,
      swapSectionId, swapMyDate, swapMyShiftId, swapMyShiftLabel,
      swapTargetDate, swapTargetShiftId, swapTargetShiftLabel,
      swapWithPersonName,
    } = req.body;

    if (!type || !message) return res.status(400).json({ message: 'Tür ve mesaj zorunlu' });
    if (type === 'takas' && (!swapMyAssignmentId || !swapTargetAssignmentId)) {
      return res.status(400).json({
        ok: false,
        code: 'SWAP_ASSIGNMENT_SELECTION_REQUIRED',
        message: 'Both swap shifts must be selected from verified assignments.',
      });
    }

    const person = await Person.findOne(withHospitalFilter(req, { userId: req.user._id })).lean();
    let verifiedSwapFields = {};
    if (type === 'takas') {
      try {
        const verified = await verifySwapCreationAssignments({
          hospitalId: req.hospitalId,
          requesterPersonId: person?._id,
          swapWithPersonId,
          swapMyAssignmentId,
          swapTargetAssignmentId,
          swapMyDate,
          swapTargetDate,
          swapMyShiftId,
          swapTargetShiftId,
        });
        verifiedSwapFields = verified.requestFields;
      } catch (error) {
        if (error?.status === 400 && error?.code) {
          return res.status(400).json({
            ok: false,
            code: error.code,
            message: error.message,
          });
        }
        throw error;
      }
    }

    const request = await Request.create(withHospitalFilter(req, {
      type,
      fromUserId:   req.user._id,
      fromPersonId: person?._id || null,
      fromName:     req.user.name || '',
      serviceId:    type === 'takas' ? verifiedSwapFields.serviceId : (person?.serviceId || ''),
      role:         type === 'takas' ? verifiedSwapFields.role : '',
      targetDate:   targetDate || '',
      targetDateEnd: targetDateEnd || '',
      swapWithPersonId:     verifiedSwapFields.swapWithPersonId || swapWithPersonId || null,
      swapWithPersonName:   verifiedSwapFields.swapWithPersonName || String(swapWithPersonName || '').trim(),
      leaveTypeCode:        String(leaveTypeCode || '').trim().toUpperCase(),
      swapMyAssignmentId:   verifiedSwapFields.swapMyAssignmentId || null,
      swapTargetAssignmentId: verifiedSwapFields.swapTargetAssignmentId || null,
      swapSectionId:        verifiedSwapFields.swapSectionId || String(swapSectionId || '').trim(),
      swapMyDate:           verifiedSwapFields.swapMyDate || String(swapMyDate || '').slice(0, 10),
      swapMyShiftId:        verifiedSwapFields.swapMyShiftId || String(swapMyShiftId || '').trim(),
      swapMyShiftLabel:     verifiedSwapFields.swapMyShiftLabel || String(swapMyShiftLabel || '').trim(),
      swapTargetDate:       verifiedSwapFields.swapTargetDate || String(swapTargetDate || '').slice(0, 10),
      swapTargetShiftId:    verifiedSwapFields.swapTargetShiftId || String(swapTargetShiftId || '').trim(),
      swapTargetShiftLabel: verifiedSwapFields.swapTargetShiftLabel || String(swapTargetShiftLabel || '').trim(),
      message,
      status: 'pending',
    }));

    void sendNewRequestNotification({ request, senderName: req.user?.name || '' }).catch(() => {});
    res.json({ ok: true, request });
  } catch (err) {
    res.status(500).json({ message: safeMessage(err) });
  }
});

// GET /api/requests/swap-shifts
router.get('/swap-shifts', requireAuth, async (req, res) => {
  try {
    const { personId, date } = req.query;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
      return res.status(400).json({ message: 'Geçerli tarih (YYYY-MM-DD) zorunlu' });
    }
    let queryPid = personId ? String(personId).trim() : null;
    if (!queryPid) {
      const myPerson = await Person.findOne(withHospitalFilter(req, { userId: req.user._id })).lean();
      queryPid = myPerson ? String(myPerson._id) : null;
    }
    if (!queryPid) return res.json({ items: [] });

    const items = await Assignment.find(
      withHospitalFilter(req, { date: String(date), personId: queryPid })
    )
      .select('_id sourceScheduleId sectionId serviceId role year month date rowId shiftId shiftCode roleLabel personId personName')
      .limit(20)
      .lean();

    res.json({ items });
  } catch (err) {
    res.status(500).json({ message: safeMessage(err) });
  }
});

// GET /api/requests
router.get('/', requireAuth, async (req, res) => {
  try {
    const statusFilter = parseStatusFilter(req.query?.status);
    let filter = {};

    if (isAdminOrStaff(req.user)) {
      const role = String(req.user.role || '').toLowerCase();
      if (role === 'staff') {
        const serviceIds = Array.isArray(req.user.serviceIds) ? req.user.serviceIds.filter(Boolean) : [];
        if (serviceIds.length) filter.serviceId = { $in: serviceIds };
      }
    } else {
      const myPerson = await Person.findOne(withHospitalFilter(req, { userId: req.user._id })).lean();
      if (myPerson?._id) {
        filter = { $or: [{ fromUserId: req.user._id }, { swapWithPersonId: myPerson._id }] };
      } else {
        filter.fromUserId = req.user._id;
      }
    }
    if (statusFilter) filter.status = statusFilter;

    const requests = await Request.find(withHospitalFilter(req, filter))
      .sort({ createdAt: -1 }).limit(200).lean();

    res.json({ items: requests });
  } catch (err) {
    res.status(500).json({ message: safeMessage(err) });
  }
});

// PUT /api/requests/:id
router.put('/:id', requireAuth, async (req, res) => {
  try {
    if (!isAdminOrStaff(req.user)) return res.status(403).json({ message: 'Yetkiniz yok' });

    const { status, adminNote, forceSwap = false } = req.body;
    if (!['approved', 'rejected', 'pending'].includes(status)) {
      return res.status(400).json({ message: 'Geçersiz durum' });
    }

    let request = await Request.findOne(withHospitalFilter(req, { _id: req.params.id }));
    if (!request) return res.status(404).json({ message: 'Talep bulunamadı' });
    if (String(request.status || '') === 'deleted') return res.status(409).json({ message: 'Silinmiş talep güncellenemez' });

    const role = String(req.user.role || '').toLowerCase();
    if (role === 'staff') {
      const serviceIds = Array.isArray(req.user.serviceIds) ? req.user.serviceIds.filter(Boolean).map(String) : [];
      if (serviceIds.length && !serviceIds.includes(String(request.serviceId))) {
        return res.status(403).json({ message: 'Bu talep sizin servisinize ait değil' });
      }
    }

    const previousStatus = String(request.status || 'pending');
    const requestType    = String(request.type || '').toLowerCase();
    const isLeave        = requestType === 'izin';
    const isSwap         = requestType === 'takas';
    const hasChange      = previousStatus !== String(status);
    const actorName      = req.user?.name || req.user?.email || 'Yetkili';
    const actorUserId    = req.user._id;

    // İzin onayı — service'e delege et
    if (isLeave && hasChange && status === 'approved') {
      const result = await approveLeaveRequest({ req, request, adminNote: adminNote || '', actorUserId, actorName });
      if (!result.ok) return res.status(result.httpStatus || 500).json({ message: result.message });
      return res.json({ ok: true, request: result.request });
    }

    // Takas onayı — service'e delege et
    if (isSwap && hasChange && status === 'approved' && !request.swapExecuted) {
      const result = await approveSwapRequest({ req, request, adminNote: adminNote || '', actorUserId, actorName, forceSwap, previousStatus });
      if (!result.ok) {
        return res.status(result.httpStatus || 500).json({
          ok: false,
          ...(result.code ? { code: result.code } : {}),
          message: result.message,
          ...(result.violations ? { violations: result.violations, canForce: result.canForce } : {}),
        });
      }
      return res.json({ ok: true, request: result.request });
    }

    // İzin reddi — service'e delege et
    if (isLeave && hasChange && status === 'rejected') {
      const result = await rejectLeaveRequest({ req, request, adminNote: adminNote || '', actorUserId, actorName, previousStatus });
      if (!result.ok) return res.status(result.httpStatus || 500).json({ message: result.message });
      return res.json({ ok: true, request: result.request });
    }

    // Genel durum güncelleme (pending dönüşü, takas reddi vb.)
    const updatedRequest = await Request.findOneAndUpdate(
      withHospitalFilter(req, { _id: req.params.id, status: previousStatus }),
      { $set: { status, adminNote: adminNote || '', resolvedBy: actorUserId, resolvedAt: new Date() } },
      { new: true }
    );
    if (!updatedRequest) return res.status(409).json({ message: 'Talep durumu değişti, lütfen sayfayı yenileyin' });
    request = updatedRequest;

    void emitRequestUpdated(request, status);

    // Onaylanmış izin geri pending'e alındı → bakiyeyi geri al
    if (isLeave && hasChange && status === 'pending' && previousStatus === 'approved') {
      void broadcastAll('leaves:refresh', {});
      void revertLeaveBalance(request).catch((e) => console.error('[leave-balance-revert]', e?.message));
    }

    res.json({ ok: true, request });
  } catch (err) {
    res.status(500).json({ message: safeMessage(err) });
  }
});

// DELETE /api/requests/:id
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const request = await Request.findOne(withHospitalFilter(req, { _id: req.params.id }));
    if (!request) return res.status(404).json({ message: 'Talep bulunamadı' });

    const userIsManager = isAdminOrStaff(req.user);
    const isOwner = String(request.fromUserId || '') === String(req.user?._id || '');
    if (!userIsManager && !isOwner) return res.status(403).json({ message: 'Bu talebi silme yetkiniz yok' });

    const role = String(req.user.role || '').toLowerCase();
    if (userIsManager && role === 'staff') {
      const serviceIds = Array.isArray(req.user.serviceIds) ? req.user.serviceIds.filter(Boolean).map(String) : [];
      if (serviceIds.length && !serviceIds.includes(String(request.serviceId))) {
        return res.status(403).json({ message: 'Bu talep sizin servisinize ait değil' });
      }
    }

    if (String(request.status || '') === 'deleted') return res.json({ ok: true, request });

    const now     = new Date();
    const keepMs  = SOFT_DELETE_KEEP_DAYS * 24 * 60 * 60 * 1000;
    const reason  = String(req.body?.reason || '').trim().slice(0, 500);

    request.status        = 'deleted';
    request.deletedAt     = now;
    request.deletedBy     = req.user._id;
    request.deletedReason = reason;
    request.purgeAt       = new Date(now.getTime() + keepMs);
    request.resolvedBy    = req.user._id;
    request.resolvedAt    = now;
    await request.save();

    res.json({ ok: true, request });
  } catch (err) {
    res.status(500).json({ message: safeMessage(err) });
  }
});

// GET /api/requests/swap-suggestions
router.get('/swap-suggestions', requireAuth, async (req, res) => {
  try {
    const { personId, currentPersonName, date, shiftId, sectionId, serviceId, role, roleLabel, limit } = req.query;
    if (!date || !shiftId) return res.status(400).json({ message: 'date ve shiftId zorunlu' });
    const result = await suggestSwaps({
      personId:          personId || null,
      currentPersonName: String(currentPersonName || ''),
      date:              String(date).slice(0, 10),
      shiftId:           String(shiftId),
      roleLabel:         String(roleLabel || ''),
      serviceId:         String(serviceId || ''),
      role:              String(role || ''),
      sectionId:         String(sectionId || ''),
      hospitalId:        req.hospitalId,
      limit:             Math.min(50, Number(limit) || 10),
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: safeMessage(err) });
  }
});

// POST /api/requests/:id/peer-response
router.post('/:id/peer-response', requireAuth, async (req, res) => {
  try {
    const { accepted, note } = req.body;
    if (typeof accepted !== 'boolean' && accepted !== 'true' && accepted !== 'false') {
      return res.status(400).json({ message: 'accepted alanı zorunlu (boolean)' });
    }
    const isAccepted = accepted === true || accepted === 'true';
    const myPerson = await Person.findOne(withHospitalFilter(req, { userId: req.user._id })).lean();
    if (!myPerson) return res.status(403).json({ message: 'Personel kaydınız bulunamadı' });

    const request = await Request.findOne(
      withHospitalFilter(req, { _id: req.params.id, type: 'takas', swapWithPersonId: myPerson._id })
    );
    if (!request)                  return res.status(404).json({ message: 'Talep bulunamadı' });
    if (request.status !== 'pending')     return res.status(409).json({ message: 'Talep artık beklemede değil' });
    if (request.peerStatus !== 'pending') return res.status(409).json({ message: 'Bu talebi zaten yanıtladınız' });

    const peerStatus = isAccepted ? 'accepted' : 'rejected';
    const peerNote   = String(note || '').trim().slice(0, 500);

    const updated = await Request.findOneAndUpdate(
      withHospitalFilter(req, { _id: req.params.id, peerStatus: 'pending' }),
      { $set: { peerStatus, peerRespondedAt: new Date(), peerNote } },
      { new: true }
    );
    if (!updated) return res.status(409).json({ message: 'Durum değişti, sayfayı yenileyin' });

    if (!isAccepted) {
      await Request.updateOne(
        withHospitalFilter(req, { _id: req.params.id }),
        { $set: { status: 'rejected', adminNote: peerNote ? `Karşı taraf reddetti: ${peerNote}` : 'Karşı taraf reddetti', resolvedAt: new Date() } }
      );
      updated.status = 'rejected';
    } else {
      void sendNewRequestNotification({ request: updated, senderName: req.user?.name || '' }).catch(() => {});
    }

    res.json({ ok: true, request: updated });
  } catch (err) {
    res.status(500).json({ message: safeMessage(err) });
  }
});

// GET /api/requests/unread-count
router.get('/unread-count', requireAuth, async (req, res) => {
  try {
    if (!isAdminOrStaff(req.user)) return res.json({ count: 0 });
    const role   = String(req.user.role || '').toLowerCase();
    const filter = { status: 'pending' };
    if (role === 'staff') {
      const serviceIds = Array.isArray(req.user.serviceIds) ? req.user.serviceIds.filter(Boolean) : [];
      if (serviceIds.length) filter.serviceId = { $in: serviceIds };
    }
    const count = await Request.countDocuments(withHospitalFilter(req, filter));
    res.json({ count });
  } catch {
    res.json({ count: 0 });
  }
});

module.exports = router;
