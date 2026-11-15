'use strict';

jest.mock('../models/MonthlySchedule', () => ({
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
}));
jest.mock('../models/OperationHistory', () => ({
  create: jest.fn(),
  find: jest.fn(),
  findOne: jest.fn(),
  updateMany: jest.fn(),
  updateOne: jest.fn(),
}));
jest.mock('../services/assignmentSyncService', () => ({
  replaceAssignmentsForSchedule: jest.fn(),
}));

const MonthlySchedule = require('../models/MonthlySchedule');
const OperationHistory = require('../models/OperationHistory');
const { replaceAssignmentsForSchedule } = require('../services/assignmentSyncService');
const {
  EXACT_UNDO_SCOPE_CODE,
  UNDO_CONFLICT_CODE,
  assertUndoScope,
  captureMonthlyScheduleSnapshot,
  listRecentOperations,
  recordUndoableOperation,
  undoOperation,
} = require('../services/undoService');

const SCOPE = {
  hospitalId: 'hospital-1',
  sectionId: 'calisma-cizelgesi',
  serviceId: 'service-a',
  role: 'Nurse',
  year: 2026,
  month: 6,
};

const BASE_ASSIGNMENT = {
  date: '2026-06-10',
  shiftCode: 'N',
  shiftId: 'row-n',
  rowId: 'row-n',
  personId: 'p1',
  personName: 'Person One',
};

function lean(value) {
  return { lean: jest.fn().mockResolvedValue(value) };
}

function findChain(value) {
  return {
    sort: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(value),
  };
}

function schedule(assignments = [BASE_ASSIGNMENT], changeLog = []) {
  return {
    _id: 'schedule-1',
    ...SCOPE,
    data: {
      assignments,
      roster: { namedAssignments: { '2026-06-10': { 'row-n': assignments[0]?.personName || '' } } },
      changeLog,
    },
    updatedAt: '2026-06-20T12:00:00.000Z',
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  OperationHistory.find.mockReturnValue(findChain([]));
  OperationHistory.updateMany.mockResolvedValue({ modifiedCount: 0 });
  OperationHistory.updateOne.mockResolvedValue({ modifiedCount: 1 });
  replaceAssignmentsForSchedule.mockResolvedValue({ ok: true });
});

describe('undo exact scope validation', () => {
  test.each([
    { hospitalId: '' },
    { sectionId: '' },
    { serviceId: '' },
    { serviceId: 'all' },
    { serviceId: 'Tümü' },
    { role: '' },
    { role: 'all roles' },
    { role: 'Tüm Roller' },
    { year: 'bad' },
    { month: 13 },
  ])('rejects incomplete scope %p', (patch) => {
    expect(() => assertUndoScope({ ...SCOPE, ...patch })).toThrow(
      expect.objectContaining({ code: EXACT_UNDO_SCOPE_CODE })
    );
  });

  test('accepts exact scope and normalizes numbers', () => {
    expect(assertUndoScope({ ...SCOPE, year: '2026', month: '6' })).toEqual(SCOPE);
  });
});

describe('operation history recording/listing', () => {
  test('records undoable operation and prunes older available operations', async () => {
    OperationHistory.create.mockResolvedValue({ _id: 'op-new' });
    OperationHistory.find.mockReturnValue(findChain(Array.from({ length: 12 }, (_, index) => ({ _id: `op-${index}` }))));

    await recordUndoableOperation({
      scope: SCOPE,
      operationType: 'MANUAL_ASSIGNMENT_ADD',
      beforeSnapshot: captureMonthlyScheduleSnapshot(schedule([])),
      afterSnapshot: captureMonthlyScheduleSnapshot(schedule([BASE_ASSIGNMENT])),
      targetDocumentId: 'schedule-1',
      createdBy: 'admin-1',
    });

    expect(OperationHistory.create).toHaveBeenCalledWith(expect.objectContaining({
      ...SCOPE,
      operationType: 'MANUAL_ASSIGNMENT_ADD',
      undoStatus: 'available',
    }));
    expect(OperationHistory.updateMany).toHaveBeenCalledWith(
      { _id: { $in: ['op-10', 'op-11'] }, undoStatus: 'available' },
      { $set: { undoStatus: 'expired', reversible: false, notReversibleReason: 'UNDO_STACK_LIMIT' } }
    );
  });

  test('lists recent operations without snapshots', async () => {
    OperationHistory.find.mockReturnValue(findChain([{ _id: 'op-1', operationType: 'MANUAL_ASSIGNMENT_DELETE' }]));

    const rows = await listRecentOperations(SCOPE);

    expect(rows).toHaveLength(1);
    expect(OperationHistory.find).toHaveBeenCalledWith(SCOPE);
  });
});

describe('undo operation', () => {
  test('restores MonthlySchedule snapshot and resyncs Assignment projection', async () => {
    const before = captureMonthlyScheduleSnapshot(schedule([]));
    const afterSchedule = schedule([BASE_ASSIGNMENT], [{ type: 'manualAdd' }]);
    const after = captureMonthlyScheduleSnapshot(afterSchedule);
    const restored = schedule([], [{ type: 'undo' }]);
    const operation = {
      _id: 'op-1',
      ...SCOPE,
      operationType: 'MANUAL_ASSIGNMENT_ADD',
      targetCollection: 'MonthlySchedule',
      targetDocumentId: 'schedule-1',
      beforeSnapshot: before,
      afterSnapshot: after,
      reversible: true,
      undoStatus: 'available',
    };

    OperationHistory.findOne.mockReturnValue(lean(operation));
    MonthlySchedule.findOne.mockReturnValue(lean(afterSchedule));
    MonthlySchedule.findOneAndUpdate.mockReturnValue(lean(restored));

    const result = await undoOperation('op-1', {
      hospitalId: SCOPE.hospitalId,
      user: { uid: 'admin-1', name: 'Admin' },
      reason: 'test',
    });

    expect(result.schedule).toEqual(restored);
    expect(MonthlySchedule.findOneAndUpdate).toHaveBeenCalledWith(
      { ...SCOPE, _id: 'schedule-1' },
      expect.objectContaining({
        $set: expect.objectContaining({
          data: expect.objectContaining({
            assignments: [],
            changeLog: expect.arrayContaining([expect.objectContaining({ type: 'undo', operationId: 'op-1' })]),
          }),
        }),
      }),
      { new: true }
    );
    expect(replaceAssignmentsForSchedule).toHaveBeenCalledWith(expect.objectContaining({
      scope: { ...SCOPE, sourceScheduleId: 'schedule-1' },
      source: 'undo',
    }));
    expect(OperationHistory.updateOne).toHaveBeenCalledWith(
      { _id: 'op-1', undoStatus: 'available' },
      expect.objectContaining({ $set: expect.objectContaining({ undoStatus: 'undone', reversible: false }) })
    );
  });

  test('rejects undo when current state differs from afterSnapshot', async () => {
    const operation = {
      _id: 'op-1',
      ...SCOPE,
      operationType: 'MANUAL_ASSIGNMENT_ADD',
      targetCollection: 'MonthlySchedule',
      targetDocumentId: 'schedule-1',
      beforeSnapshot: captureMonthlyScheduleSnapshot(schedule([])),
      afterSnapshot: captureMonthlyScheduleSnapshot(schedule([BASE_ASSIGNMENT])),
      reversible: true,
      undoStatus: 'available',
    };

    OperationHistory.findOne.mockReturnValue(lean(operation));
    MonthlySchedule.findOne.mockReturnValue(lean(schedule([{ ...BASE_ASSIGNMENT, personId: 'p2' }])));

    await expect(undoOperation('op-1', { hospitalId: SCOPE.hospitalId })).rejects.toMatchObject({
      code: UNDO_CONFLICT_CODE,
      status: 409,
    });
    expect(MonthlySchedule.findOneAndUpdate).not.toHaveBeenCalled();
    expect(replaceAssignmentsForSchedule).not.toHaveBeenCalled();
  });

  test('rejects double undo before touching MonthlySchedule', async () => {
    OperationHistory.findOne.mockReturnValue(lean({
      _id: 'op-1',
      ...SCOPE,
      reversible: false,
      undoStatus: 'undone',
    }));

    await expect(undoOperation('op-1', { hospitalId: SCOPE.hospitalId })).rejects.toMatchObject({
      code: 'UNDO_NOT_AVAILABLE',
      status: 409,
    });
    expect(MonthlySchedule.findOne).not.toHaveBeenCalled();
  });
});
