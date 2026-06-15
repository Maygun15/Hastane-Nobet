'use strict';

jest.mock('../models/Assignment', () => ({
  findOne: jest.fn(),
}));

const Assignment = require('../models/Assignment');
const {
  verifySwapCreationAssignments,
} = require('../services/swapRequestCreationService');

const HOSPITAL_ID = '507f1f77bcf86cd799439011';
const REQUESTER_PERSON_ID = '507f1f77bcf86cd799439012';
const TARGET_PERSON_ID = '507f1f77bcf86cd799439013';
const SOURCE_ASSIGNMENT_ID = '507f1f77bcf86cd799439014';
const TARGET_ASSIGNMENT_ID = '507f1f77bcf86cd799439015';

const SOURCE_ASSIGNMENT = {
  _id: SOURCE_ASSIGNMENT_ID,
  sourceScheduleId: '507f1f77bcf86cd799439016',
  sectionId: 'calisma-cizelgesi',
  serviceId: 'service-a',
  role: 'Nurse',
  year: 2026,
  month: 6,
  date: '2026-06-10',
  rowId: 'night-row',
  shiftId: 'N',
  shiftCode: 'N',
  roleLabel: 'Night',
  personId: REQUESTER_PERSON_ID,
  personName: 'Person One',
};

const TARGET_ASSIGNMENT = {
  _id: TARGET_ASSIGNMENT_ID,
  sourceScheduleId: '507f1f77bcf86cd799439016',
  sectionId: 'calisma-cizelgesi',
  serviceId: 'service-a',
  role: 'Nurse',
  year: 2026,
  month: 6,
  date: '2026-06-20',
  rowId: 'day-row',
  shiftId: 'G',
  shiftCode: 'G',
  roleLabel: 'Day',
  personId: TARGET_PERSON_ID,
  personName: 'Person Two',
};

function queryResult(value) {
  return {
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(value),
  };
}

function mockAssignments(source = SOURCE_ASSIGNMENT, target = TARGET_ASSIGNMENT) {
  Assignment.findOne.mockImplementation((query) => {
    if (String(query?._id) === SOURCE_ASSIGNMENT_ID) return queryResult(source);
    if (String(query?._id) === TARGET_ASSIGNMENT_ID) return queryResult(target);
    return queryResult(null);
  });
}

function validInput(overrides = {}) {
  return {
    hospitalId: HOSPITAL_ID,
    requesterPersonId: REQUESTER_PERSON_ID,
    swapWithPersonId: TARGET_PERSON_ID,
    swapMyAssignmentId: SOURCE_ASSIGNMENT_ID,
    swapTargetAssignmentId: TARGET_ASSIGNMENT_ID,
    swapMyDate: '2026-06-10',
    swapTargetDate: '2026-06-20',
    swapMyShiftId: 'N',
    swapTargetShiftId: 'G',
    ...overrides,
  };
}

describe('verified Assignment swap creation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test.each([
    ['both missing', { swapMyAssignmentId: '', swapTargetAssignmentId: '' }],
    ['source missing', { swapMyAssignmentId: '' }],
    ['target missing', { swapTargetAssignmentId: '' }],
  ])('%s assignment selection returns SWAP_ASSIGNMENT_SELECTION_REQUIRED', async (_label, override) => {
    await expect(verifySwapCreationAssignments(validInput(override))).rejects.toMatchObject({
      status: 400,
      code: 'SWAP_ASSIGNMENT_SELECTION_REQUIRED',
      message: 'Both swap shifts must be selected from verified assignments.',
    });
    expect(Assignment.findOne).not.toHaveBeenCalled();
  });

  test('unknown Assignment id returns INVALID_SWAP_ASSIGNMENT_SCOPE', async () => {
    mockAssignments(null, TARGET_ASSIGNMENT);

    await expect(verifySwapCreationAssignments(validInput())).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_SWAP_ASSIGNMENT_SCOPE',
    });
  });

  test.each([
    ['section', { sectionId: 'other-section' }],
    ['service', { serviceId: 'service-b' }],
    ['role', { role: 'Doctor' }],
    ['month', { month: 7, date: '2026-07-20' }],
  ])('different %s scope returns INVALID_SWAP_ASSIGNMENT_SCOPE', async (_label, targetOverride) => {
    mockAssignments(SOURCE_ASSIGNMENT, { ...TARGET_ASSIGNMENT, ...targetOverride });

    await expect(verifySwapCreationAssignments(validInput({
      swapTargetDate: targetOverride.date || '2026-06-20',
    }))).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_SWAP_ASSIGNMENT_SCOPE',
    });
  });

  test.each([
    ['empty service', { serviceId: '' }],
    ['all service', { serviceId: 'All Services' }],
    ['empty role', { role: '' }],
    ['all role', { role: 'Tüm Roller' }],
  ])('%s is not accepted as complete operational scope', async (_label, sourceOverride) => {
    mockAssignments({ ...SOURCE_ASSIGNMENT, ...sourceOverride }, {
      ...TARGET_ASSIGNMENT,
      ...sourceOverride,
    });

    await expect(verifySwapCreationAssignments(validInput())).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_SWAP_ASSIGNMENT_SCOPE',
    });
  });

  test('person or submitted shift mismatch returns INVALID_SWAP_ASSIGNMENT_SCOPE', async () => {
    mockAssignments();

    await expect(verifySwapCreationAssignments(validInput({
      swapWithPersonId: '507f1f77bcf86cd799439099',
    }))).rejects.toMatchObject({
      code: 'INVALID_SWAP_ASSIGNMENT_SCOPE',
    });

    await expect(verifySwapCreationAssignments(validInput({
      swapMyShiftId: 'V1',
    }))).rejects.toMatchObject({
      code: 'INVALID_SWAP_ASSIGNMENT_SCOPE',
    });
  });

  test('queries both assignments under authenticated hospital scope', async () => {
    mockAssignments();

    await verifySwapCreationAssignments(validInput());

    expect(Assignment.findOne).toHaveBeenNthCalledWith(1, {
      _id: SOURCE_ASSIGNMENT_ID,
      hospitalId: HOSPITAL_ID,
    });
    expect(Assignment.findOne).toHaveBeenNthCalledWith(2, {
      _id: TARGET_ASSIGNMENT_ID,
      hospitalId: HOSPITAL_ID,
    });
  });

  test('valid same-scope assignments produce trusted Request fields', async () => {
    mockAssignments();

    const result = await verifySwapCreationAssignments(validInput());

    expect(result.requestFields).toEqual({
      swapMyAssignmentId: SOURCE_ASSIGNMENT_ID,
      swapTargetAssignmentId: TARGET_ASSIGNMENT_ID,
      swapWithPersonId: TARGET_PERSON_ID,
      swapWithPersonName: 'Person Two',
      swapSectionId: 'calisma-cizelgesi',
      serviceId: 'service-a',
      role: 'Nurse',
      swapMyDate: '2026-06-10',
      swapMyShiftId: 'N',
      swapMyShiftLabel: 'Night',
      swapTargetDate: '2026-06-20',
      swapTargetShiftId: 'G',
      swapTargetShiftLabel: 'Day',
    });
  });
});
