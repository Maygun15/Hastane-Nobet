// routes/requests.routes.js
const express = require('express');
const router = express.Router();
const Request = require('../models/Request');
const Person = require('../models/Person');
const MonthlySchedule = require('../models/MonthlySchedule');
const Setting = require('../models/Setting');
const LeaveBalance = require('../models/LeaveBalance');
const LeaveType = require('../models/LeaveType');
const {
  sendLeaveApproved,
  sendLeaveRejected,
  sendShiftChanged,
  sendNewRequestNotification,
} = require('../services/notificationService');
const { replaceAssignmentsForSchedule } = require('../services/assignmentSyncService');
const { suggestSwaps } = require('../services/swapSuggestionService');
const { withHospitalFilter, isSuperAdminRole } = require('../middleware/hospital');
const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
const safeMessage = (err, fallback = 'Sunucu hatası') =>
  isProd ? fallback : (err?.message || fallback);
const REQUEST_STATUS = new Set(['pending', 'approved', 'rejected', 'deleted']);
const SOFT_DELETE_KEEP_DAYS = 180;

/* ── İzin onaylandığında leaves/Setting'e yaz ── */
async function applyLeaveRange(request) {
  const { fromPersonId, targetDate, targetDateEnd, serviceId, message, leaveTypeCode } = request;
  if (!fromPersonId || !targetDate) return;

  const leaveCode = String(leaveTypeCode || 'YILLIK').trim().toUpperCase();
  const start = new Date(`${String(targetDate).slice(0, 10)}T00:00:00`);
  const end   = new Date(`${String(targetDateEnd || targetDate).slice(0, 10)}T00:00:00`);
  if (isNaN(start) || isNaN(end) || end < start) return;
  const MAX_LEAVE_DAYS = 365;
  const dayDiff = Math.round((end - start) / 86_400_000);
  if (dayDiff >= MAX_LEAVE_DAYS) return; // inclusive günler 365'i aşmamalı

  // Günleri aya göre grupla
  const byMonth = {};
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const day = d.getDate();
    const mk = `${y}-${String(m).padStart(2, '0')}`;
    (byMonth[mk] ??= []).push(day);
  }

  const pid = String(fromPersonId);
  const sid = String(serviceId || '');

  for (const [monthKey, days] of Object.entries(byMonth)) {
    // hospitalScope plugin otomatik hospitalId ekler
    let doc = await Setting.findOne({ key: 'leavesV2', serviceId: sid });
    if (!doc) {
      doc = new Setting({ key: 'leavesV2', serviceId: sid, value: {} });
    }
    const value = doc.value && typeof doc.value === 'object' ? { ...doc.value } : {};
    value[pid] ??= {};
    value[pid][monthKey] ??= {};
    const entry = message ? { code: leaveCode, note: String(message).slice(0, 200) } : { code: leaveCode };
    for (const day of days) value[pid][monthKey][String(day)] = entry;
    doc.value = value;
    doc.markModified('value');
    await doc.save();
  }

  // LeaveBalance güncelle — atomik $inc ile race condition önlenir
  try {
    const totalDays = Math.round((end - start) / 86_400_000) + 1;
    const year = start.getFullYear();
    const hid = request.hospitalId;
    if (!hid) throw new Error('hospitalId zorunlu (izin bakiyesi)');


    const leaveType = await LeaveType.findOne({ hospitalId: hid, code: leaveCode });
    const leaveTypeId = leaveType ? String(leaveType._id) : leaveCode;
    const leaveTypeName = leaveType?.name || leaveCode;

    const filter = { hospitalId: hid, personId: pid, leaveTypeId, year };
    // upsert + $inc atomik: iki eş zamanlı onay çakışmaz
    const updated = await LeaveBalance.findOneAndUpdate(
      filter,
      {
        $inc: { used: totalDays },
        $setOnInsert: {
          hospitalId: hid,
          personId: pid,
          personName: request.fromName || '',
          leaveTypeId,
          leaveTypeName,
          year,
          allocated: 0,
        },
      },
      { upsert: true, new: true }
    );
    // remaining'i ayrı set et (allocated güncel olabilir)
    await LeaveBalance.updateOne(filter, [
      { $set: { remaining: { $subtract: ['$allocated', '$used'] } } },
    ]);
    void updated; // linter uyarısını bastır
  } catch (e) {
    console.error('[leave-balance-update] ERR:', e?.message || e);
  }
}

/* ── İzin geri alındığında/reddedildiğinde LeaveBalance'ı geri al ── */
async function revertLeaveBalance(request) {
  const { fromPersonId, targetDate, targetDateEnd, leaveTypeCode, hospitalId: hid } = request;
  if (!fromPersonId || !targetDate) return;

  const leaveCode = String(leaveTypeCode || 'YILLIK').trim().toUpperCase();
  const start = new Date(`${String(targetDate).slice(0, 10)}T00:00:00`);
  const end   = new Date(`${String(targetDateEnd || targetDate).slice(0, 10)}T00:00:00`);
  if (isNaN(start) || isNaN(end) || end < start) return;

  const totalDays = Math.round((end - start) / 86_400_000) + 1;
  const year = start.getFullYear();
  const pid = String(fromPersonId);

  const leaveType = await LeaveType.findOne({ hospitalId: hid, code: leaveCode });
  const leaveTypeId = leaveType ? String(leaveType._id) : leaveCode;

  const filter = { hospitalId: hid, personId: pid, leaveTypeId, year };
  // used negatife düşmesin — pipeline update ile atomik
  await LeaveBalance.updateOne(filter, [
    { $set: { used: { $max: [0, { $subtract: ['$used', totalDays] }] } } },
    { $set: { remaining: { $subtract: ['$allocated', '$used'] } } },
  ]);
}

/* ── Takas onaylandığında atamaları değiştir ── */
async function executeSwap(request) {
  const {
    fromPersonId, fromName,
    swapWithPersonId,
    swapSectionId, swapMyDate, swapMyShiftId,
    swapTargetDate, swapTargetShiftId,
  } = request;

  if (!fromPersonId || !swapWithPersonId || !swapMyDate || !swapTargetDate) return false;
  // Self-swap: kişi kendisiyle takas yapamaz
  if (String(fromPersonId) === String(swapWithPersonId)) return false;

  function ym(dateStr) {
    const m = String(dateStr).slice(0, 10).match(/^(\d{4})-(\d{2})/);
    return m ? { year: Number(m[1]), month: Number(m[2]) } : null;
  }

  const myYm = ym(swapMyDate);
  const tYm  = ym(swapTargetDate);
  if (!myYm || !tYm) return false;

  const sectionId = String(swapSectionId || '');
  const fromPid   = String(fromPersonId);
  const toPid     = String(swapWithPersonId);
  const myShift   = String(swapMyShiftId || '').toUpperCase();
  const tShift    = String(swapTargetShiftId || '').toUpperCase();
  const myDate    = String(swapMyDate).slice(0, 10);
  const tDate     = String(swapTargetDate).slice(0, 10);

  const [fromPerson, toPerson] = await Promise.all([
    Person.findById(fromPersonId).lean(),
    Person.findById(swapWithPersonId).lean(),
  ]);

  const isSameDoc = myYm.year === tYm.year && myYm.month === tYm.month;

  const findAndSwap = async (doc, findDate, findPid, findShift, newPid, newName) => {
    const assignments = Array.isArray(doc?.data?.assignments) ? [...doc.data.assignments] : [];
    const idx = assignments.findIndex((a) => {
      const aDate  = String(a?.date || a?.day || '').slice(0, 10);
      const aPid   = String(a?.personId || '').trim();
      const aShift = String(a?.shiftId || a?.shiftCode || '').trim().toUpperCase();
      return aDate === findDate && aPid === findPid && aShift === findShift;
    });
    if (idx === -1) return { doc, found: false, assignments };
    assignments[idx] = { ...assignments[idx], personId: newPid, personName: newName };
    return { doc, found: true, assignments };
  };

  if (isSameDoc) {
    const doc = await MonthlySchedule.findOne({ sectionId, year: myYm.year, month: myYm.month });
    if (!doc) return false;

    const r1 = await findAndSwap(doc, myDate, fromPid, myShift, toPid, toPerson?.name || '');
    if (!r1.found) return false;
    doc.data = { ...doc.data, assignments: r1.assignments };

    const r2 = await findAndSwap(doc, tDate, toPid, tShift, fromPid, fromPerson?.name || fromName || '');
    if (!r2.found) return false;
    doc.data = { ...doc.data, assignments: r2.assignments };
    doc.markModified('data');
    await doc.save();
    try {
      await replaceAssignmentsForSchedule({
        scope: {
          sectionId: String(doc.sectionId || sectionId || '').trim(),
          serviceId: doc.serviceId != null ? String(doc.serviceId).trim() : '',
          role: doc.role != null ? String(doc.role).trim() : '',
          year: myYm.year,
          month: myYm.month,
          sourceScheduleId: doc._id,
        },
        payload: doc.data || {},
        createdBy: doc.createdBy || null,
        updatedBy: null,
        source: 'requestSwap',
      });
    } catch (syncErr) {
      console.error('[assignmentSync][swap-same-doc] ERR:', syncErr?.message || syncErr);
    }
  } else {
    // İki farklı ay dokümanı — okuma + yazma transaction içinde; write conflict'e karşı güvenli
    const mongoose = require('mongoose');
    let session;
    let syncFromDoc, syncToDoc;
    try {
      session = await mongoose.startSession();
      await session.withTransaction(async () => {
        const [fromDoc, toDoc] = await Promise.all([
          MonthlySchedule.findOne({ sectionId, year: myYm.year, month: myYm.month }).session(session),
          MonthlySchedule.findOne({ sectionId, year: tYm.year,  month: tYm.month  }).session(session),
        ]);
        if (!fromDoc || !toDoc) throw new Error('Çizelge bulunamadı');

        const r1 = await findAndSwap(fromDoc, myDate, fromPid, myShift, toPid, toPerson?.name || '');
        if (!r1.found) throw new Error('Vardiya bulunamadı (from)');
        fromDoc.data = { ...fromDoc.data, assignments: r1.assignments };
        fromDoc.markModified('data');

        const r2 = await findAndSwap(toDoc, tDate, toPid, tShift, fromPid, fromPerson?.name || fromName || '');
        if (!r2.found) throw new Error('Vardiya bulunamadı (to)');
        toDoc.data = { ...toDoc.data, assignments: r2.assignments };
        toDoc.markModified('data');

        await fromDoc.save({ session });
        await toDoc.save({ session });
        syncFromDoc = fromDoc;
        syncToDoc = toDoc;
      });
    } catch (txErr) {
      console.error('[swap] Transaction başarısız, rollback yapıldı:', txErr?.message);
      if (session) await session.endSession();
      return false;
    }
    if (session) await session.endSession();

    if (!syncFromDoc || !syncToDoc) return false;

    try {
      await Promise.all([
        replaceAssignmentsForSchedule({
          scope: {
            sectionId: String(syncFromDoc.sectionId || sectionId || '').trim(),
            serviceId: syncFromDoc.serviceId != null ? String(syncFromDoc.serviceId).trim() : '',
            role: syncFromDoc.role != null ? String(syncFromDoc.role).trim() : '',
            year: myYm.year,
            month: myYm.month,
            sourceScheduleId: syncFromDoc._id,
          },
          payload: syncFromDoc.data || {},
          createdBy: syncFromDoc.createdBy || null,
          updatedBy: null,
          source: 'requestSwap',
        }),
        replaceAssignmentsForSchedule({
          scope: {
            sectionId: String(syncToDoc.sectionId || sectionId || '').trim(),
            serviceId: syncToDoc.serviceId != null ? String(syncToDoc.serviceId).trim() : '',
            role: syncToDoc.role != null ? String(syncToDoc.role).trim() : '',
            year: tYm.year,
            month: tYm.month,
            sourceScheduleId: syncToDoc._id,
          },
          payload: syncToDoc.data || {},
          createdBy: syncToDoc.createdBy || null,
          updatedBy: null,
          source: 'requestSwap',
        }),
      ]);
    } catch (syncErr) {
      console.error('[assignmentSync][swap-cross-doc] ERR:', syncErr?.message || syncErr);
    }
  }
  return true;
}

// Auth middleware
// Not: Bu router, index.js içinde zaten `secureTenant` (auth + extractHospital) ile mount edilir.
// Burada sadece guard yapıyoruz; tenant/hospital çözümlemesi dış middleware'den gelir.
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

// POST /api/requests — kullanıcı talep gönderir
router.post('/', requireAuth, async (req, res) => {
  try {
    const {
      type, targetDate, targetDateEnd, message, swapWithPersonId,
      leaveTypeCode,
      swapSectionId, swapMyDate, swapMyShiftId, swapMyShiftLabel,
      swapTargetDate, swapTargetShiftId, swapTargetShiftLabel,
      swapWithPersonName,
    } = req.body;

    if (!type || !message) {
      return res.status(400).json({ message: 'Tür ve mesaj zorunlu' });
    }
    if (type === 'takas' && (!swapWithPersonId || !swapMyDate || !swapMyShiftId || !swapTargetDate || !swapTargetShiftId)) {
      return res.status(400).json({ message: 'Takas için swapWithPersonId, swapMyDate, swapMyShiftId, swapTargetDate, swapTargetShiftId zorunlu' });
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
      swapWithPersonId:   swapWithPersonId || null,
      swapWithPersonName: String(swapWithPersonName || '').trim(),
      leaveTypeCode:      String(leaveTypeCode || '').trim().toUpperCase(),
      swapSectionId:    String(swapSectionId || '').trim(),
      swapMyDate:       String(swapMyDate || '').slice(0, 10),
      swapMyShiftId:    String(swapMyShiftId || '').trim(),
      swapMyShiftLabel: String(swapMyShiftLabel || '').trim(),
      swapTargetDate:   String(swapTargetDate || '').slice(0, 10),
      swapTargetShiftId: String(swapTargetShiftId || '').trim(),
      swapTargetShiftLabel: String(swapTargetShiftLabel || '').trim(),
      message,
      status: 'pending',
    }));

    void sendNewRequestNotification({ request, senderName: req.user?.name || '' }).catch(() => {});
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
      // Normal kullanıcı kendi talepleri + gelen takas taleplerini görür
      const myPerson = await Person.findOne(withHospitalFilter(req, { userId: req.user._id })).lean();
      if (myPerson?._id) {
        filter = { $or: [{ fromUserId: req.user._id }, { swapWithPersonId: myPerson._id }] };
      } else {
        filter.fromUserId = req.user._id;
      }
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

    let request = await Request.findOne(withHospitalFilter(req, { _id: req.params.id }));
    if (!request) return res.status(404).json({ message: 'Talep bulunamadı' });
    if (String(request.status || '') === 'deleted') {
      return res.status(409).json({ message: 'Silinmiş talep güncellenemez' });
    }

    // Yetkili sadece kendi servisindeki talebi işleyebilir
    const role = String(req.user.role || '').toLowerCase();
    if (role === 'staff') {
      const serviceIds = Array.isArray(req.user.serviceIds)
        ? req.user.serviceIds.filter(Boolean).map(String)
        : [];
      if (serviceIds.length && !serviceIds.includes(String(request.serviceId))) {
        return res.status(403).json({ message: 'Bu talep sizin servisinize ait değil' });
      }
    }

    const previousStatus = String(request.status || 'pending');

    // Atomic CAS: aynı anda iki onay gelirse ikincisi 409 alır
    const updatedRequest = await Request.findOneAndUpdate(
      withHospitalFilter(req, { _id: req.params.id, status: previousStatus }),
      { $set: { status, adminNote: adminNote || '', resolvedBy: req.user._id, resolvedAt: new Date() } },
      { new: true }
    );
    if (!updatedRequest) {
      return res.status(409).json({ message: 'Talep durumu değişti, lütfen sayfayı yenileyin' });
    }
    request = updatedRequest; // CAS sonrası güncel dokümanı kullan

    const requestType = String(request.type || '').toLowerCase();
    const isLeaveRequest = requestType === 'izin';
    const isSwapRequest  = requestType === 'takas';
    const hasStatusChange = previousStatus !== String(status);
    const actorName = req.user?.name || req.user?.email || 'Yetkili';

    if (hasStatusChange && status === 'approved') {
      if (isLeaveRequest) {
        void applyLeaveRange(request).catch((e) => {
          console.error('[leave-apply] ERR:', e?.message || e);
        });
        void sendLeaveApproved({ request, actorName }).catch((e) => {
          console.error('[notify][leave-approved] ERR:', e?.message || e);
        });
      } else if (isSwapRequest && !request.swapExecuted) {
        try {
          const executed = await executeSwap(request);
          if (executed) {
            // Swap başarılı → swapExecuted atomik olarak işaretle
            await Request.updateOne(
              withHospitalFilter(req, { _id: request._id }),
              { $set: { swapExecuted: true } }
            );
            request.swapExecuted = true;
          } else {
            console.warn('[swap-execute] Takas gerçekleştirilemedi, request approved olarak kaldı:', request._id);
          }
        } catch (e) {
          console.error('[swap-execute] ERR:', e?.message || e);
        }
        // Takas onay bildirimi — her iki tarafa
        void sendShiftChanged({
          personId: request.fromPersonId,
          userId:   request.fromUserId,
          personName: request.fromName,
          date:       request.swapMyDate,
          previousShift: request.swapMyShiftLabel || request.swapMyShiftId,
          newShift:      request.swapTargetShiftLabel || request.swapTargetShiftId,
          changedByName: actorName,
          action: 'updated',
        }).catch((e) => console.error('[notify][swap-from] ERR:', e?.message || e));
        void sendShiftChanged({
          personId: request.swapWithPersonId,
          date:     request.swapTargetDate,
          previousShift: request.swapTargetShiftLabel || request.swapTargetShiftId,
          newShift:      request.swapMyShiftLabel || request.swapMyShiftId,
          changedByName: actorName,
          action: 'updated',
        }).catch((e) => console.error('[notify][swap-to] ERR:', e?.message || e));
      }
    } else if (isLeaveRequest && hasStatusChange && status === 'rejected') {
      void sendLeaveRejected({ request, actorName }).catch((e) => {
        console.error('[notify][leave-rejected] ERR:', e?.message || e);
      });
      // Daha önce onaylanmış bir izin reddediliyorsa bakiyeyi geri al
      if (previousStatus === 'approved') {
        void revertLeaveBalance(request).catch((e) => {
          console.error('[leave-balance-revert] ERR:', e?.message || e);
        });
      }
    } else if (isLeaveRequest && hasStatusChange && status === 'pending' && previousStatus === 'approved') {
      // Onay geri alındı (approved → pending)
      void revertLeaveBalance(request).catch((e) => {
        console.error('[leave-balance-revert] ERR:', e?.message || e);
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
        ? req.user.serviceIds.filter(Boolean).map(String)
        : [];
      if (serviceIds.length && !serviceIds.includes(String(request.serviceId))) {
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

// GET /api/requests/swap-suggestions — takas için uygun kişi önerileri
router.get('/swap-suggestions', requireAuth, async (req, res) => {
  try {
    const { personId, currentPersonName, date, shiftId, sectionId, serviceId, role, roleLabel, limit } = req.query;
    if (!date || !shiftId) {
      return res.status(400).json({ message: 'date ve shiftId zorunlu' });
    }
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

// POST /api/requests/:id/peer-response — hedef kişi takas talebini kabul/reddeder
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
    if (!request) return res.status(404).json({ message: 'Talep bulunamadı' });
    if (request.status !== 'pending') {
      return res.status(409).json({ message: 'Talep artık beklemede değil' });
    }
    if (request.peerStatus !== 'pending') {
      return res.status(409).json({ message: 'Bu talebi zaten yanıtladınız' });
    }

    const peerStatus = isAccepted ? 'accepted' : 'rejected';
    const peerNote = String(note || '').trim().slice(0, 500);

    // Atomik CAS: iki eşzamanlı yanıt gelirse ikincisi 409 alır
    const updated = await Request.findOneAndUpdate(
      withHospitalFilter(req, { _id: req.params.id, peerStatus: 'pending' }),
      { $set: { peerStatus, peerRespondedAt: new Date(), peerNote } },
      { new: true }
    );
    if (!updated) return res.status(409).json({ message: 'Durum değişti, sayfayı yenileyin' });

    if (!isAccepted) {
      // Karşı taraf reddetti → talebi otomatik olarak reddet
      await Request.updateOne(
        withHospitalFilter(req, { _id: req.params.id }),
        {
          $set: {
            status: 'rejected',
            adminNote: peerNote ? `Karşı taraf reddetti: ${peerNote}` : 'Karşı taraf reddetti',
            resolvedAt: new Date(),
          },
        }
      );
      updated.status = 'rejected';
    } else {
      // Kabul edildi → yöneticilere bildir (nihai onay bekleniyor)
      void sendNewRequestNotification({ request: updated, senderName: req.user?.name || '' }).catch(() => {});
    }

    res.json({ ok: true, request: updated });
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
