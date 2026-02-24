// routes/personnel.routes.js
const express = require('express');
const router = express.Router();
const Person = require('../models/Person');
const { requireAuth, requireRole, sameServiceOrAdmin } = require('../middleware/authz');

function parseIntSafe(val, def = null) {
  const n = Number(val);
  return Number.isFinite(n) ? n : def;
}

router.get('/',
  requireAuth,
  (req, _res, next) => {
    const unitId = req.query.unitId || req.query.serviceId || '';
    req.targetServiceId = unitId ? String(unitId) : '';
    next();
  },
  sameServiceOrAdmin,
  async (req, res) => {
    try {
      const unitId = req.query.unitId || req.query.serviceId || '';
      const q = String(req.query.q || '').trim();
      const page = parseIntSafe(req.query.page, 1);
      const size = parseIntSafe(req.query.size, 500);

      const query = {};
      if (unitId) query.serviceId = String(unitId);
      if (q) query.name = new RegExp(q, 'i');

      const skip = Math.max(0, (page - 1) * size);
      const limit = Math.max(1, Math.min(size, 2000));

      const [items, total] = await Promise.all([
        Person.find(query).skip(skip).limit(limit).lean(),
        Person.countDocuments(query),
      ]);

      const mapped = (items || []).map((p) => ({
        id: String(p._id),
        fullName: p.name || '',
        first_name: p.firstName || '',
        last_name: p.lastName || '',
        title: p.meta?.title || p.meta?.unvan || p.meta?.role || '',
        service: p.meta?.service || p.meta?.department || p.serviceId || '',
        serviceId: p.serviceId || '',
        tc: p.tc || '',
        phone: p.phone || '',
        email: p.email || '',
        areas: p.meta?.areas || [],
        meta: p.meta || {},
      }));

      return res.json({ items: mapped, total, page, size: limit });
    } catch (err) {
      console.error('GET /api/personnel ERR:', err);
      return res.status(500).json({ error: 'Liste alınamadı' });
    }
  }
);

router.post('/',
  requireAuth,
  async (req, res) => {
    try {
      const {
        name,
        serviceId = '',
        meta = {},
        tc = '',
        phone = '',
        email = ''
      } = req.body;

      if (!name || !String(name).trim()) {
        return res.status(400).json({ error: 'İsim gerekli' });
      }

      const person = await Person.create({
        name: String(name).trim(),
        serviceId: String(serviceId || ''),
        meta: meta || {},
        tc,
        phone,
        email,
        createdBy: req.user?.uid || null
      });

      return res.json({
        ok: true,
        person: {
          id: String(person._id),
          name: person.name,
          serviceId: person.serviceId,
          meta: person.meta || {}
        }
      });
    } catch (err) {
      console.error('POST /api/personnel ERR:', err);
      return res.status(500).json({ error: 'Personel oluşturulamadı' });
    }
  }
);

// Bulk insert (opsiyonel: replaceAll=true ile tümünü silip yeniden yazar)
router.post('/bulk',
  requireAuth,
  requireRole('admin', 'authorized'),
  async (req, res) => {
    try {
      const body = req.body;
      const replaceAll = !!(req.query?.replaceAll || body?.replaceAll);
      const replaceRole = String(req.query?.role || body?.role || '').trim();
      const items = Array.isArray(body) ? body : Array.isArray(body?.items) ? body.items : null;
      if (!Array.isArray(items)) {
        return res.status(400).json({ error: 'Array expected (body: [] veya { items: [] })' });
      }

      const mapped = items.map((it) => {
        const name = String(it?.name || it?.fullName || '').trim();
        const serviceId = String(it?.serviceId || it?.service || '').trim();
        if (!name) throw new Error('İsim gerekli');
        if (!serviceId) throw new Error('serviceId gerekli');

        const meta = { ...(it?.meta || {}) };
        if (it?.role && !meta.role) meta.role = it.role;
        if (Array.isArray(it?.areas) && !meta.areas) meta.areas = it.areas;

        return {
          name,
          serviceId,
          firstName: it?.firstName || it?.first_name || '',
          lastName: it?.lastName || it?.last_name || '',
          tc: it?.tc || '',
          phone: it?.phone || '',
          email: it?.email || '',
          meta,
          createdBy: req.user?.uid || null,
        };
      });

      if (replaceAll && mapped.length > 0) {
        if (replaceRole) {
          const esc = replaceRole.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const rx = new RegExp(`^${esc}$`, 'i');
          await Person.deleteMany({
            $or: [
              { "meta.role": rx },
              { role: rx },
              { title: rx },
              { "meta.title": rx },
            ],
          });
        } else {
          await Person.deleteMany({});
        }
      }
      const inserted = await Person.insertMany(mapped, { ordered: false });
      return res.json({ ok: true, count: inserted.length });
    } catch (err) {
      console.error('POST /api/personnel/bulk ERR:', err);
      return res.status(500).json({ error: err.message || 'Bulk ekleme hatası' });
    }
  }
);

module.exports = router;
