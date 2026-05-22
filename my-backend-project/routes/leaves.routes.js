const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

const Setting = require('../models/Setting');
const Person = require('../models/Person');
const LeaveBalance = require('../models/LeaveBalance');
const LeaveType = require('../models/LeaveType');
const { withHospitalFilter } = require('../middleware/hospital');

/**
 * İzin ekleme/silme işlemlerinde LeaveBalance.used alanını senkronize eder.
 * Yalnızca LeaveType koleksiyonunda kayıtlı kodlar (gerçek izin türleri) için çalışır;
 * vardiya kodları ('G', 'M' vb.) atlanır.
 *
 * @param {object} req   — hospitalId için
 * @param {string} pid   — personId
 * @param {string} code  — izin kodu (örn. 'YILLIK')
 * @param {number} year
 * @param {number} delta — +1 (ekle) veya -1 (sil)
 */
async function syncLeaveBalance(req, pid, code, year, delta) {
  try {
    const hid = req.hospitalId;
    if (!hid || !pid || !code || !delta) return;

    const upperCode = String(code).trim().toUpperCase();
    const leaveType = await LeaveType.findOne(withHospitalFilter(req, { code: upperCode })).lean();
    if (!leaveType) return; // Vardiya kodu veya bilinmeyen kod — atla

    const leaveTypeId = String(leaveType._id);
    const filter = {
      hospitalId: hid,
      personId:   String(pid),
      leaveTypeId,
      year:       Number(year),
    };

    if (delta > 0) {
      // Yeni gün eklendi — upsert + atomik artırma
      await LeaveBalance.findOneAndUpdate(
        filter,
        [
          {
            $set: {
              hospitalId:    { $ifNull: ['$hospitalId',    hid] },
              personId:      { $ifNull: ['$personId',      String(pid)] },
              leaveTypeId:   { $ifNull: ['$leaveTypeId',   leaveTypeId] },
              leaveTypeName: { $ifNull: ['$leaveTypeName', leaveType.name || upperCode] },
              year:          { $ifNull: ['$year',          Number(year)] },
              allocated:     { $ifNull: ['$allocated',     leaveType.maxDaysPerYear ?? 0] },
              used:          { $add: [{ $ifNull: ['$used', 0] }, delta] },
            },
          },
          { $set: { remaining: { $max: [0, { $subtract: ['$allocated', '$used'] }] } } },
        ],
        { upsert: true, new: true },
      );
    } else {
      // Gün silindi — used negatife düşmesin
      await LeaveBalance.updateOne(filter, [
        { $set: { used: { $max: [0, { $subtract: ['$used', Math.abs(delta)] }] } } },
        { $set: { remaining: { $subtract: ['$allocated', '$used'] } } },
      ]);
    }
  } catch (err) {
    console.error('[leaves] syncLeaveBalance ERR:', err?.message || err);
  }
}

async function findLeavesDoc(req, serviceId = '') {
  const base = withHospitalFilter(req, { key: 'leavesV2', serviceId });
  const primary = await Setting.findOne(base);
  if (primary) return primary;

  // Legacy migration: personLeaves -> leavesV2 (tek kaynak)
  const legacy = await Setting.findOne(withHospitalFilter(req, { key: 'personLeaves', serviceId }));
  if (!legacy) return null;

  const migrated = await Setting.findOneAndUpdate(
    withHospitalFilter(req, { key: 'leavesV2', serviceId }),
    {
      $set: {
        key: 'leavesV2',
        serviceId,
        value: legacy?.value && typeof legacy.value === 'object' ? legacy.value : {},
        updatedBy: legacy?.updatedBy || null,
      },
      $setOnInsert: {
        createdBy: legacy?.createdBy || null,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  try {
    await Setting.deleteOne(withHospitalFilter(req, { _id: legacy._id }));
  } catch {
    // migration non-blocking
  }
  return migrated;
}

function monthKey(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function asLeaveItems(monthData = {}, year, month) {
  return Object.entries(monthData || {})
    .map(([day, rec]) => {
      const code = typeof rec === 'string' ? rec : rec?.code;
      if (!code) return null;
      const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      return {
        start: date,
        end: date,
        type: code,
        code,
        partial: 'none',
        hours: null,
        note: typeof rec === 'object' ? rec?.note || '' : '',
      };
    })
    .filter(Boolean)
    .sort((a, b) => String(a.start).localeCompare(String(b.start)));
}

router.get('/', async (req, res) => {
  try {
    const serviceId = String(req.query?.serviceId || '').trim();
    const personId = String(req.query?.personId || '').trim();
    const year = Number(req.query?.year || req.query?.y);
    const month = Number(req.query?.month || req.query?.m);

    const doc = await findLeavesDoc(req, serviceId);
    const allLeaves = doc?.value && typeof doc.value === 'object' ? doc.value : {};

    if (personId) {
      const byPerson = allLeaves[personId] || {};
      const ym = Number.isFinite(year) && Number.isFinite(month) ? monthKey(year, month) : '';
      const monthData = ym ? (byPerson[ym] || {}) : byPerson;
      return res.json({
        ok: true,
        key: doc?.key || null,
        data: monthData,
        items: ym ? asLeaveItems(monthData, year, month) : [],
      });
    }

    return res.json({
      ok: true,
      key: doc?.key || null,
      data: allLeaves,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || 'Leaves okunamadı' });
  }
});

router.put('/', async (req, res) => {
  try {
    const role = String(req.user?.role || '').toLowerCase();
    const serviceId = String(req.body?.serviceId || '').trim();
    const personId = String(req.body?.personId || '').trim();
    const year = Number(req.body?.year);
    const month = Number(req.body?.month);
    const day = Number(req.body?.day);
    const code = String(req.body?.code || '').trim();
    const note = String(req.body?.note || '').trim();

    if (!personId || !Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day) || !code) {
      return res.status(400).json({ ok: false, error: 'personId, year, month, day, code zorunlu' });
    }

    const person = await Person.findOne(withHospitalFilter(req, { _id: personId })).lean();
    if (!person) {
      return res.status(404).json({ ok: false, error: 'Person bulunamadı' });
    }

    if (!['admin', 'staff', 'authorized'].includes(role)) {
      const userId = String(req.user?.uid || req.user?.id || req.user?._id || '').trim();
      const ownPerson = userId ? await Person.findOne(withHospitalFilter(req, { userId })).lean() : null;
      if (!ownPerson || String(ownPerson._id) !== personId) {
        return res.status(403).json({ ok: false, error: 'Sadece kendi izninizi yazabilirsiniz' });
      }
    }

    let doc = await findLeavesDoc(req, serviceId);
    if (!doc) {
      doc = new Setting(withHospitalFilter(req, { key: 'leavesV2', serviceId, value: {} }));
    }

    const ym = monthKey(year, month);
    const value = doc.value && typeof doc.value === 'object' ? doc.value : {};
    value[personId] ??= {};
    value[personId][ym] ??= {};

    // Önceki kodu sakla — farklı ise bakiyeyi eski koddan geri al, yenisine ekle
    const prevEntry = value[personId][ym][String(day)];
    const prevCode  = prevEntry
      ? (typeof prevEntry === 'string' ? prevEntry : prevEntry?.code)
      : null;
    const upperCode = String(code).trim().toUpperCase();

    value[personId][ym][String(day)] = note ? { code, note } : { code };
    doc.value = value;
    doc.markModified('value');
    await doc.save();

    // LeaveBalance senkronizasyonu (fire-and-forget, kaydetme engellenmesin)
    if (prevCode !== upperCode) {
      if (prevCode) void syncLeaveBalance(req, personId, prevCode, year, -1);
      void syncLeaveBalance(req, personId, upperCode, year, +1);
    }

    return res.json({ ok: true, key: doc.key, data: value[personId][ym] });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || 'Leave kaydedilemedi' });
  }
});

router.delete('/', async (req, res) => {
  try {
    const role = String(req.user?.role || '').toLowerCase();
    if (!['admin', 'staff', 'authorized'].includes(role)) {
      return res.status(403).json({ ok: false, error: 'Yetersiz yetki' });
    }

    const serviceId = String(req.body?.serviceId || '').trim();
    const personId = String(req.body?.personId || '').trim();
    const year = Number(req.body?.year);
    const month = Number(req.body?.month);
    const day = Number(req.body?.day);

    if (!personId || !Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
      return res.status(400).json({ ok: false, error: 'personId, year, month, day zorunlu' });
    }

    const doc = await findLeavesDoc(req, serviceId);
    if (!doc) return res.json({ ok: true });

    const ym = monthKey(year, month);
    const value = doc.value && typeof doc.value === 'object' ? doc.value : {};
    const existingEntry = value[personId]?.[ym]?.[String(day)];

    if (existingEntry) {
      const deletedCode = typeof existingEntry === 'string'
        ? existingEntry
        : existingEntry?.code;

      delete value[personId][ym][String(day)];
      if (!Object.keys(value[personId][ym] || {}).length) delete value[personId][ym];
      if (!Object.keys(value[personId] || {}).length) delete value[personId];
      doc.value = value;
      doc.markModified('value');
      await doc.save();

      // LeaveBalance'dan 1 gün geri al
      if (deletedCode) void syncLeaveBalance(req, personId, deletedCode, year, -1);
    }

    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || 'Leave silinemedi' });
  }
});

module.exports = router;
