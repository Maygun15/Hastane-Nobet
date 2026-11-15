'use strict';

// Personel tercihleri (ROADMAP pilot #2):
//   onaylı off/noNight = kesin kural, bekleyen = kaçınma puanı, want = istek bonusu.

const {
  buildPreferencesByPerson,
  expandDatesInMonth,
  mergeWantIntoRequests,
  normalizePreferenceKind,
} = require('../services/preferenceRequestService');
const { explainAvailability } = require('../services/scheduler/constraints');
const { preferencePenalty } = require('../services/scheduler/scoring');
const { generateMonthlyPlan } = require('../services/scheduler');

const req = (over = {}) => ({
  type: 'tercih',
  status: 'approved',
  preferenceKind: 'off',
  fromPersonId: 'p1',
  targetDate: '2026-12-05',
  targetDateEnd: '',
  ...over,
});

describe('preferenceRequestService', () => {
  test('normalizePreferenceKind', () => {
    expect(normalizePreferenceKind('off')).toBe('off');
    expect(normalizePreferenceKind('noNight')).toBe('noNight');
    expect(normalizePreferenceKind('no_night')).toBe('noNight');
    expect(normalizePreferenceKind('want')).toBe('want');
    expect(normalizePreferenceKind('')).toBe('');
    expect(normalizePreferenceKind('tatil')).toBe('');
  });

  test('expandDatesInMonth ayı aşan aralığı ay içine kırpar', () => {
    expect(expandDatesInMonth('2026-11-29', '2026-12-02', 2026, 12)).toEqual(['2026-12-01', '2026-12-02']);
    expect(expandDatesInMonth('2026-12-30', '', 2026, 12)).toEqual(['2026-12-30']);
    expect(expandDatesInMonth('2026-12-05', '2026-12-01', 2026, 12)).toEqual([]);
    expect(expandDatesInMonth('kötü', '', 2026, 12)).toEqual([]);
  });

  test('onaylı → kesin, bekleyen → tercih, want → tercih; reddedilen ve türsüz yok sayılır', () => {
    const prefs = buildPreferencesByPerson([
      req({ status: 'approved', preferenceKind: 'off', targetDate: '2026-12-05' }),
      req({ status: 'pending', preferenceKind: 'off', targetDate: '2026-12-06', targetDateEnd: '2026-12-07' }),
      req({ status: 'approved', preferenceKind: 'noNight', targetDate: '2026-12-10' }),
      req({ status: 'pending', preferenceKind: 'noNight', targetDate: '2026-12-11' }),
      req({ status: 'approved', preferenceKind: 'want', targetDate: '2026-12-24' }),
      req({ status: 'rejected', preferenceKind: 'off', targetDate: '2026-12-20' }),
      req({ status: 'approved', preferenceKind: '', targetDate: '2026-12-21' }),
      req({ type: 'izin', targetDate: '2026-12-22' }),
    ], { year: 2026, month: 12 });

    expect(prefs).toEqual({
      p1: {
        hardOff: ['2026-12-05'],
        softOff: ['2026-12-06', '2026-12-07'],
        hardNoNight: ['2026-12-10'],
        softNoNight: ['2026-12-11'],
        want: ['2026-12-24'],
      },
    });
  });

  test('mergeWantIntoRequests mevcut istekleri korur', () => {
    const out = mergeWantIntoRequests(
      { p1: ['2026-12-01'], p2: new Set(['2026-12-02']) },
      { p1: { want: ['2026-12-03'] }, p2: { want: [] } }
    );
    expect(out.p1).toEqual(['2026-12-01', '2026-12-03']);
    expect(out.p2).toEqual(new Set(['2026-12-02']));
  });
});

describe('motor kuralları', () => {
  const day = { date: '2026-12-05', weekday: 6 };
  const dayShift = { id: 'D', code: 'D', start: '08:00', end: '16:00', hours: 8 };
  const nightShift = { id: 'N', code: 'N', start: '16:00', end: '08:00', hours: 16, isNight: true };
  const v2Shift = { id: 'V2', code: 'V2', start: '08:00', end: '08:00', hours: 24 };
  const person = { id: 'p1', assignedDays: [] };

  test('onaylı "çalışmak istemiyorum" o güne yazılmaz', () => {
    const ctx = { rules: {}, preferencesByPerson: { p1: { hardOff: ['2026-12-05'] } } };
    expect(explainAvailability(person, day, ctx, dayShift)).toEqual({ allowed: false, reason: 'PREFERENCE_OFF' });
    expect(explainAvailability(person, { ...day, date: '2026-12-06' }, ctx, dayShift).allowed).toBe(true);
  });

  test('onaylı "gece istemiyorum" sadece gece/24 saat vardiyayı engeller', () => {
    const ctx = { rules: {}, preferencesByPerson: { p1: { hardNoNight: ['2026-12-05'] } } };
    expect(explainAvailability(person, day, ctx, nightShift).reason).toBe('PREFERENCE_NO_NIGHT');
    expect(explainAvailability(person, day, ctx, v2Shift).reason).toBe('PREFERENCE_NO_NIGHT');
    expect(explainAvailability(person, day, ctx, { id: 'V1', code: 'V1', start: '08:00', end: '00:00', hours: 16 }).reason).toBe('PREFERENCE_NO_NIGHT');
    expect(explainAvailability(person, day, ctx, dayShift).allowed).toBe(true);
  });

  test('bekleyen tercih engellemez, ceza puanı verir', () => {
    const ctx = { rules: {}, preferencesByPerson: { p1: { softOff: ['2026-12-05'], softNoNight: ['2026-12-05'] } } };
    expect(explainAvailability(person, day, ctx, dayShift).allowed).toBe(true);
    expect(preferencePenalty(person, day, dayShift, ctx, {})).toBe(20);
    expect(preferencePenalty(person, day, nightShift, ctx, {})).toBe(40);
    expect(preferencePenalty(person, day, dayShift, ctx, { preferenceAvoid: 5 })).toBe(5);
    expect(preferencePenalty({ id: 'p2' }, day, dayShift, ctx, {})).toBe(0);
  });
});

describe('generateMonthlyPlan uçtan uca', () => {
  const staff = [
    { id: 'p1', name: 'Ayşe', active: true },
    { id: 'p2', name: 'Fatma', active: true },
  ];
  const days = ['2026-12-05', '2026-12-06'].map((date) => ({
    date,
    weekday: new Date(`${date}T00:00:00Z`).getUTCDay(),
    shifts: [{ id: 'D', code: 'D', start: '08:00', end: '16:00', hours: 8, requiredCount: 1 }],
  }));

  async function run(preferencesByPerson) {
    const ctx = await generateMonthlyPlan({
      year: 2026,
      month: 12,
      getActiveStaff: async () => staff,
      getMonthlyShifts: async () => days,
      getPreferences: async () => preferencesByPerson,
      rules: { ONE_SHIFT_PER_DAY: true, LEAVE_BLOCK: true },
      weights: {},
    });
    return ctx.assignments.filter((a) => a.date === '2026-12-05').map((a) => String(a.personId));
  }

  test('onaylı tercih: p1 o gün asla yazılmaz', async () => {
    for (let i = 0; i < 10; i += 1) {
      expect(await run({ p1: { hardOff: ['2026-12-05'] } })).toEqual(['p2']);
    }
  });

  test('bekleyen tercih: diğer kişi müsaitse p1 yazılmaz', async () => {
    for (let i = 0; i < 10; i += 1) {
      expect(await run({ p1: { softOff: ['2026-12-05'] } })).toEqual(['p2']);
    }
  });
});
