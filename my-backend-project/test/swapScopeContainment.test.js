'use strict';

jest.mock('../models/Request', () => ({
  findOneAndUpdate: jest.fn(),
  updateOne: jest.fn(),
}));
jest.mock('../models/Person', () => ({
  findById: jest.fn(),
}));
jest.mock('../models/MonthlySchedule', () => ({
  findOne: jest.fn(),
}));
jest.mock('../models/ScheduleRules', () => ({
  findOne: jest.fn(),
}));
jest.mock('../models/Setting');
jest.mock('../models/LeaveBalance');
jest.mock('../models/LeaveType');
jest.mock('../services/sseService', () => ({
  broadcastAll: jest.fn(),
}));
jest.mock('../services/notificationService', () => ({
  sendLeaveApproved: jest.fn(),
  sendLeaveRejected: jest.fn(),
  sendShiftChanged: jest.fn().mockResolvedValue(undefined),
  saveAndBroadcast: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/assignmentSyncService', () => ({
  assertExactProjectionScope: jest.fn((scope) => Object.freeze({ ...scope })),
  replaceAssignmentsForSchedule: jest.fn().mockResolvedValue({ count: 2 }),
}));
jest.mock('../services/fairnessEngine', () => ({
  computeMonthlyFairnessScores: jest.fn(),
}));

const Request = require('../models/Request');
const Person = require('../models/Person');
const MonthlySchedule = require('../models/MonthlySchedule');
const ScheduleRules = require('../models/ScheduleRules');
const { broadcastAll } = require('../services/sseService');
const { sendShiftChanged, saveAndBroadcast } = require('../services/notificationService');
const { replaceAssignmentsForSchedule } = require('../services/assignmentSyncService');
const {
  approveSwapRequest,
  checkSwapConflicts,
  executeSwap,
  validateSwap,
  validateSwapOperationalScope,
} = require('../services/requestService');

const EXACT_SCOPE = {
  hospitalId: 'hospital-1',
  sectionId: 'calisma-cizelgesi',
  serviceId: 'service-a',
  role: 'Nurse',
  year: 2026,
  month: 6,
};

const BASE_REQUEST = {
  _id: 'request-1',
  type: 'takas',
  hospitalId: EXACT_SCOPE.hospitalId,
  swapSectionId: EXACT_SCOPE.sectionId,
  serviceId: EXACT_SCOPE.serviceId,
  role: EXACT_SCOPE.role,
  status: 'pending',
  swapExecuted: false,
  fromUserId: 'user-1',
  fromPersonId: 'person-1',
  fromName: 'Person One',
  swapWithPersonId: 'person-2',
  swapWithPersonName: 'Person Two',
  swapMyDate: '2026-06-10',
  swapMyShiftId: 'N',
  swapMyShiftLabel: 'Night',
  swapTargetDate: '2026-06-20',
  swapTargetShiftId: 'G',
  swapTargetShiftLabel: 'Day',
};

function queryResult(value) {
  return {
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(value),
    then(resolve, reject) {
      return Promise.resolve(value).then(resolve, reject);
    },
  };
}

function makeScheduleDoc() {
  return {
    _id: 'schedule-nurse',
    ...EXACT_SCOPE,
    createdBy: 'admin-1',
    data: {
      defs: [],
      assignments: [
        {
          personId: 'person-1',
          personName: 'Person One',
          date: '2026-06-10',
          shiftId: 'N',
          shiftCode: 'N',
        },
        {
          personId: 'person-2',
          personName: 'Person Two',
          date: '2026-06-20',
          shiftId: 'G',
          shiftCode: 'G',
        },
      ],
    },
    markModified: jest.fn(),
    save: jest.fn().mockResolvedValue(undefined),
  };
}

function configureExactSchedule(doc = makeScheduleDoc()) {
  MonthlySchedule.findOne.mockImplementation((filter) => {
    const isExact = Object.entries(EXACT_SCOPE).every(
      ([key, value]) => String(filter?.[key] ?? '') === String(value)
    );
    return queryResult(isExact ? doc : null);
  });
  return doc;
}

function configurePeople() {
  Person.findById.mockImplementation((id) =>
    queryResult(
      id === 'person-1'
        ? { _id: id, name: 'Person One' }
        : { _id: id, name: 'Person Two' }
    )
  );
}

function approvalArgs(request) {
  return {
    req: { hospitalId: EXACT_SCOPE.hospitalId, user: { role: 'admin' } },
    request,
    adminNote: '',
    actorUserId: 'admin-1',
    actorName: 'Admin',
    forceSwap: false,
    previousStatus: 'pending',
  };
}

describe('swap exact-scope containment', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    ScheduleRules.findOne.mockReturnValue(queryResult({ enabled: false }));
    Request.updateOne.mockResolvedValue({ acknowledged: true });
  });

  test.each([
    ['missing role', { role: undefined }],
    ['null role', { role: null }],
    ['empty role', { role: '' }],
    ['whitespace role', { role: '   ' }],
    ['all role', { role: 'all' }],
    ['all roles', { role: 'All Roles' }],
    ['tümü role', { role: 'Tümü' }],
    ['tüm roller role', { role: 'Tüm Roller' }],
    ['cross-month dates', { swapTargetDate: '2026-07-01' }],
  ])('%s returns SWAP_SCOPE_AMBIGUOUS without side effects', async (_label, override) => {
    const request = { ...BASE_REQUEST, ...override };
    if (override.role === undefined) delete request.role;

    const result = await approveSwapRequest(approvalArgs(request));

    expect(result).toEqual({
      ok: false,
      httpStatus: 409,
      code: 'SWAP_SCOPE_AMBIGUOUS',
      message: 'The swap request does not contain a complete schedule scope.',
    });
    expect(Request.findOneAndUpdate).not.toHaveBeenCalled();
    expect(Request.updateOne).not.toHaveBeenCalled();
    expect(MonthlySchedule.findOne).not.toHaveBeenCalled();
    expect(replaceAssignmentsForSchedule).not.toHaveBeenCalled();
    expect(sendShiftChanged).not.toHaveBeenCalled();
    expect(saveAndBroadcast).not.toHaveBeenCalled();
    expect(broadcastAll).not.toHaveBeenCalled();
    expect(request.status).toBe('pending');
    expect(request.swapExecuted).toBe(false);
  });

  test('direct executeSwap cannot bypass the scope guard', async () => {
    await expect(executeSwap({ ...BASE_REQUEST, role: '' })).rejects.toMatchObject({
      code: 'SWAP_SCOPE_AMBIGUOUS',
      status: 409,
    });
    expect(MonthlySchedule.findOne).not.toHaveBeenCalled();
    expect(replaceAssignmentsForSchedule).not.toHaveBeenCalled();
  });

  test('missing exact schedule returns SCHEDULE_NOT_FOUND_IN_SCOPE before status update', async () => {
    MonthlySchedule.findOne.mockReturnValue(queryResult(null));

    const result = await approveSwapRequest(approvalArgs({ ...BASE_REQUEST }));

    expect(result).toEqual({
      ok: false,
      httpStatus: 404,
      code: 'SCHEDULE_NOT_FOUND_IN_SCOPE',
      message: 'No schedule was found in the requested scope.',
    });
    expect(Request.findOneAndUpdate).not.toHaveBeenCalled();
    expect(Request.updateOne).not.toHaveBeenCalled();
    expect(replaceAssignmentsForSchedule).not.toHaveBeenCalled();
    expect(sendShiftChanged).not.toHaveBeenCalled();
    expect(broadcastAll).not.toHaveBeenCalled();
  });

  test('validation and conflict checks query only the exact role-aware scope', async () => {
    configureExactSchedule();
    configurePeople();

    await validateSwap({ ...BASE_REQUEST });
    await checkSwapConflicts({ ...BASE_REQUEST });

    expect(ScheduleRules.findOne).toHaveBeenCalledWith({
      hospitalId: EXACT_SCOPE.hospitalId,
      sectionId: EXACT_SCOPE.sectionId,
      serviceId: EXACT_SCOPE.serviceId,
      role: EXACT_SCOPE.role,
    });
    expect(MonthlySchedule.findOne).toHaveBeenCalledTimes(2);
    for (const [filter] of MonthlySchedule.findOne.mock.calls) {
      expect(filter).toEqual(EXACT_SCOPE);
      expect(filter.role).not.toBe('Doctor');
    }
  });

  test('exact same-month Nurse request reaches existing execution behavior', async () => {
    const scheduleDoc = configureExactSchedule();
    configurePeople();
    const updatedRequest = { ...BASE_REQUEST, swapExecuted: false };
    Request.findOneAndUpdate.mockResolvedValue(updatedRequest);

    const result = await approveSwapRequest(approvalArgs({ ...BASE_REQUEST }));

    expect(result.ok).toBe(true);
    expect(Request.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(scheduleDoc.save).toHaveBeenCalledTimes(1);
    expect(replaceAssignmentsForSchedule).toHaveBeenCalledTimes(1);
    expect(replaceAssignmentsForSchedule).toHaveBeenCalledWith(expect.objectContaining({
      scope: {
        ...EXACT_SCOPE,
        sourceScheduleId: scheduleDoc._id,
      },
    }));
    expect(Request.updateOne).toHaveBeenCalledWith(
      expect.any(Object),
      { $set: { swapExecuted: true } }
    );
    expect(sendShiftChanged).toHaveBeenCalledTimes(2);
    expect(broadcastAll).toHaveBeenCalledWith('assignments:refresh', {
      serviceId: EXACT_SCOPE.serviceId,
    });
    expect(MonthlySchedule.findOne).toHaveBeenCalledTimes(3);
    for (const [filter] of MonthlySchedule.findOne.mock.calls) {
      expect(filter).toEqual(EXACT_SCOPE);
    }
  });

  test('projection sync failure is reported without success notifications or SSE', async () => {
    const scheduleDoc = configureExactSchedule();
    configurePeople();
    const updatedRequest = { ...BASE_REQUEST, swapExecuted: false };
    Request.findOneAndUpdate.mockResolvedValue(updatedRequest);
    replaceAssignmentsForSchedule.mockRejectedValueOnce(new Error('projection unavailable'));

    const result = await approveSwapRequest(approvalArgs({ ...BASE_REQUEST }));

    expect(result).toEqual({
      ok: false,
      httpStatus: 500,
      code: 'PROJECTION_SYNC_FAILED',
      message: 'Assignment projection synchronization failed after the schedule was updated.',
    });
    expect(scheduleDoc.save).toHaveBeenCalledTimes(1);
    expect(Request.updateOne).toHaveBeenCalledWith(
      expect.any(Object),
      { $set: { adminNote: 'Assignment projection synchronization failed after the schedule was updated.' } }
    );
    expect(Request.updateOne).not.toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ $set: expect.objectContaining({ status: 'pending' }) })
    );
    expect(sendShiftChanged).not.toHaveBeenCalled();
    expect(saveAndBroadcast).not.toHaveBeenCalled();
    expect(broadcastAll).not.toHaveBeenCalled();
  });

  test('validateSwapOperationalScope derives the exact same-month scope', () => {
    expect(validateSwapOperationalScope(BASE_REQUEST)).toEqual(EXACT_SCOPE);
  });
});
