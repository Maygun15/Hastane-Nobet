'use strict';

// Adalet raporu (ROADMAP pilot #4): gece tanımı motorla aynı, bayramlar tatil takviminden.

jest.mock('../models/Assignment', () => ({ find: jest.fn() }));
jest.mock('../services/holidayService', () => ({ listHolidays: jest.fn() }));

const Assignment = require('../models/Assignment');
const { listHolidays } = require('../services/holidayService');
const {
  buildFullHolidaySet,
  computeMonthlyFairnessScores,
  isNightShift,
} = require('../services/fairnessEngine');

describe('isNightShift (rapor)', () => {
  test.each([
    [{ shiftCode: 'N' }, true],
    [{ shiftCode: 'n' }, true],
    [{ shiftCode: 'NIGHT' }, true],
    [{ shiftCode: 'V2' }, true],
    [{ shiftCode: 'G' }, true],
    [{ shiftCode: 'GECE' }, true],
    [{ shiftCode: 'X', shiftId: 'acil-gece' }, true],
    [{ shiftCode: 'X', hours: 24 }, true],
    [{ shiftCode: 'X', hours: 16 }, true],
    [{ shiftCode: 'D', hours: 8 }, false],
    [{ shiftCode: 'D', hours: 12 }, false],
    [{ shiftCode: 'A', hours: 8 }, false],
  ])('%j → %s', (a, expected) => {
    expect(isNightShift(a)).toBe(expected);
  });
});

test('buildFullHolidaySet sadece tam gün tatilleri alır', () => {
  expect([...buildFullHolidaySet([
    { date: '2027-03-09', kind: 'arife' },
    { date: '2027-03-10', kind: 'full' },
    { date: '2027-03-11' },
    { date: '2027-03-12', kind: 'half' },
  ])]).toEqual(['2027-03-10', '2027-03-11']);
});

describe('computeMonthlyFairnessScores', () => {
  beforeEach(() => jest.clearAllMocks());

  const mockAssignments = (rows) => {
    Assignment.find.mockReturnValue({ select: () => ({ lean: () => Promise.resolve(rows) }) });
  };

  test('N kodlu gece sayılır, 2027 bayramı tatil takviminden gelir', async () => {
    mockAssignments([
      { personId: 'p1', personName: 'Ayşe', shiftCode: 'N', date: '2027-03-08', weekday: 1, hours: 8 },
      { personId: 'p1', personName: 'Ayşe', shiftCode: 'D', date: '2027-03-10', weekday: 3, hours: 8 },
      { personId: 'p2', personName: 'Fatma', shiftCode: 'D', date: '2027-03-09', weekday: 2, hours: 8 },
    ]);
    listHolidays.mockResolvedValue([
      { date: '2027-03-09', kind: 'arife' },
      { date: '2027-03-10', kind: 'full', name: 'Ramazan Bayramı' },
    ]);

    const res = await computeMonthlyFairnessScores({ hospitalId: '507f1f77bcf86cd799439011', year: 2027, month: 3 });

    expect(listHolidays).toHaveBeenCalledWith({ year: 2027, month: 3, hospitalId: '507f1f77bcf86cd799439011' });
    const ayse = res.people.find((p) => p.personId === 'p1');
    const fatma = res.people.find((p) => p.personId === 'p2');
    expect(ayse).toMatchObject({ totalShifts: 2, nightCount: 1, holidayCount: 1 });
    expect(fatma).toMatchObject({ totalShifts: 1, nightCount: 0, holidayCount: 0 });
    expect(res.groupStats).toMatchObject({ totalNight: 1, totalHoliday: 1 });
  });

  test('tatil takvimi okunamazsa rapor yine üretilir (tatil 0)', async () => {
    mockAssignments([{ personId: 'p1', shiftCode: 'N', date: '2027-03-10', weekday: 3, hours: 8 }]);
    listHolidays.mockRejectedValue(new Error('db down'));
    const res = await computeMonthlyFairnessScores({ hospitalId: '507f1f77bcf86cd799439011', year: 2027, month: 3 });
    expect(res.people[0]).toMatchObject({ nightCount: 1, holidayCount: 0 });
  });
});
