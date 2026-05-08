'use strict';
// Unit tests for services/scheduler/constraints.js
// Run: npx jest test/scheduler.constraints.test.js

const { explainAvailability, isAvailable, areaMatches, normalizeArea, splitAreaTokens } = require('../services/scheduler/constraints');

// ── Helpers ──────────────────────────────────────────────────────────────────

function makePerson(overrides = {}) {
  return {
    id: 'p1',
    name: 'Test Kişi',
    assignedDays: [],
    consecutiveDays: 0,
    lastAssignedDate: null,
    lastShift: null,
    weeklyCounts: {},
    taskCounts: {},
    ...overrides,
  };
}

function makeDay(date) {
  return { date };
}

function makeContext(rules = {}, extra = {}) {
  return { rules, leavesByPerson: {}, ...extra };
}

// ── LEAVE_BLOCK ───────────────────────────────────────────────────────────────

describe('LEAVE_BLOCK constraint', () => {
  test('blocks person on leave day (Set)', () => {
    const person = makePerson({ id: 'p1' });
    const day = makeDay('2025-06-10');
    const ctx = makeContext({ LEAVE_BLOCK: true }, { leavesByPerson: { p1: new Set(['2025-06-10']) } });
    const result = explainAvailability(person, day, ctx);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('LEAVE_BLOCK');
  });

  test('blocks person on leave day (Array)', () => {
    const person = makePerson({ id: 'p1' });
    const day = makeDay('2025-06-10');
    const ctx = makeContext({ LEAVE_BLOCK: true }, { leavesByPerson: { p1: ['2025-06-10'] } });
    const result = explainAvailability(person, day, ctx);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('LEAVE_BLOCK');
  });

  test('allows person on non-leave day', () => {
    const person = makePerson({ id: 'p1' });
    const day = makeDay('2025-06-11');
    const ctx = makeContext({ LEAVE_BLOCK: true }, { leavesByPerson: { p1: new Set(['2025-06-10']) } });
    const result = explainAvailability(person, day, ctx);
    expect(result.allowed).toBe(true);
  });

  test('allows person with no leaves registered', () => {
    const person = makePerson({ id: 'p1' });
    const day = makeDay('2025-06-10');
    const ctx = makeContext({ LEAVE_BLOCK: true }, { leavesByPerson: {} });
    const result = explainAvailability(person, day, ctx);
    expect(result.allowed).toBe(true);
  });

  test('no-op when LEAVE_BLOCK rule disabled', () => {
    const person = makePerson({ id: 'p1' });
    const day = makeDay('2025-06-10');
    const ctx = makeContext({ LEAVE_BLOCK: false }, { leavesByPerson: { p1: new Set(['2025-06-10']) } });
    const result = explainAvailability(person, day, ctx);
    expect(result.allowed).toBe(true);
  });
});

// ── ONE_SHIFT_PER_DAY ─────────────────────────────────────────────────────────

describe('ONE_SHIFT_PER_DAY constraint', () => {
  test('blocks person already assigned that day', () => {
    const person = makePerson({ assignedDays: ['2025-06-10'] });
    const day = makeDay('2025-06-10');
    const ctx = makeContext({ ONE_SHIFT_PER_DAY: true });
    const result = explainAvailability(person, day, ctx);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('ONE_SHIFT_PER_DAY');
  });

  test('allows person on a different day', () => {
    const person = makePerson({ assignedDays: ['2025-06-09'] });
    const day = makeDay('2025-06-10');
    const ctx = makeContext({ ONE_SHIFT_PER_DAY: true });
    expect(explainAvailability(person, day, ctx).allowed).toBe(true);
  });

  test('no-op when rule disabled', () => {
    const person = makePerson({ assignedDays: ['2025-06-10'] });
    const day = makeDay('2025-06-10');
    const ctx = makeContext({ ONE_SHIFT_PER_DAY: false });
    expect(explainAvailability(person, day, ctx).allowed).toBe(true);
  });
});

// ── MAX_CONSECUTIVE_DAYS ──────────────────────────────────────────────────────

describe('MAX_CONSECUTIVE_DAYS constraint', () => {
  test('blocks when consecutive limit reached', () => {
    const person = makePerson({ lastAssignedDate: '2025-06-09', consecutiveDays: 5 });
    const day = makeDay('2025-06-10'); // day after lastAssigned → diff=1 → consecutive becomes 6
    const ctx = makeContext({ MAX_CONSECUTIVE_DAYS: 5 });
    const result = explainAvailability(person, day, ctx);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('MAX_CONSECUTIVE_DAYS');
  });

  test('allows when consecutive is within limit', () => {
    const person = makePerson({ lastAssignedDate: '2025-06-09', consecutiveDays: 4 });
    const day = makeDay('2025-06-10');
    const ctx = makeContext({ MAX_CONSECUTIVE_DAYS: 5 });
    expect(explainAvailability(person, day, ctx).allowed).toBe(true);
  });

  test('resets consecutive when gap > 1 day', () => {
    const person = makePerson({ lastAssignedDate: '2025-06-07', consecutiveDays: 5 });
    const day = makeDay('2025-06-10'); // diff=3 → resets to 1
    const ctx = makeContext({ MAX_CONSECUTIVE_DAYS: 5 });
    expect(explainAvailability(person, day, ctx).allowed).toBe(true);
  });
});

// ── NIGHT_NEXT_DAY_OFF (NIGHT_NEXT_DAY_OFF rule) ─────────────────────────────

describe('NIGHT_24H_NEXT_DAY_BLOCK constraint', () => {
  test('blocks day after night shift (N code)', () => {
    const nightShift = { code: 'N', date: '2025-06-09', start: '22:00', end: '07:00' };
    const person = makePerson({ lastShift: nightShift });
    const day = makeDay('2025-06-10');
    const ctx = makeContext({});
    const result = explainAvailability(person, day, ctx);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('NIGHT_24H_NEXT_DAY_BLOCK');
  });

  test('allows two days after night shift', () => {
    const nightShift = { code: 'N', date: '2025-06-08', start: '22:00', end: '07:00' };
    const person = makePerson({ lastShift: nightShift });
    const day = makeDay('2025-06-10'); // diff=2
    const ctx = makeContext({});
    expect(explainAvailability(person, day, ctx).allowed).toBe(true);
  });
});

// ── MAX_SHIFTS_PER_WEEK ───────────────────────────────────────────────────────

describe('MAX_SHIFTS_PER_WEEK constraint', () => {
  test('blocks when weekly limit reached', () => {
    // 2025-06-10 is Tuesday, ISO week 24
    const person = makePerson({ weeklyCounts: { '2025-W24': 5 } });
    const day = makeDay('2025-06-10');
    const ctx = makeContext({ MAX_SHIFTS_PER_WEEK: 5 });
    const result = explainAvailability(person, day, ctx);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('MAX_SHIFTS_PER_WEEK');
  });

  test('allows when under weekly limit', () => {
    const person = makePerson({ weeklyCounts: { '2025-W24': 4 } });
    const day = makeDay('2025-06-10');
    const ctx = makeContext({ MAX_SHIFTS_PER_WEEK: 5 });
    expect(explainAvailability(person, day, ctx).allowed).toBe(true);
  });
});

// ── SERVICE_SUPERVISOR_ONLY ───────────────────────────────────────────────────

describe('SERVICE_SUPERVISOR_ONLY constraint', () => {
  test('blocks person without supervisor card signals for service supervisor task', () => {
    const person = makePerson({
      areas: ['acil'],
      meta: { areas: ['acil'], role: 'hemsire' },
    });
    const day = makeDay('2025-06-10');
    const shift = { code: 'M', area: 'SERVİS SORUMLUSU' };
    const result = explainAvailability(person, day, makeContext({}), shift);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('SERVICE_SUPERVISOR_ONLY');
  });

  test('allows explicit supervisor candidate for service supervisor task', () => {
    const person = makePerson({
      areas: ['servis sorumlusu'],
      meta: { areas: ['servis sorumlusu'], role: 'sorumlu hemsire' },
    });
    const day = makeDay('2025-06-10');
    const shift = { code: 'M', area: 'SERVİS SORUMLUSU' };
    const result = explainAvailability(person, day, makeContext({}), shift);
    expect(result.allowed).toBe(true);
  });
});

describe('AREA_PROFILE_MISSING constraint', () => {
  test('blocks person when task area exists but person card has no area mapping', () => {
    const person = makePerson({ areas: [], meta: {} });
    const day = makeDay('2025-06-10');
    const shift = { code: 'N', area: 'RESÜSİTASYON' };
    const result = explainAvailability(person, day, makeContext({}), shift);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('AREA_PROFILE_MISSING');
  });
});

// ── INVALID INPUT GUARDS ──────────────────────────────────────────────────────

describe('invalid input guards', () => {
  test('returns not-allowed for null person', () => {
    const result = explainAvailability(null, makeDay('2025-06-10'), makeContext());
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('INVALID_INPUT');
  });

  test('returns not-allowed for null day', () => {
    const result = explainAvailability(makePerson(), null, makeContext());
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('INVALID_INPUT');
  });

  test('returns not-allowed for day without date', () => {
    const result = explainAvailability(makePerson(), {}, makeContext());
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('INVALID_DAY');
  });
});

// ── isAvailable wrapper ────────────────────────────────────────────────────────

describe('isAvailable wrapper', () => {
  test('returns boolean true when allowed', () => {
    expect(isAvailable(makePerson(), makeDay('2025-06-10'), makeContext())).toBe(true);
  });

  test('returns boolean false when blocked', () => {
    const person = makePerson({ id: 'p1' });
    const ctx = makeContext({ LEAVE_BLOCK: true }, { leavesByPerson: { p1: new Set(['2025-06-10']) } });
    expect(isAvailable(person, makeDay('2025-06-10'), ctx)).toBe(false);
  });
});

// ── areaMatches ───────────────────────────────────────────────────────────────

describe('areaMatches', () => {
  test('matches exact area', () => {
    expect(areaMatches(['acil'], 'acil')).toBe(true);
  });

  test('returns true when shiftArea is empty (any area allowed)', () => {
    expect(areaMatches([], '')).toBe(true);
    expect(areaMatches(['acil'], '')).toBe(true);
  });

  test('returns false when personAreas is empty', () => {
    expect(areaMatches([], 'acil')).toBe(false);
  });

  test('partial token match: at least half tokens must match', () => {
    // personArea "acil servis" vs shiftArea "acil" → token "acil" in both → match
    expect(areaMatches(['acil servis'], 'acil')).toBe(true);
  });

  test('rejects fully unrelated areas', () => {
    expect(areaMatches(['yogun bakim'], 'acil')).toBe(false);
  });

  test('handles Turkish character normalization', () => {
    // İ → i normalization
    expect(areaMatches(['yoğun bakım'], 'yogun bakim')).toBe(true);
  });
});

// ── normalizeArea and splitAreaTokens ────────────────────────────────────────

describe('normalizeArea', () => {
  test('lowercases and replaces Turkish chars', () => {
    expect(normalizeArea('Yoğun Bakım')).toBe('yogun bakim');
    expect(normalizeArea('İÇ HASTALIKLARI')).toBe('ic hastaliklari');
  });

  test('trims whitespace', () => {
    expect(normalizeArea('  acil  ')).toBe('acil');
  });
});

describe('splitAreaTokens', () => {
  test('removes noise words', () => {
    const tokens = splitAreaTokens('Yoğun Bakım Birimi');
    expect(tokens).not.toContain('birimi');
    expect(tokens).toContain('yogun');
    expect(tokens).toContain('bakim');
  });

  test('splits on punctuation', () => {
    const tokens = splitAreaTokens('acil/cerrahi');
    expect(tokens).toContain('acil');
    expect(tokens).toContain('cerrahi');
  });

  test('filters short tokens (≤1 char)', () => {
    const tokens = splitAreaTokens('a b acil');
    expect(tokens).not.toContain('a');
    expect(tokens).not.toContain('b');
  });
});
