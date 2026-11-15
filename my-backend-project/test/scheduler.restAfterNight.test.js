'use strict';

// Regression-pinning suite for the REST_AFTER_NIGHT data-shape bug.
//
// History: engine.js's assign() used to push assignment records with only
// `shiftId` (= shift.id, e.g. "night-n", a row identifier) and no `shiftCode`.
// Both candidateBuilder/rules/restAfterNight.rule.js and validator.js read
// `shiftCode` first and fall back to `shiftId` when classifying a previous
// assignment as a night shift. Because row id ("night-n") and the real shift
// code ("N") differ in the weekly-pattern template shape (the dominant data
// model in this app), the fallback silently failed to recognize the night
// shift, so REST_AFTER_NIGHT never fired in either layer. The fix made
// assign() also write `shiftCode: shift.code || shift.shiftCode || shift.id`.
//
// Each "bug reproduction" test below feeds the literal pre-fix shape (no
// shiftCode field) into the UNCHANGED rule/validator code to document the
// historical failure. Each "fix verification" test feeds the current
// engine.js output (built via the real assign() function) to lock in the
// corrected behavior.

const { assign } = require('../services/scheduler/engine');
const restAfterNightRule = require('../services/scheduler/candidateBuilder/rules/restAfterNight.rule');
const REASON_CODES = require('../services/scheduler/candidateBuilder/reasonCodes');
const { validateAssignments } = require('../services/scheduler/validator');

const PERSON_ID = 'person-a';
const DAY1 = '2026-06-10'; // N
const DAY2 = '2026-06-11'; // next calendar day, M

function buildNightThenMorningAssignments() {
  const context = {};
  const person = { id: PERSON_ID, name: 'Test Person' };
  assign(
    person,
    { date: DAY1, weekday: 3 },
    { id: 'night-n', code: 'N', start: '08:00', end: '08:00', hours: 24, isNight: true },
    context
  );
  assign(
    person,
    { date: DAY2, weekday: 4 },
    { id: 'morning-m', code: 'M', start: '08:00', end: '16:00', hours: 8 },
    context
  );
  return context.assignments;
}

describe('REST_AFTER_NIGHT bug reproduction (pre-fix shape, no shiftCode field)', () => {
  const legacyNightAssignment = {
    date: DAY1,
    weekday: 3,
    shiftId: 'night-n', // row id only — exactly what assign() produced before the fix
    personId: PERSON_ID,
    personName: 'Test Person',
    hours: 24,
  };

  test('candidateBuilder restAfterNightRule incorrectly passes when shiftCode is missing', () => {
    const result = restAfterNightRule({
      personId: PERSON_ID,
      date: DAY2,
      existingAssignments: [legacyNightAssignment],
    });

    expect(result.passed).toBe(true);
    expect(result.meta.checkedAssignments).toBe(1);
  });

  test('validator applyHardConstraints (via validateAssignments) does not filter the violation when shiftCode is missing', () => {
    const legacyMorningAssignment = {
      date: DAY2,
      weekday: 4,
      shiftId: 'morning-m',
      personId: PERSON_ID,
      personName: 'Test Person',
      hours: 8,
    };

    const validated = validateAssignments({
      assignments: [legacyNightAssignment, legacyMorningAssignment],
      staff: [],
    });

    expect(validated.assignments).toHaveLength(2);
    expect(validated.issues.some((issue) => issue.reason === 'REST_AFTER_NIGHT')).toBe(false);
  });
});

describe('REST_AFTER_NIGHT fix verification (current engine.js shape, id:"night-n" + shiftCode:"N")', () => {
  test('candidateBuilder restAfterNightRule rejects the next-day assignment', () => {
    const assignments = buildNightThenMorningAssignments();
    expect(assignments[0]).toMatchObject({ shiftId: 'night-n', shiftCode: 'N' });

    const result = restAfterNightRule({
      personId: PERSON_ID,
      date: DAY2,
      existingAssignments: assignments,
    });

    expect(result.passed).toBe(false);
    expect(result.code).toBe('REST_AFTER_NIGHT');
    expect(result.meta.reason).toBe(REASON_CODES.REST_AFTER_NIGHT_VIOLATION);
    expect(result.meta.shiftCode).toBe('N');
  });

  test('validator applyHardConstraints (via validateAssignments) filters the next-day assignment', () => {
    const assignments = buildNightThenMorningAssignments();

    const validated = validateAssignments({ assignments, staff: [] });

    expect(validated.assignments).toHaveLength(1);
    expect(validated.assignments[0].date).toBe(DAY1);
    expect(validated.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ date: DAY2, reason: 'REST_AFTER_NIGHT' }),
      ])
    );
  });
});
