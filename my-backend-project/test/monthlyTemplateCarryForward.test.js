'use strict';

jest.mock('../models/MonthlySchedule', () => ({
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
}));

const MonthlySchedule = require('../models/MonthlySchedule');
const {
  carryForwardMonthlyTemplate,
  previousYearMonth,
  sanitizeTemplateDefs,
} = require('../services/monthlyTemplateCarryForwardService');

const SCOPE = {
  hospitalId: 'hospital-1',
  sectionId: 'calisma-cizelgesi',
  serviceId: 'service-a',
  role: 'Nurse',
  year: 2026,
  month: 6,
  userId: 'admin-1',
};

function queryResult(value) {
  return { lean: jest.fn().mockResolvedValue(value) };
}

describe('monthly template carry forward service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('copies only template fields and never copies assignments or person data', async () => {
    MonthlySchedule.findOne
      .mockReturnValueOnce(queryResult({
        _id: 'june-id',
        data: { defs: [], assignments: [], pins: [], overrides: {} },
      }))
      .mockReturnValueOnce(queryResult({
        _id: 'may-id',
        data: {
          defs: [{
            id: 'row-1',
            label: 'Servis Sorumlusu',
            shiftCode: 'M',
            defaultCount: 1,
            pattern: [1, 1, 1, 1, 1, 0, 0],
            weekendOff: true,
            holidayPolicy: 'supervisor',
            personId: 'person-1',
            employeeId: 'employee-1',
            adsoyad: 'Sensitive Name',
            tckn: '11111111111',
          }],
          assignments: Array.from({ length: 465 }, () => ({ personId: 'person-1' })),
          roster: { namedAssignments: { 1: { 'row-1': ['Sensitive Name'] } } },
          pins: [{ personId: 'person-1' }],
          overrides: { 'row-1': { 1: 2 } },
        },
      }));
    MonthlySchedule.findOneAndUpdate.mockReturnValue(queryResult({
      _id: 'june-id',
      data: { defs: [{ id: 'row-1' }] },
    }));

    const result = await carryForwardMonthlyTemplate(SCOPE);

    expect(MonthlySchedule.findOne.mock.calls[0][0]).toEqual({
      hospitalId: 'hospital-1',
      sectionId: 'calisma-cizelgesi',
      serviceId: 'service-a',
      role: 'Nurse',
      year: 2026,
      month: 6,
    });
    expect(MonthlySchedule.findOne.mock.calls[1][0]).toEqual({
      hospitalId: 'hospital-1',
      sectionId: 'calisma-cizelgesi',
      serviceId: 'service-a',
      role: 'Nurse',
      year: 2026,
      month: 5,
    });
    expect(result).toMatchObject({
      carried: true,
      from: { year: 2026, month: 5 },
      to: { year: 2026, month: 6 },
      defsCount: 1,
      assignmentsCopied: 0,
    });
    const update = MonthlySchedule.findOneAndUpdate.mock.calls[0][1].$set;
    expect(update['data.defs']).toEqual([{
      id: 'row-1',
      label: 'Servis Sorumlusu',
      shiftCode: 'M',
      defaultCount: 1,
      pattern: [1, 1, 1, 1, 1, 0, 0],
      weekendOff: true,
      holidayPolicy: 'supervisor',
    }]);
    expect(JSON.stringify(update)).not.toMatch(/person-1|employee-1|Sensitive Name|11111111111/);
    expect(update).not.toHaveProperty('data.assignments');
    expect(update).not.toHaveProperty('data.roster');
    expect(update).not.toHaveProperty('data.pins');
    expect(update).not.toHaveProperty('data.overrides');
  });

  test('is idempotent when target already has defs', async () => {
    MonthlySchedule.findOne.mockReturnValue(queryResult({
      _id: 'june-id',
      data: { defs: [{ id: 'existing' }] },
    }));

    const result = await carryForwardMonthlyTemplate(SCOPE);

    expect(result).toEqual({
      carried: false,
      reason: 'TARGET_ALREADY_HAS_TEMPLATE',
      defsCount: 1,
      scheduleId: 'june-id',
    });
    expect(MonthlySchedule.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test('returns a stable error when previous template does not exist', async () => {
    MonthlySchedule.findOne
      .mockReturnValueOnce(queryResult(null))
      .mockReturnValueOnce(queryResult(null));

    await expect(carryForwardMonthlyTemplate(SCOPE)).rejects.toMatchObject({
      code: 'PREVIOUS_TEMPLATE_NOT_FOUND',
      status: 404,
    });
    expect(MonthlySchedule.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test('uses December of previous year for January', () => {
    expect(previousYearMonth(2026, 1)).toEqual({ year: 2025, month: 12 });
  });

  test('sanitizer drops all person-specific fields', () => {
    expect(sanitizeTemplateDefs([{
      id: 'row-1',
      shiftCode: 'N',
      hours: 12,
      requiredCount: 2,
      personId: 'person-1',
      employeeId: 'employee-1',
      adsoyad: 'Name',
      tckn: '123',
    }])).toEqual([{
      id: 'row-1',
      shiftCode: 'N',
      hours: 12,
      requiredCount: 2,
    }]);
  });
});
