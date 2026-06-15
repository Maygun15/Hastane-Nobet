'use strict';

jest.mock('../models/Assignment');

const {
  EXACT_PROJECTION_SCOPE_CODE,
  EXACT_PROJECTION_SCOPE_MESSAGE,
  assertExactProjectionScope,
  upsertAssignment,
  removeAssignment,
} = require('../services/assignmentSyncService');
const Assignment = require('../models/Assignment');

const VALID_SCOPE = {
  hospitalId: 'hospital-1',
  sectionId: 'calisma-cizelgesi',
  serviceId: 'service-a',
  role: 'Nurse',
  year: 2026,
  month: 6,
  sourceScheduleId: 'schedule-1',
};

function expectScopeError(scope, options) {
  expect(() => assertExactProjectionScope(scope, options)).toThrow(
    expect.objectContaining({
      code: EXACT_PROJECTION_SCOPE_CODE,
      status: 400,
      message: EXACT_PROJECTION_SCOPE_MESSAGE,
    })
  );
}

describe('assertExactProjectionScope', () => {
  test.each([
    undefined,
    null,
    '',
    '   ',
  ])('rejects missing hospitalId %p', (hospitalId) => {
    expectScopeError({ ...VALID_SCOPE, hospitalId }, { requireSourceScheduleId: true });
  });

  test.each([
    undefined,
    null,
    '',
    '   ',
    'all',
    'All Services',
    'Tümü',
    'Tüm Servisler',
  ])('rejects non-specific serviceId %p', (serviceId) => {
    expectScopeError({ ...VALID_SCOPE, serviceId }, { requireSourceScheduleId: true });
  });

  test.each([
    undefined,
    null,
    '',
    '   ',
    'all',
    'All Roles',
    'Tümü',
    'Tüm Roller',
  ])('rejects non-specific role %p', (role) => {
    expectScopeError({ ...VALID_SCOPE, role }, { requireSourceScheduleId: true });
  });

  test('requires sourceScheduleId when requested', () => {
    expectScopeError(
      { ...VALID_SCOPE, sourceScheduleId: null },
      { requireSourceScheduleId: true }
    );
  });

  test('returns a normalized immutable exact scope', () => {
    const scope = assertExactProjectionScope({
      ...VALID_SCOPE,
      sectionId: '  calisma-cizelgesi ',
      serviceId: ' service-a ',
      role: ' Nurse ',
      year: '2026',
      month: '6',
    }, { requireSourceScheduleId: true });

    expect(scope).toEqual(VALID_SCOPE);
    expect(Object.isFrozen(scope)).toBe(true);
  });

  test('upsertAssignment rejects incomplete operational scope before write', async () => {
    await expect(upsertAssignment({
      scope: { ...VALID_SCOPE, hospitalId: null },
      assignment: {
        personId: 'person-1',
        date: '2026-06-10',
        shiftId: 'N',
        roleLabel: 'Night',
      },
    })).rejects.toMatchObject({
      code: EXACT_PROJECTION_SCOPE_CODE,
    });
    expect(Assignment.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test('removeAssignment rejects incomplete operational scope before delete', async () => {
    await expect(removeAssignment({
      scope: { ...VALID_SCOPE, role: '' },
      assignment: {
        personId: 'person-1',
        date: '2026-06-10',
        shiftId: 'N',
        roleLabel: 'Night',
      },
    })).rejects.toMatchObject({
      code: EXACT_PROJECTION_SCOPE_CODE,
    });
    expect(Assignment.deleteMany).not.toHaveBeenCalled();
  });
});
