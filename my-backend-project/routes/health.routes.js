'use strict';

const express = require('express');
const router = express.Router();

const { requireAuth, requireRole } = require('../middleware/authz');
const {
  EXACT_SCOPE_CODE,
  EXACT_SCOPE_MESSAGE,
  buildSchedulerHealth,
} = require('../services/schedulerHealthService');

router.get(
  '/scheduler',
  requireAuth,
  requireRole('admin', 'staff', {
    forbiddenResponse: {
      ok: false,
      code: 'FORBIDDEN',
      message: 'Bu işlem için yetkiniz yok.',
    },
  }),
  async (req, res) => {
    try {
      const payload = await buildSchedulerHealth({
        hospitalId: req.hospitalId || req.user?.hospitalId,
        sectionId: req.query?.sectionId,
        serviceId: req.query?.serviceId,
        role: req.query?.role,
        year: req.query?.year,
        month: req.query?.month,
      });
      return res.json(payload);
    } catch (error) {
      if (error?.code === EXACT_SCOPE_CODE) {
        return res.status(400).json({
          ok: false,
          code: EXACT_SCOPE_CODE,
          message: EXACT_SCOPE_MESSAGE,
        });
      }
      return res.status(error?.status || 500).json({
        ok: false,
        code: error?.code || 'SCHEDULER_HEALTH_FAILED',
        message: error?.message || 'Scheduler health could not be calculated.',
      });
    }
  }
);

module.exports = router;
