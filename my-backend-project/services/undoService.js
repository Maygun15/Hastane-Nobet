'use strict';

const MonthlySchedule = require('../models/MonthlySchedule');
const OperationHistory = require('../models/OperationHistory');
const { replaceAssignmentsForSchedule } = require('./assignmentSyncService');

const EXACT_UNDO_SCOPE_CODE = 'EXACT_UNDO_SCOPE_REQUIRED';
const UNDO_CONFLICT_CODE = 'UNDO_CONFLICT';

const SENTINELS = new Set([
  'all',
  'all services',
  'all roles',
  'tümü',
  'tüm servisler',
  'tüm roller',
]);

function makeError(code, message, status = 400) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

function isMeaningful(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function isSpecificToken(value) {
  if (!isMeaningful(value)) return false;
  return !SENTINELS.has(String(value).trim().toLowerCase());
}

function assertUndoScope(scope = {}) {
  const normalized = {
    hospitalId: isMeaningful(scope.hospitalId) ? String(scope.hospitalId).trim() : '',
    sectionId: isMeaningful(scope.sectionId) ? String(scope.sectionId).trim() : '',
    serviceId: isMeaningful(scope.serviceId) ? String(scope.serviceId).trim() : '',
    role: isMeaningful(scope.role) ? String(scope.role).trim() : '',
    year: Number(scope.year),
    month: Number(scope.month),
  };

  if (!normalized.hospitalId) {
    throw makeError(EXACT_UNDO_SCOPE_CODE, 'Undo requires hospital scope.', 400);
  }
  if (!normalized.sectionId || !isSpecificToken(normalized.serviceId) || !isSpecificToken(normalized.role)) {
    throw makeError(EXACT_UNDO_SCOPE_CODE, 'Undo requires complete schedule scope.', 400);
  }
  if (!Number.isInteger(normalized.year) || normalized.year < 2000 || normalized.year > 2100) {
    throw makeError(EXACT_UNDO_SCOPE_CODE, 'Undo requires valid year.', 400);
  }
  if (!Number.isInteger(normalized.month) || normalized.month < 1 || normalized.month > 12) {
    throw makeError(EXACT_UNDO_SCOPE_CODE, 'Undo requires valid month.', 400);
  }

  return normalized;
}

function deepClone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function captureMonthlyScheduleSnapshot(doc = {}, overrides = {}) {
  const data = overrides.data || (doc?.data && typeof doc.data === 'object' ? doc.data : {});
  const assignments = Array.isArray(overrides.assignments)
    ? overrides.assignments
    : Array.isArray(data.assignments)
    ? data.assignments
    : [];
  const rosterNamedAssignments = overrides.rosterNamedAssignments !== undefined
    ? overrides.rosterNamedAssignments
    : data?.roster?.namedAssignments || null;
  const changeLog = Array.isArray(overrides.changeLog)
    ? overrides.changeLog
    : Array.isArray(data.changeLog)
    ? data.changeLog
    : [];

  return {
    scheduleId: doc?._id ? String(doc._id) : null,
    updatedAt: doc?.updatedAt ? new Date(doc.updatedAt).toISOString() : null,
    assignments: deepClone(assignments) || [],
    rosterNamedAssignments: deepClone(rosterNamedAssignments),
    changeLog: deepClone(changeLog) || [],
  };
}

function comparableSnapshot(snapshot = {}) {
  return {
    assignments: snapshot.assignments || [],
    rosterNamedAssignments: snapshot.rosterNamedAssignments || null,
    changeLog: snapshot.changeLog || [],
  };
}

function compareCurrentToAfterSnapshot(currentDoc, afterSnapshot) {
  const current = captureMonthlyScheduleSnapshot(currentDoc);
  return stableStringify(comparableSnapshot(current)) === stableStringify(comparableSnapshot(afterSnapshot || {}));
}

async function pruneRecentOperations(scope) {
  const exactScope = assertUndoScope(scope);
  const docs = await OperationHistory.find({
    ...exactScope,
    reversible: true,
    undoStatus: 'available',
  })
    .sort({ createdAt: -1 })
    .select('_id')
    .lean();

  const expiredIds = docs.slice(10).map((item) => item._id);
  if (expiredIds.length) {
    await OperationHistory.updateMany(
      { _id: { $in: expiredIds }, undoStatus: 'available' },
      { $set: { undoStatus: 'expired', reversible: false, notReversibleReason: 'UNDO_STACK_LIMIT' } }
    );
  }
}

async function recordUndoableOperation(input = {}) {
  const scope = assertUndoScope(input.scope || input);
  const doc = await OperationHistory.create({
    ...scope,
    operationType: input.operationType,
    summary: input.summary || '',
    entityRefs: input.entityRefs || {},
    affectedCollections: input.affectedCollections || ['MonthlySchedule', 'Assignment'],
    targetCollection: input.targetCollection || 'MonthlySchedule',
    targetDocumentId: input.targetDocumentId ? String(input.targetDocumentId) : null,
    sourceScheduleId: input.sourceScheduleId ? String(input.sourceScheduleId) : null,
    beforeSnapshot: input.beforeSnapshot,
    afterSnapshot: input.afterSnapshot,
    reversible: input.reversible !== false,
    undoStatus: input.reversible === false ? 'not_supported' : 'available',
    notReversibleReason: input.notReversibleReason || '',
    createdBy: input.createdBy || null,
    createdByName: input.createdByName || '',
  });
  await pruneRecentOperations(scope);
  return doc;
}

async function listRecentOperations(scope, { limit = 10 } = {}) {
  const exactScope = assertUndoScope(scope);
  const cappedLimit = Math.max(1, Math.min(10, Number(limit) || 10));
  return OperationHistory.find(exactScope)
    .sort({ createdAt: -1 })
    .limit(cappedLimit)
    .select('-beforeSnapshot -afterSnapshot')
    .lean();
}

async function restoreBeforeSnapshot(operation, { user = {}, reason = '' } = {}) {
  if (!operation || operation.targetCollection !== 'MonthlySchedule') {
    throw makeError('UNDO_NOT_SUPPORTED', 'Bu işlem otomatik geri alınamaz.', 409);
  }

  const scope = assertUndoScope(operation);
  const query = {
    ...scope,
    ...(operation.targetDocumentId ? { _id: operation.targetDocumentId } : {}),
  };
  const current = await MonthlySchedule.findOne(query).lean();
  if (!current) {
    throw makeError('SCHEDULE_NOT_FOUND_IN_SCOPE', 'No schedule was found in the requested scope.', 404);
  }
  if (!compareCurrentToAfterSnapshot(current, operation.afterSnapshot)) {
    throw makeError(
      UNDO_CONFLICT_CODE,
      'Bu işlemden sonra aynı kayıt değiştiği için otomatik geri alma yapılamaz.',
      409
    );
  }

  const currentData = current?.data && typeof current.data === 'object' ? current.data : {};
  const before = operation.beforeSnapshot || {};
  const beforeRoster = before.rosterNamedAssignments;
  const restoredData = {
    ...currentData,
    assignments: deepClone(before.assignments || []),
    roster: {
      ...(currentData.roster && typeof currentData.roster === 'object' ? currentData.roster : {}),
      ...(beforeRoster !== undefined ? { namedAssignments: deepClone(beforeRoster) } : {}),
    },
    changeLog: [
      ...(Array.isArray(before.changeLog) ? deepClone(before.changeLog) : []),
      {
        type: 'undo',
        operationId: String(operation._id),
        operationType: operation.operationType,
        changedAt: new Date().toISOString(),
        changedBy: user?.uid || null,
        changedByName: user?.name || user?.email || '',
        reason: String(reason || '').trim(),
      },
    ].slice(-200),
  };

  const saved = await MonthlySchedule.findOneAndUpdate(
    query,
    {
      $set: {
        data: restoredData,
        updatedBy: user?.uid || null,
        updatedByName: user?.name || null,
      },
      $inc: { revision: 1 },
    },
    { new: true }
  ).lean();

  if (!saved) {
    throw makeError('SCHEDULE_NOT_FOUND_IN_SCOPE', 'No schedule was found in the requested scope.', 404);
  }
  try {
    await require('./scheduleChangeService').recordChange({
      scope: query, scheduleId: saved._id, kind: 'undo', source: 'undo',
      before: current?.data?.assignments || [], after: saved?.data?.assignments || [],
      contentRevision: Number(saved.revision || 0), user,
    });
  } catch { /* geçmiş yazımı geri almayı bozmaz */ }

  await replaceAssignmentsForSchedule({
    scope: {
      ...scope,
      sourceScheduleId: saved?._id || null,
    },
    payload: saved?.data || restoredData,
    updatedBy: user?.uid || null,
    source: 'undo',
  });

  return saved;
}

async function undoOperation(operationId, { hospitalId, user = {}, reason = '' } = {}) {
  if (!operationId) {
    throw makeError('UNDO_OPERATION_REQUIRED', 'Undo operation id is required.', 400);
  }

  const operation = await OperationHistory.findOne({
    _id: operationId,
    hospitalId: String(hospitalId || '').trim(),
  }).lean();
  if (!operation) {
    throw makeError('UNDO_OPERATION_NOT_FOUND', 'Geri alınacak işlem bulunamadı.', 404);
  }
  if (!operation.reversible || operation.undoStatus !== 'available') {
    throw makeError('UNDO_NOT_AVAILABLE', 'Bu işlem geri alınamaz.', 409);
  }

  const saved = await restoreBeforeSnapshot(operation, { user, reason });
  await OperationHistory.updateOne(
    { _id: operation._id, undoStatus: 'available' },
    {
      $set: {
        undoStatus: 'undone',
        reversible: false,
        undoneAt: new Date(),
        undoneBy: user?.uid || null,
        undoneByName: user?.name || user?.email || '',
        undoReason: String(reason || '').trim(),
      },
    }
  );

  return {
    operation,
    schedule: saved,
  };
}

module.exports = {
  EXACT_UNDO_SCOPE_CODE,
  UNDO_CONFLICT_CODE,
  assertUndoScope,
  captureMonthlyScheduleSnapshot,
  compareCurrentToAfterSnapshot,
  listRecentOperations,
  pruneRecentOperations,
  recordUndoableOperation,
  restoreBeforeSnapshot,
  undoOperation,
};
