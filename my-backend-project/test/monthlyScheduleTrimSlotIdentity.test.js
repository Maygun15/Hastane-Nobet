'use strict';

jest.mock('../models/MonthlySchedule');
jest.mock('../models/Assignment');
jest.mock('../models/ScheduleRules');
jest.mock('../models/GeneratedSchedule');
jest.mock('../services/holidayService', () => ({ listHolidays: jest.fn().mockResolvedValue([]) }));
jest.mock('../services/notificationService', () => ({
  sendShiftChanged: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/conflictService', () => ({
  checkSameDayConflict: jest.fn(),
  checkLeaveConflict: jest.fn(),
}));
jest.mock('../services/assignmentSyncService', () => ({
  replaceAssignmentsForSchedule: jest.fn(),
  removeAssignment: jest.fn(),
}));
jest.mock('../services/monthlyTemplateCarryForwardService', () => ({
  carryForwardMonthlyTemplate: jest.fn(),
}));

const schedulesRouter = require('../routes/schedules.routes');

const {
  chooseMonthlyResponseAssignments,
  trimOverbookedAssignments,
  slotKey,
} = schedulesRouter.__test;

function buildNamedFixture(count) {
  const namedAssignments = {};
  const defs = [];
  for (let index = 0; index < count; index += 1) {
    const day = String((index % 30) + 1);
    const rowId = `row-${index}`;
    if (!namedAssignments[day]) namedAssignments[day] = {};
    namedAssignments[day][rowId] = [`Person ${index}`];
    defs.push({
      id: rowId,
      rowId,
      shiftCode: index % 2 === 0 ? 'V1' : 'M',
      label: `Task ${index}`,
    });
  }
  return { defs, namedAssignments };
}

describe('MonthlySchedule GET trimOverbookedAssignments slot identity', () => {
  it('keeps same-day same-shift assignments when they belong to different duty rows', () => {
    const assignments = [
      { date: '2026-06-01', shiftCode: 'V1', rowId: 'row-a', area: 'TRIAJ', personId: 'p1' },
      { date: '2026-06-01', shiftCode: 'V1', rowId: 'row-b', area: 'SARI', personId: 'p2' },
    ];

    const result = trimOverbookedAssignments({ assignments, defs: [], overrides: {} });

    expect(assignments.map(slotKey)).toEqual([
      '2026-06-01|ROW-A|TRIAJ|V1',
      '2026-06-01|ROW-B|SARI|V1',
    ]);
    expect(result.changed).toBe(false);
    expect(result.assignments).toHaveLength(2);
    expect(result.assignments.map((item) => item.personId)).toEqual(['p1', 'p2']);
  });

  it('trims same-day same-shift assignments when they target the same row and area with capacity 1', () => {
    const assignments = [
      { date: '2026-06-01', shiftCode: 'V1', rowId: 'row-a', area: 'TRIAJ', personId: 'p1' },
      { date: '2026-06-01', shiftCode: 'V1', rowId: 'row-a', area: 'TRIAJ', personId: 'p2' },
    ];

    const result = trimOverbookedAssignments({ assignments, defs: [], overrides: {} });

    expect(assignments.map(slotKey)).toEqual([
      '2026-06-01|ROW-A|TRIAJ|V1',
      '2026-06-01|ROW-A|TRIAJ|V1',
    ]);
    expect(result.changed).toBe(true);
    expect(result.assignments).toHaveLength(1);
  });

  it('uses exact row identity before generic shiftCode when resolving capacity', () => {
    const assignments = [
      { date: '2026-06-01', shiftCode: 'V1', shiftId: 'row-a', area: 'TRIAJ', personId: 'p1' },
    ];
    const defs = [
      { id: 'disabled-v1-row', shiftCode: 'V1', label: 'Other V1', defaultCount: 0 },
      { id: 'row-a', shiftCode: 'V1', label: 'TRIAJ', defaultCount: 1 },
    ];

    const result = trimOverbookedAssignments({ assignments, defs, overrides: {} });

    expect(result.changed).toBe(false);
    expect(result.assignments).toHaveLength(1);
  });

  it('uses exact row identity before generic shiftCode for daily shift capacity', () => {
    const assignments = [
      { date: '2026-06-01', shiftCode: 'V1', shiftId: 'row-a', area: 'TRIAJ', personId: 'p1' },
    ];
    const defs = [
      {
        date: '2026-06-01',
        shifts: [
          { id: 'disabled-v1-row', shiftCode: 'V1', label: 'Other V1', requiredCount: 0 },
          { id: 'row-a', shiftCode: 'V1', label: 'TRIAJ', requiredCount: 1 },
        ],
      },
    ];

    const result = trimOverbookedAssignments({ assignments, defs, overrides: {} });

    expect(result.changed).toBe(false);
    expect(result.assignments).toHaveLength(1);
  });

  it('preserves legacy fallback grouping when row and area identity are unavailable', () => {
    const assignments = [
      { date: '2026-06-01', shiftCode: 'V1', personId: 'p1' },
      { date: '2026-06-01', shiftCode: 'V1', personId: 'p2' },
    ];

    const result = trimOverbookedAssignments({ assignments, defs: [], overrides: {} });

    expect(assignments.map(slotKey)).toEqual([
      '2026-06-01|||V1',
      '2026-06-01|||V1',
    ]);
    expect(result.changed).toBe(true);
    expect(result.assignments).toHaveLength(1);
  });

  it('uses roster.namedAssignments for MonthlySchedule GET response when it is more complete than data.assignments', () => {
    const { defs, namedAssignments } = buildNamedFixture(471);
    const scheduleData = {
      assignments: Array.from({ length: 335 }, (_, index) => ({
        date: '2026-06-01',
        shiftCode: 'N',
        personName: `Existing ${index}`,
      })),
      roster: { namedAssignments },
    };

    const result = chooseMonthlyResponseAssignments({
      year: 2026,
      month: 6,
      defs,
      scheduleData,
    });

    expect(result.source).toBe('namedAssignments');
    expect(result.assignmentCount).toBe(335);
    expect(result.namedCount).toBe(471);
    expect(result.assignments).toHaveLength(471);
  });

  it('keeps existing assignments when namedAssignments is empty', () => {
    const existing = [{ date: '2026-06-01', shiftCode: 'N', personName: 'Existing' }];
    const result = chooseMonthlyResponseAssignments({
      year: 2026,
      month: 6,
      defs: [],
      scheduleData: { assignments: existing, roster: { namedAssignments: {} } },
    });

    expect(result.source).toBe('assignments');
    expect(result.assignments).toBe(existing);
  });

  it('keeps existing assignments when namedAssignments is smaller than data.assignments', () => {
    const { defs, namedAssignments } = buildNamedFixture(1);
    const existing = [
      { date: '2026-06-01', shiftCode: 'N', personName: 'Existing 1' },
      { date: '2026-06-02', shiftCode: 'N', personName: 'Existing 2' },
    ];

    const result = chooseMonthlyResponseAssignments({
      year: 2026,
      month: 6,
      defs,
      scheduleData: { assignments: existing, roster: { namedAssignments } },
    });

    expect(result.source).toBe('assignments');
    expect(result.assignments).toBe(existing);
  });
});
