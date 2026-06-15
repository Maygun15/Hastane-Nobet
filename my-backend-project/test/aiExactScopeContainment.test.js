'use strict';

jest.mock('../models/MonthlySchedule', () => ({
  findOne: jest.fn(),
  findByIdAndUpdate: jest.fn(),
}));
jest.mock('../models/Setting');
jest.mock('../models/Person', () => ({
  findOne: jest.fn(),
}));
jest.mock('../services/assignmentSyncService', () => ({
  assertExactProjectionScope: jest.fn((scope) => {
    const normalized = {
      hospitalId: String(scope?.hospitalId || '').trim(),
      sectionId: String(scope?.sectionId || '').trim(),
      serviceId: String(scope?.serviceId || '').trim(),
      role: String(scope?.role || '').trim(),
      year: Number(scope?.year),
      month: Number(scope?.month),
      sourceScheduleId: scope?.sourceScheduleId || null,
    };
    if (
      !normalized.hospitalId
      || !normalized.sectionId
      || !normalized.serviceId
      || !normalized.role
      || !normalized.year
      || !normalized.month
    ) {
      const error = new Error('scope');
      error.code = 'EXACT_PROJECTION_SCOPE_REQUIRED';
      throw error;
    }
    return Object.freeze(normalized);
  }),
  upsertAssignment: jest.fn().mockResolvedValue({}),
  removeAssignment: jest.fn().mockResolvedValue({ deletedCount: 1 }),
}));

const MonthlySchedule = require('../models/MonthlySchedule');
const Person = require('../models/Person');
const {
  upsertAssignment,
  removeAssignment,
} = require('../services/assignmentSyncService');
const { executeCommand } = require('../services/aiExecutorService');

const EXACT_SCOPE = {
  hospitalId: 'hospital-1',
  sectionId: 'calisma-cizelgesi',
  serviceId: 'service-a',
  role: 'Nurse',
  year: 2026,
  month: 6,
};

const BASE_ENTITIES = {
  person: 'Person One',
  date: '2026-06-10',
  shiftCode: 'N',
  shiftLabel: 'Night',
  sectionId: EXACT_SCOPE.sectionId,
  serviceId: EXACT_SCOPE.serviceId,
  role: EXACT_SCOPE.role,
};

function queryResult(value) {
  return {
    lean: jest.fn().mockResolvedValue(value),
  };
}

function scheduleDoc(assignments = []) {
  return {
    _id: 'schedule-1',
    ...EXACT_SCOPE,
    data: { assignments },
  };
}

function configurePerson() {
  Person.findOne.mockReturnValue(queryResult({
    _id: 'person-1',
    name: 'Person One',
    hospitalId: EXACT_SCOPE.hospitalId,
    serviceId: EXACT_SCOPE.serviceId,
  }));
}

describe('AI assignment exact-scope containment', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    configurePerson();
    MonthlySchedule.findByIdAndUpdate.mockResolvedValue({});
    upsertAssignment.mockResolvedValue({});
    removeAssignment.mockResolvedValue({ deletedCount: 1 });
  });

  test.each([
    ['assign without sectionId', 'assign_shift', { sectionId: '' }],
    ['assign without role', 'assign_shift', { role: '' }],
    ['remove without sectionId', 'remove_shift', { sectionId: '' }],
    ['remove without role', 'remove_shift', { role: '' }],
  ])('%s returns AI_SCOPE_AMBIGUOUS before mutation', async (_label, intent, override) => {
    await expect(executeCommand({
      intent,
      hospitalId: EXACT_SCOPE.hospitalId,
      entities: { ...BASE_ENTITIES, ...override },
    })).rejects.toMatchObject({
      code: 'AI_SCOPE_AMBIGUOUS',
      status: 409,
      message: 'AI assignment changes require a complete schedule scope.',
    });
    expect(MonthlySchedule.findOne).not.toHaveBeenCalled();
    expect(MonthlySchedule.findByIdAndUpdate).not.toHaveBeenCalled();
    expect(upsertAssignment).not.toHaveBeenCalled();
    expect(removeAssignment).not.toHaveBeenCalled();
  });

  test('AI assign uses one exact MonthlySchedule query and exact projection scope', async () => {
    MonthlySchedule.findOne.mockReturnValue(queryResult(scheduleDoc([])));

    const result = await executeCommand({
      intent: 'assign_shift',
      hospitalId: EXACT_SCOPE.hospitalId,
      entities: BASE_ENTITIES,
    });

    expect(result.ok).toBe(true);
    expect(MonthlySchedule.findOne).toHaveBeenCalledTimes(1);
    expect(MonthlySchedule.findOne).toHaveBeenCalledWith(EXACT_SCOPE);
    expect(upsertAssignment).toHaveBeenCalledWith(expect.objectContaining({
      scope: {
        ...EXACT_SCOPE,
        sourceScheduleId: 'schedule-1',
      },
    }));
  });

  test('AI remove uses one exact MonthlySchedule query and exact projection scope', async () => {
    MonthlySchedule.findOne.mockReturnValue(queryResult(scheduleDoc([{
      personId: 'person-1',
      personName: 'Person One',
      date: '2026-06-10',
      rowId: 'night-row',
      shiftId: 'N',
      shiftCode: 'N',
      roleLabel: 'Night',
    }])));

    const result = await executeCommand({
      intent: 'remove_shift',
      hospitalId: EXACT_SCOPE.hospitalId,
      entities: BASE_ENTITIES,
    });

    expect(result.ok).toBe(true);
    expect(MonthlySchedule.findOne).toHaveBeenCalledTimes(1);
    expect(MonthlySchedule.findOne).toHaveBeenCalledWith(EXACT_SCOPE);
    expect(removeAssignment).toHaveBeenCalledWith(expect.objectContaining({
      scope: {
        ...EXACT_SCOPE,
        sourceScheduleId: 'schedule-1',
      },
    }));
  });

  test('exact query cannot select a Doctor schedule for a Nurse mutation', async () => {
    MonthlySchedule.findOne.mockImplementation((query) =>
      queryResult(query.role === 'Nurse' ? scheduleDoc([]) : null)
    );

    await executeCommand({
      intent: 'assign_shift',
      hospitalId: EXACT_SCOPE.hospitalId,
      entities: BASE_ENTITIES,
    });

    expect(MonthlySchedule.findOne).toHaveBeenCalledWith(EXACT_SCOPE);
    expect(MonthlySchedule.findOne.mock.calls[0][0].role).not.toBe('Doctor');
  });

  test('missing exact schedule returns SCHEDULE_NOT_FOUND_IN_SCOPE without mutation', async () => {
    MonthlySchedule.findOne.mockReturnValue(queryResult(null));

    await expect(executeCommand({
      intent: 'assign_shift',
      hospitalId: EXACT_SCOPE.hospitalId,
      entities: BASE_ENTITIES,
    })).rejects.toMatchObject({
      code: 'SCHEDULE_NOT_FOUND_IN_SCOPE',
      status: 404,
    });
    expect(MonthlySchedule.findByIdAndUpdate).not.toHaveBeenCalled();
    expect(upsertAssignment).not.toHaveBeenCalled();
  });

  test('AI assign projection failure is propagated after MonthlySchedule mutation', async () => {
    MonthlySchedule.findOne.mockReturnValue(queryResult(scheduleDoc([])));
    upsertAssignment.mockRejectedValueOnce(new Error('projection unavailable'));

    await expect(executeCommand({
      intent: 'assign_shift',
      hospitalId: EXACT_SCOPE.hospitalId,
      entities: BASE_ENTITIES,
    })).rejects.toMatchObject({
      code: 'PROJECTION_SYNC_FAILED',
      status: 500,
      sourceMutationApplied: true,
    });
    expect(MonthlySchedule.findByIdAndUpdate).toHaveBeenCalledTimes(1);
  });

  test('AI remove treats zero projection deletes as PROJECTION_SYNC_FAILED', async () => {
    MonthlySchedule.findOne.mockReturnValue(queryResult(scheduleDoc([{
      personId: 'person-1',
      personName: 'Person One',
      date: '2026-06-10',
      shiftId: 'N',
      shiftCode: 'N',
      roleLabel: 'Night',
    }])));
    removeAssignment.mockResolvedValueOnce({ deletedCount: 0 });

    await expect(executeCommand({
      intent: 'remove_shift',
      hospitalId: EXACT_SCOPE.hospitalId,
      entities: BASE_ENTITIES,
    })).rejects.toMatchObject({
      code: 'PROJECTION_SYNC_FAILED',
      status: 500,
    });
    expect(MonthlySchedule.findByIdAndUpdate).toHaveBeenCalledTimes(1);
  });
});
