const express = require('express');
const router = express.Router();

const Setting = require('../models/Setting');
const Person = require('../models/Person');

const KEY_CANDIDATES = ['leavesV2', 'personLeaves'];

async function findLeavesDoc(serviceId = '') {
  for (const key of KEY_CANDIDATES) {
    const doc = await Setting.findOne({ key, serviceId });
    if (doc) return doc;
  }
  return null;
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

    const doc = await findLeavesDoc(serviceId);
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

    const person = await Person.findById(personId).lean();
    if (!person) {
      return res.status(404).json({ ok: false, error: 'Person bulunamadı' });
    }

    if (!['admin', 'staff', 'authorized'].includes(role)) {
      const userId = String(req.user?.uid || req.user?.id || req.user?._id || '').trim();
      const ownPerson = userId ? await Person.findOne({ userId }).lean() : null;
      if (!ownPerson || String(ownPerson._id) !== personId) {
        return res.status(403).json({ ok: false, error: 'Sadece kendi izninizi yazabilirsiniz' });
      }
    }

    let doc = await findLeavesDoc(serviceId);
    if (!doc) {
      doc = new Setting({ key: 'leavesV2', serviceId, value: {} });
    }

    const ym = monthKey(year, month);
    const value = doc.value && typeof doc.value === 'object' ? doc.value : {};
    value[personId] ??= {};
    value[personId][ym] ??= {};
    value[personId][ym][String(day)] = note ? { code, note } : { code };

    doc.value = value;
    doc.markModified('value');
    await doc.save();

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

    const doc = await findLeavesDoc(serviceId);
    if (!doc) return res.json({ ok: true });

    const ym = monthKey(year, month);
    const value = doc.value && typeof doc.value === 'object' ? doc.value : {};
    if (value[personId]?.[ym]?.[String(day)]) {
      delete value[personId][ym][String(day)];
      if (!Object.keys(value[personId][ym] || {}).length) delete value[personId][ym];
      if (!Object.keys(value[personId] || {}).length) delete value[personId];
      doc.value = value;
      doc.markModified('value');
      await doc.save();
    }

    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || 'Leave silinemedi' });
  }
});

module.exports = router;
