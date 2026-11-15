'use strict';

const { buildDaysFromScheduleData } = require('../services/scheduler/inputBuilder');
const { assign } = require('../services/scheduler/engine');

describe('scheduler shift metadata normalization', () => {
  test('uses canonical shift metadata when shiftOptions are empty', () => {
    const days = buildDaysFromScheduleData({
      year: 2026,
      month: 6,
      data: {
        defs: [
          {
            id: 'supervisor-m',
            label: 'SERVİS SORUMLUSU',
            shiftCode: 'M',
            defaultCount: 1,
            pattern: [1, 1, 1, 1, 1, 1, 1],
          },
          {
            id: 'night-n',
            label: 'GECE',
            shiftCode: 'N',
            defaultCount: 1,
            pattern: [1, 1, 1, 1, 1, 1, 1],
          },
          {
            id: 'v1',
            label: 'V1',
            shiftCode: 'V1',
            defaultCount: 1,
            pattern: [1, 1, 1, 1, 1, 1, 1],
          },
        ],
        shiftOptions: [],
      },
    });

    const byId = new Map(days[0].shifts.map((shift) => [shift.id, shift]));
    expect(byId.get('supervisor-m')).toMatchObject({ start: '08:00', end: '16:00', hours: 8 });
    expect(byId.get('night-n')).toMatchObject({ start: '08:00', end: '08:00', hours: 24, isNight: true });
    expect(byId.get('v1')).toMatchObject({ start: '08:00', end: '00:00', hours: 16 });
  });

  test('prefers explicit shiftOptions over canonical shift metadata', () => {
    const days = buildDaysFromScheduleData({
      year: 2026,
      month: 6,
      data: {
        defs: [
          {
            id: 'custom-m',
            label: 'SABAH',
            shiftCode: 'M',
            defaultCount: 1,
            pattern: [1, 1, 1, 1, 1, 1, 1],
          },
        ],
        shiftOptions: [
          {
            code: 'M',
            startTime: '07:30',
            endTime: '15:30',
            totalHours: 8,
          },
        ],
      },
    });

    expect(days[0].shifts[0]).toMatchObject({
      start: '07:30',
      end: '15:30',
      hours: 8,
    });
  });

  test('matches shiftOptions metadata regardless of shift code casing', () => {
    const days = buildDaysFromScheduleData({
      year: 2026,
      month: 6,
      data: {
        defs: [
          {
            id: 'custom-m-lowercase-option',
            label: 'SABAH',
            shiftCode: 'M',
            defaultCount: 1,
            pattern: [1, 1, 1, 1, 1, 1, 1],
          },
        ],
        shiftOptions: [
          {
            code: 'm',
            startTime: '07:00',
            endTime: '14:00',
            totalHours: 7,
          },
        ],
      },
    });

    // shiftOptions code'u küçük harf olsa da kullanıcı tanımlı saatler bulunmalı;
    // CANONICAL_SHIFT_CATALOG.M (08:00-16:00, 8h) varsayılanına düşülmemeli.
    expect(days[0].shifts[0]).toMatchObject({
      start: '07:00',
      end: '14:00',
      hours: 7,
    });
  });

  test('uses startTime/endTime/totalHours from shiftOptions when building runtime shifts', () => {
    const days = buildDaysFromScheduleData({
      year: 2026,
      month: 6,
      data: {
        defs: [
          {
            id: 'supervisor-m',
            label: 'SERVİS SORUMLUSU',
            shiftCode: 'M',
            defaultCount: 1,
            pattern: [1, 1, 1, 1, 1, 1, 1],
          },
        ],
        shiftOptions: [
          {
            code: 'M',
            startTime: '08:00',
            endTime: '16:00',
            totalHours: 8,
          },
        ],
      },
    });

    const firstShift = days[0].shifts[0];
    expect(firstShift.start).toBe('08:00');
    expect(firstShift.end).toBe('16:00');
    expect(firstShift.hours).toBe(8);
  });

  test('writes normalized shift metadata to generated assignment records', () => {
    const person = { id: 'p1', name: 'Test Person' };
    const day = { date: '2026-06-01', weekday: 1 };
    const shift = {
      id: 'supervisor-m',
      code: 'M',
      start: '08:00',
      end: '16:00',
      hours: 8,
      assignedPersons: [],
    };
    const context = {};

    assign(person, day, shift, context);

    expect(context.assignments).toHaveLength(1);
    expect(context.assignments[0]).toMatchObject({
      shiftId: 'supervisor-m',
      shiftCode: 'M',
      startTime: '08:00',
      endTime: '16:00',
      duration: 8,
      hours: 8,
    });
  });
});
