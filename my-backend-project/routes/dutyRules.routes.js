// routes/dutyRules.routes.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const DutyRule = require('../models/DutyRule');
const RuleEngine = require('../services/ruleEngine');
const { requireAuth, requireRole } = require('../middleware/authz');
const { DEFAULT_RULES, DEFAULT_WEIGHTS } = require('../services/schedulerService');

function parseQuery(req) {
  const sectionId = (req.query.sectionId || req.body?.sectionId || '').toString().trim();
  const serviceId = (req.query.serviceId || req.body?.serviceId || '').toString().trim();
  const role = (req.query.role || req.body?.role || '').toString().trim();
  if (!sectionId) throw new Error('sectionId gerekli');
  return { sectionId, serviceId, role };
}

function pickExtendedFields(body) {
  const out = {};
  const fields = [
    'departman',
    'description',
    'basicRules',
    'leaveRules',
    'shiftRules',
    'taskRequirements',
    'personnelRules',
    'metadata',
  ];
  for (const f of fields) {
    if (body?.[f] !== undefined) out[f] = body[f];
  }
  return out;
}

function buildRuleUpdate(body) {
  const update = {};
  if (body?.rules && typeof body.rules === 'object') update.rules = body.rules;
  if (body?.weights && typeof body.weights === 'object') update.weights = body.weights;
  if (body?.enabled !== undefined) update.enabled = body.enabled !== false;
  Object.assign(update, pickExtendedFields(body));
  return update;
}

async function resolveRuleDoc(payload = {}) {
  const ruleId = payload?.ruleId || payload?.id || null;
  if (ruleId && mongoose.isValidObjectId(ruleId)) {
    const doc = await DutyRule.findById(ruleId).lean();
    return doc || null;
  }
  const sectionId = (payload?.sectionId || '').toString().trim();
  if (!sectionId) return null;
  const serviceId = (payload?.serviceId || '').toString().trim();
  const role = (payload?.role || '').toString().trim();
  const doc = await DutyRule.findOne({ sectionId, serviceId, role }).lean();
  return doc || null;
}

router.get('/', requireAuth, async (req, res) => {
  try {
    const { sectionId, serviceId, role } = parseQuery(req);
    const doc = await DutyRule.findOne({ sectionId, serviceId, role }).lean();
    const rules = { ...DEFAULT_RULES, ...(doc?.rules || {}) };
    const weights = { ...DEFAULT_WEIGHTS, ...(doc?.weights || {}) };
    return res.json({
      ok: true,
      rule: doc
        ? {
            id: String(doc._id),
            sectionId,
            serviceId,
            role,
            rules,
            weights,
            enabled: doc.enabled !== false,
            departman: doc.departman || '',
            description: doc.description || '',
            basicRules: doc.basicRules || {},
            leaveRules: doc.leaveRules || {},
            shiftRules: doc.shiftRules || {},
            taskRequirements: doc.taskRequirements || {},
            personnelRules: doc.personnelRules || {},
            metadata: doc.metadata || {},
            createdAt: doc.createdAt,
            updatedAt: doc.updatedAt,
          }
        : {
            id: null,
            sectionId,
            serviceId,
            role,
            rules,
            weights,
            enabled: true,
            departman: '',
            description: '',
            basicRules: {},
            leaveRules: {},
            shiftRules: {},
            taskRequirements: {},
            personnelRules: {},
            metadata: {},
          },
    });
  } catch (err) {
    return res.status(400).json({ ok: false, message: err.message || 'Geçersiz istek' });
  }
});

router.put('/', requireAuth, requireRole('admin', 'authorized'), async (req, res) => {
  try {
    const { sectionId, serviceId, role } = parseQuery(req);
    const update = buildRuleUpdate(req.body || {});
    if (!('rules' in update)) update.rules = {};
    if (!('weights' in update)) update.weights = {};
    if (!('enabled' in update)) update.enabled = req.body?.enabled !== false;

    const doc = await DutyRule.findOneAndUpdate(
      { sectionId, serviceId, role },
      {
        $set: {
          sectionId,
          serviceId,
          role,
          ...update,
          updatedBy: req.user?.uid || null,
        },
        $setOnInsert: {
          createdBy: req.user?.uid || null,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();

    return res.json({
      ok: true,
      rule: {
        id: String(doc._id),
        sectionId,
        serviceId,
        role,
        rules: doc.rules || {},
        weights: doc.weights || {},
        enabled: doc.enabled !== false,
        departman: doc.departman || '',
        description: doc.description || '',
        basicRules: doc.basicRules || {},
        leaveRules: doc.leaveRules || {},
        shiftRules: doc.shiftRules || {},
        taskRequirements: doc.taskRequirements || {},
        personnelRules: doc.personnelRules || {},
        metadata: doc.metadata || {},
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      },
    });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message || 'Sunucu hatası' });
  }
});

// POST /api/duty-rules — yeni kayıt oluştur (varsa 409)
router.post('/', requireAuth, requireRole('admin', 'authorized'), async (req, res) => {
  try {
    const { sectionId, serviceId, role } = parseQuery(req);
    const update = buildRuleUpdate(req.body || {});
    if (!('rules' in update)) update.rules = {};
    if (!('weights' in update)) update.weights = {};
    if (!('enabled' in update)) update.enabled = req.body?.enabled !== false;

    const exists = await DutyRule.findOne({ sectionId, serviceId, role }).lean();
    if (exists) {
      return res.status(409).json({ ok: false, message: 'Kayıt zaten var (PUT kullanın)' });
    }

    const doc = await DutyRule.create({
      sectionId,
      serviceId,
      role,
      ...update,
      createdBy: req.user?.uid || null,
    });

    return res.status(201).json({
      ok: true,
      rule: {
        id: String(doc._id),
        sectionId,
        serviceId,
        role,
        rules: doc.rules || {},
        weights: doc.weights || {},
        enabled: doc.enabled !== false,
        departman: doc.departman || '',
        description: doc.description || '',
        basicRules: doc.basicRules || {},
        leaveRules: doc.leaveRules || {},
        shiftRules: doc.shiftRules || {},
        taskRequirements: doc.taskRequirements || {},
        personnelRules: doc.personnelRules || {},
        metadata: doc.metadata || {},
        createdAt: doc.createdAt,
      },
    });
  } catch (err) {
    if (err?.message?.includes('duplicate key')) {
      return res.status(409).json({ ok: false, message: 'Kayıt zaten var (PUT kullanın)' });
    }
    return res.status(500).json({ ok: false, message: err.message || 'Sunucu hatası' });
  }
});

router.get('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params || {};
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ ok: false, message: 'Geçersiz id' });
    }
    const doc = await DutyRule.findById(id).lean();
    if (!doc) return res.status(404).json({ ok: false, message: 'Kural bulunamadı' });
    return res.json({
      ok: true,
      rule: {
        id: String(doc._id),
        sectionId: doc.sectionId,
        serviceId: doc.serviceId || '',
        role: doc.role || '',
        enabled: doc.enabled !== false,
        departman: doc.departman || '',
        description: doc.description || '',
        rules: doc.rules || {},
        weights: doc.weights || {},
        basicRules: doc.basicRules || {},
        leaveRules: doc.leaveRules || {},
        shiftRules: doc.shiftRules || {},
        taskRequirements: doc.taskRequirements || {},
        personnelRules: doc.personnelRules || {},
        metadata: doc.metadata || {},
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      },
    });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message || 'Sunucu hatası' });
  }
});

router.put('/:id', requireAuth, requireRole('admin', 'authorized'), async (req, res) => {
  try {
    const { id } = req.params || {};
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ ok: false, message: 'Geçersiz id' });
    }
    const update = buildRuleUpdate(req.body || {});
    if (!Object.keys(update).length) {
      return res.status(400).json({ ok: false, message: 'Güncellenecek alan bulunamadı' });
    }
    update.updatedBy = req.user?.uid || null;
    const doc = await DutyRule.findByIdAndUpdate(
      id,
      { $set: update },
      { new: true }
    ).lean();
    if (!doc) return res.status(404).json({ ok: false, message: 'Kural bulunamadı' });
    return res.json({
      ok: true,
      rule: {
        id: String(doc._id),
        sectionId: doc.sectionId,
        serviceId: doc.serviceId || '',
        role: doc.role || '',
        enabled: doc.enabled !== false,
        departman: doc.departman || '',
        description: doc.description || '',
        rules: doc.rules || {},
        weights: doc.weights || {},
        basicRules: doc.basicRules || {},
        leaveRules: doc.leaveRules || {},
        shiftRules: doc.shiftRules || {},
        taskRequirements: doc.taskRequirements || {},
        personnelRules: doc.personnelRules || {},
        metadata: doc.metadata || {},
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      },
    });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message || 'Sunucu hatası' });
  }
});

router.delete('/:id', requireAuth, requireRole('admin', 'authorized'), async (req, res) => {
  try {
    const { id } = req.params || {};
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ ok: false, message: 'Geçersiz id' });
    }
    const doc = await DutyRule.findByIdAndDelete(id).lean();
    if (!doc) return res.status(404).json({ ok: false, message: 'Kural bulunamadı' });
    return res.json({ ok: true, deleted: true, id: String(doc._id) });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message || 'Sunucu hatası' });
  }
});

router.post('/test', requireAuth, requireRole('admin', 'authorized'), async (req, res) => {
  try {
    const doc = await resolveRuleDoc(req.body || {});
    const engine = new RuleEngine(doc || {});
    const person = req.body?.person || {};
    const shifts = Array.isArray(req.body?.shifts) ? req.body.shifts : [];
    const dates = Array.isArray(req.body?.dates) ? req.body.dates : [];
    const context = req.body?.context || {};
    const result = engine.testRules({ person, shifts, dates, context });
    return res.json({ ok: true, result });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message || 'Sunucu hatası' });
  }
});

router.post('/validate-shift', requireAuth, requireRole('admin', 'authorized'), async (req, res) => {
  try {
    const doc = await resolveRuleDoc(req.body || {});
    const engine = new RuleEngine(doc || {});
    const person = req.body?.person || {};
    const date = req.body?.date || req.body?.day || '';
    const shift =
      req.body?.shift ||
      {
        code: req.body?.shiftCode,
        id: req.body?.shiftId,
        label: req.body?.taskCode || req.body?.taskName || '',
        start: req.body?.start,
        end: req.body?.end,
        isNight: req.body?.isNight,
      };
    const context = req.body?.context || {};
    const result = engine.validateShift(person, shift, date, context);
    return res.json({ ok: true, result });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message || 'Sunucu hatası' });
  }
});

router.post('/check-eligibility', requireAuth, requireRole('admin', 'authorized'), async (req, res) => {
  try {
    const doc = await resolveRuleDoc(req.body || {});
    const engine = new RuleEngine(doc || {});
    const person = req.body?.person || {};
    const date = req.body?.date || req.body?.day || '';
    const shift =
      req.body?.shift ||
      {
        code: req.body?.shiftCode,
        id: req.body?.shiftId,
        label: req.body?.taskCode || req.body?.taskName || '',
        start: req.body?.start,
        end: req.body?.end,
        isNight: req.body?.isNight,
      };
    const context = req.body?.context || {};
    const result = engine.checkPersonEligibility(person, shift, date, context);
    return res.json({ ok: true, result });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message || 'Sunucu hatası' });
  }
});

module.exports = router;
