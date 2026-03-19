// routes/dutyRules.js
const express = require('express');
const router = express.Router();
const DutyRule = require('../models/DutyRule');
const RuleEngine = require('../services/ruleEngine');
const { withHospitalFilter } = require('../middleware/hospital');
const { requireRole } = require('../middleware/authz');
const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
const safeMessage = (err, fallback = 'Sunucu hatası') =>
  isProd ? fallback : (err?.message || fallback);
const devError = (err) => (isProd ? {} : { error: err?.message || 'Sunucu hatası' });

const normalizeScopeValue = (value) => String(value == null ? '' : value).trim();

function normalizeRuleScope(input = {}) {
  return {
    sectionId: normalizeScopeValue(input.sectionId),
    serviceId: normalizeScopeValue(input.serviceId || input.unitId),
    role: normalizeScopeValue(input.role),
  };
}

function buildRuleScopeFilter(req, scope) {
  const filter = {
    sectionId: scope.sectionId,
    serviceId: scope.serviceId,
    role: scope.role,
  };
  if (!req.hospitalId) return filter;
  return {
    ...filter,
    $or: [
      { hospitalId: req.hospitalId },
      { hospitalId: null },
      { hospitalId: { $exists: false } },
    ],
  };
}

function buildScopedRuleFilter(req, scope) {
  return withHospitalFilter(req, {
    sectionId: scope.sectionId,
    serviceId: scope.serviceId,
    role: scope.role,
  });
}

// GET /api/duty-rules?serviceId=&sectionId=&role=
router.get('/', async (req, res) => {
  try {
    const scope = normalizeRuleScope(req.query || {});
    const { sectionId, serviceId, role } = scope;
    if (!sectionId) {
      return res.status(400).json({ ok: false, message: 'sectionId gerekli' });
    }
    const doc = await DutyRule.findOne(buildRuleScopeFilter(req, scope)).lean();
    return res.json({
      ok: true,
      rule: doc ?? { sectionId, serviceId, role, rules: [], weights: {} },
    });
  } catch (err) {
    return res.status(500).json({ message: safeMessage(err) });
  }
});

// PUT /api/duty-rules
router.put('/', requireRole('admin', 'yetkili'), async (req, res) => {
  try {
    const {
      rules,
      weights,
      basicRules,
      leaveRules,
      shiftRules,
      taskRequirements,
      personnelRules,
      metadata,
      departman,
      description,
    } = req.body || {};
    const scope = normalizeRuleScope(req.body || {});
    const { sectionId, serviceId, role } = scope;
    if (!sectionId) {
      return res.status(400).json({ ok: false, message: 'sectionId gerekli' });
    }
    let doc = await DutyRule.findOneAndUpdate(
      buildRuleScopeFilter(req, scope),
      {
        $set: {
          sectionId,
          serviceId,
          role,
          rules: Array.isArray(rules) ? rules : [],
          weights: weights && typeof weights === 'object' && !Array.isArray(weights) ? weights : {},
          departman: departman || 'Acil Servis',
          ...(description !== undefined ? { description } : {}),
          ...(basicRules !== undefined ? { basicRules } : {}),
          ...(leaveRules !== undefined ? { leaveRules } : {}),
          ...(shiftRules !== undefined ? { shiftRules } : {}),
          ...(taskRequirements !== undefined ? { taskRequirements } : {}),
          ...(personnelRules !== undefined ? { personnelRules } : {}),
          ...(metadata !== undefined ? { metadata } : {}),
          updatedBy: req.user?.uid || null,
          updatedAt: new Date(),
        },
      },
      { new: true }
    ).lean();
    if (!doc) {
      doc = await DutyRule.findOneAndUpdate(
        buildScopedRuleFilter(req, scope),
        {
          $set: {
            sectionId,
            serviceId,
            role,
            rules: Array.isArray(rules) ? rules : [],
            weights: weights && typeof weights === 'object' && !Array.isArray(weights) ? weights : {},
            departman: departman || 'Acil Servis',
            ...(description !== undefined ? { description } : {}),
            ...(basicRules !== undefined ? { basicRules } : {}),
            ...(leaveRules !== undefined ? { leaveRules } : {}),
            ...(shiftRules !== undefined ? { shiftRules } : {}),
            ...(taskRequirements !== undefined ? { taskRequirements } : {}),
            ...(personnelRules !== undefined ? { personnelRules } : {}),
            ...(metadata !== undefined ? { metadata } : {}),
            updatedBy: req.user?.uid || null,
            updatedAt: new Date(),
          },
          $setOnInsert: {
            ...(req.hospitalId ? { hospitalId: req.hospitalId } : {}),
            createdBy: req.user?.uid || null,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      ).lean();
    }
    return res.json({ ok: true, rule: doc });
  } catch (err) {
    return res.status(500).json({ message: safeMessage(err) });
  }
});

/**
 * GET /api/duty-rules/:serviceId
 * Kuralları getir
 */
router.get('/:serviceId', async (req, res) => {
  try {
    const { serviceId } = req.params;

    const rules = await DutyRule.findOne(withHospitalFilter(req, { serviceId, 'metadata.isActive': true }));

    if (!rules) {
      return res.status(404).json({
        success: false,
        message: 'Kural bulunamadı',
        serviceId
      });
    }

    res.json({
      success: true,
      data: rules
    });
  } catch (err) {
    console.error('[dutyRules] GET hatası:', err);
    res.status(500).json({
      success: false,
      message: 'Sunucu hatası',
      ...devError(err),
    });
  }
});

/**
 * POST /api/duty-rules
 * Yeni kural oluştur
 */
router.post('/', requireRole('admin', 'yetkili'), async (req, res) => {
  try {
    const {
      departman,
      serviceId,
      description,
      basicRules,
      leaveRules,
      shiftRules,
      taskRequirements,
      personnelRules,
      createdBy
    } = req.body;

    // Validation
    if (!serviceId || !departman) {
      return res.status(400).json({
        success: false,
        message: 'serviceId ve departman zorunlu'
      });
    }

    // Var olan kuralı kontrol et
    const existing = await DutyRule.findOne(withHospitalFilter(req, { serviceId }));
    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'Bu serviceId için zaten kural var'
      });
    }

    // Yeni kural oluştur
    const newRule = new DutyRule({
      departman,
      serviceId,
      description,
      basicRules: basicRules || {},
      leaveRules: leaveRules || new Map(),
      shiftRules: shiftRules || new Map(),
      taskRequirements: taskRequirements || new Map(),
      personnelRules: personnelRules || {},
      createdBy,
      metadata: {
        version: '1.0',
        isActive: true
      }
    });

    await newRule.save();

    res.status(201).json({
      success: true,
      message: 'Kural oluşturuldu',
      data: newRule
    });
  } catch (err) {
    console.error('[dutyRules] POST hatası:', err);
    res.status(500).json({
      success: false,
      message: 'Kural oluşturulamadı',
      ...devError(err),
    });
  }
});

/**
 * PUT /api/duty-rules/:id
 * Kuralı güncelle
 */
router.put('/:id', requireRole('admin', 'yetkili'), async (req, res) => {
  try {
    const { id } = req.params;
    const {
      departman,
      basicRules,
      leaveRules,
      shiftRules,
      taskRequirements,
      personnelRules,
      updatedBy
    } = req.body;

    const updates = {
      ...(departman && { departman }),
      ...(basicRules && { basicRules }),
      ...(leaveRules && { leaveRules }),
      ...(shiftRules && { shiftRules }),
      ...(taskRequirements && { taskRequirements }),
      ...(personnelRules && { personnelRules }),
      updatedBy,
      updatedAt: new Date()
    };

    const updated = await DutyRule.findOneAndUpdate(withHospitalFilter(req, { _id: id }), updates, { new: true });

    if (!updated) {
      return res.status(404).json({
        success: false,
        message: 'Kural bulunamadı'
      });
    }

    res.json({
      success: true,
      message: 'Kural güncellendi',
      data: updated
    });
  } catch (err) {
    console.error('[dutyRules] PUT hatası:', err);
    res.status(500).json({
      success: false,
      message: 'Kural güncellenemedi',
      ...devError(err),
    });
  }
});

/**
 * DELETE /api/duty-rules/:id
 * Kuralı sil (deactivate)
 */
router.delete('/:id', requireRole('admin', 'yetkili'), async (req, res) => {
  try {
    const { id } = req.params;

    const deleted = await DutyRule.findOneAndUpdate(
      withHospitalFilter(req, { _id: id }),
      { 'metadata.isActive': false },
      { new: true }
    );

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: 'Kural bulunamadı'
      });
    }

    res.json({
      success: true,
      message: 'Kural deaktive edildi'
    });
  } catch (err) {
    console.error('[dutyRules] DELETE hatası:', err);
    res.status(500).json({
      success: false,
      message: 'Kural silinemedi',
      ...devError(err),
    });
  }
});

/**
 * POST /api/duty-rules/test
 * Kuralları test et
 */
router.post('/test', requireRole('admin', 'yetkili'), async (req, res) => {
  try {
    const { serviceId, testScenario } = req.body;

    if (!serviceId || !testScenario) {
      return res.status(400).json({
        success: false,
        message: 'serviceId ve testScenario zorunlu'
      });
    }

    // RuleEngine'i yükle
    const engine = await RuleEngine.loadRules(serviceId);

    // Kuralları test et
    const results = await engine.testRules(testScenario);

    res.json({
      success: true,
      data: results
    });
  } catch (err) {
    console.error('[dutyRules] TEST hatası:', err);
    res.status(500).json({
      success: false,
      message: 'Test çalıştırılamadı',
      ...devError(err),
    });
  }
});

/**
 * POST /api/duty-rules/validate-shift
 * Vardiyayı valide et
 */
router.post('/validate-shift', requireRole('admin', 'yetkili'), async (req, res) => {
  try {
    const { serviceId, person, shift, date, assignments } = req.body;

    if (!serviceId || !person || !shift) {
      return res.status(400).json({
        success: false,
        message: 'serviceId, person, shift zorunlu'
      });
    }

    // RuleEngine'i yükle
    const engine = await RuleEngine.loadRules(serviceId);

    // Çakışmaları bul
    const conflicts = await engine.getConflicts(person, shift, date, assignments || []);

    res.json({
      success: true,
      data: {
        hasConflicts: conflicts.hasConflicts,
        conflicts: conflicts.conflicts,
        canAssign: conflicts.criticalCount === 0
      }
    });
  } catch (err) {
    console.error('[dutyRules] VALIDATE hatası:', err);
    res.status(500).json({
      success: false,
      message: 'Validasyon başarısız',
      ...devError(err),
    });
  }
});

/**
 * POST /api/duty-rules/check-eligibility
 * Personelin uygunluğunu kontrol et
 */
router.post('/check-eligibility', requireRole('admin', 'yetkili'), async (req, res) => {
  try {
    const { serviceId, person, taskCode } = req.body;

    if (!serviceId || !person) {
      return res.status(400).json({
        success: false,
        message: 'serviceId ve person zorunlu'
      });
    }

    // RuleEngine'i yükle
    const engine = await RuleEngine.loadRules(serviceId);

    // Uygunluğu kontrol et
    const result = await engine.checkPersonEligibility(person, taskCode);

    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    console.error('[dutyRules] ELIGIBILITY hatası:', err);
    res.status(500).json({
      success: false,
      message: 'Kontrol başarısız',
      ...devError(err),
    });
  }
});

/**
 * POST /api/duty-rules/calculate-hours
 * Saatleri hesapla
 */
router.post('/calculate-hours', requireRole('admin', 'yetkili'), async (req, res) => {
  try {
    const { serviceId, person, newShiftHours, assignments, date } = req.body;

    if (!serviceId || !person) {
      return res.status(400).json({
        success: false,
        message: 'serviceId ve person zorunlu'
      });
    }

    // RuleEngine'i yükle
    const engine = await RuleEngine.loadRules(serviceId);

    // Saatleri hesapla
    const result = await engine.calculateAndCheckHours(
      person,
      newShiftHours,
      assignments || [],
      { date }
    );

    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    console.error('[dutyRules] HOURS hatası:', err);
    res.status(500).json({
      success: false,
      message: 'Hesaplama başarısız',
      ...devError(err),
    });
  }
});

module.exports = router;
