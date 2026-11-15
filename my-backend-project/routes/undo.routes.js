'use strict';

const express = require('express');
const router = express.Router();

const { requireRole } = require('../middleware/authz');
const {
  assertUndoScope,
  listRecentOperations,
  undoOperation,
} = require('../services/undoService');

const forbiddenResponse = {
  ok: false,
  code: 'FORBIDDEN',
  message: 'Bu işlem için yetkiniz yok.',
};

function sendError(res, err) {
  const status = Number(err?.status || 500);
  return res.status(status).json({
    ok: false,
    code: err?.code || 'UNDO_ERROR',
    message: err?.message || 'Geri alma işlemi tamamlanamadı.',
  });
}

function toSafeOperation(item = {}) {
  return {
    id: String(item._id || ''),
    operationType: item.operationType,
    summary: item.summary || '',
    entityRefs: item.entityRefs || {},
    scope: {
      sectionId: item.sectionId,
      serviceId: item.serviceId,
      role: item.role,
      year: item.year,
      month: item.month,
    },
    reversible: item.reversible === true,
    undoStatus: item.undoStatus || 'available',
    createdAt: item.createdAt || null,
    createdBy: item.createdBy || null,
    createdByName: item.createdByName || '',
    undoneAt: item.undoneAt || null,
    undoneByName: item.undoneByName || '',
  };
}

router.get(
  '/recent',
  requireRole('admin', 'staff', { forbiddenResponse }),
  async (req, res) => {
    try {
      const scope = assertUndoScope({
        hospitalId: req.hospitalId,
        sectionId: req.query.sectionId,
        serviceId: req.query.serviceId,
        role: req.query.role,
        year: req.query.year,
        month: req.query.month,
      });
      const operations = await listRecentOperations(scope, { limit: req.query.limit || 10 });
      return res.json({
        ok: true,
        operations: operations.map(toSafeOperation),
      });
    } catch (err) {
      return sendError(res, err);
    }
  }
);

router.post(
  '/:operationId',
  requireRole('admin', 'staff', { forbiddenResponse }),
  async (req, res) => {
    try {
      const result = await undoOperation(req.params.operationId, {
        hospitalId: req.hospitalId,
        user: req.user,
        reason: req.body?.reason || '',
      });
      const op = result.operation || {};
      return res.json({
        ok: true,
        operationId: String(op._id || req.params.operationId),
        undone: true,
        scheduleId: result.schedule?._id ? String(result.schedule._id) : null,
        scope: {
          sectionId: op.sectionId,
          serviceId: op.serviceId,
          role: op.role,
          year: op.year,
          month: op.month,
        },
      });
    } catch (err) {
      return sendError(res, err);
    }
  }
);

module.exports = router;
