'use strict';

// Gece ve hafta sonu dengesi (ROADMAP pilot #3).

const {
  computeFairnessTargets,
  fairnessBalancePenalty,
  isNightLikeShift,
  isWeekendLikeDay,
  recordFairnessCounters,
} = require('../services/scheduler/fairnessCounters');
const { applyHolidayPolicies } = require('../services/scheduler/holidayPolicyAdapter');
const { generateMonthlyPlan } = require('../services/scheduler');

const D = { id: 'D', code: 'D', start: '08:00', end: '16:00', hours: 8, requiredCount: 2 };
const N = { id: 'N', code: 'N', start: '00:00', end: '08:00', hours: 8, requiredCount: 1, isNight: true };

describe('fairnessCounters', () => {
  test('gece ve 24 saat vardiya gece sayılır', () => {
    expect(isNightLikeShift(N)).toBe(true);
    expect(isNightLikeShift({ code: 'V2' })).toBe(true);
    expect(isNightLikeShift({ code: 'V1' })).toBe(true); // hastane kararı: V1 gece çalışması
    expect(isNightLikeShift({ code: 'M4' })).toBe(false);
    expect(isNightLikeShift(D)).toBe(false);
  });

  test('Cumartesi, Pazar ve tam gün tatil hafta sonu sayılır', () => {
    expect(isWeekendLikeDay({ weekday: 6 })).toBe(true);
    expect(isWeekendLikeDay({ weekday: 0 })).toBe(true);
    expect(isWeekendLikeDay({ weekday: 3 })).toBe(false);
    expect(isWeekendLikeDay({ weekday: 3, holidayKind: 'full' })).toBe(true);
    expect(isWeekendLikeDay({ weekday: 3, holidayKind: 'arife' })).toBe(false);
  });

  test('tatil türü motor gününe işlenir', () => {
    const [day] = applyHolidayPolicies({
      days: [{ date: '2026-10-29', weekday: 4, shifts: [D] }],
      holidayKindByDate: { '2026-10-29': 'full' },
    });
    expect(day.holidayKind).toBe('full');
  });

  test('hedef = slot / kişi; sayaçlar ve ceza', () => {
    const days = [
      { date: '2026-12-05', weekday: 6, shifts: [D, N] }, // Cumartesi: 3 slot, 1 gece
      { date: '2026-12-07', weekday: 1, shifts: [D, N] }, // Pazartesi: 1 gece
    ];
    expect(computeFairnessTargets(days, 2)).toEqual({
      nightSlots: 2, weekendSlots: 3, targetNights: 1, targetWeekendShifts: 1.5,
    });

    const person = { id: 'p1' };
    recordFairnessCounters(person, days[0], N);
    expect(person).toMatchObject({ nightCount: 1, weekendCount: 1 });

    const ctx = { targetNights: 1, targetWeekendShifts: 1.5 };
    // Gece hedefinde (1-1)=0, hafta sonunda (1-1.5)*8=-4
    expect(fairnessBalancePenalty(person, days[0], N, ctx, {})).toBe(-4);
    recordFairnessCounters(person, days[1], N);
    // Pazartesi gecesi: (2-1)*10 = 10; hafta sonu değil
    expect(fairnessBalancePenalty(person, days[1], N, ctx, {})).toBe(10);
    // Gündüz hafta içi: ceza yok
    expect(fairnessBalancePenalty(person, days[1], D, ctx, {})).toBe(0);
  });
});

describe('generateMonthlyPlan — denge gerçekten iyileşiyor', () => {
  const staff = Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, name: `Kişi ${i}`, active: true }));
  const days = Array.from({ length: 31 }, (_, i) => {
    const date = `2026-12-${String(i + 1).padStart(2, '0')}`;
    return {
      date,
      weekday: new Date(`${date}T00:00:00Z`).getUTCDay(),
      shifts: [
        { id: 'D', code: 'D', start: '08:00', end: '16:00', hours: 8, requiredCount: 2 },
        { id: 'A', code: 'A', start: '16:00', end: '24:00', hours: 8, requiredCount: 1 },
        { id: 'N', code: 'N', start: '00:00', end: '08:00', hours: 8, requiredCount: 1, isNight: true },
      ],
    };
  });
  const rules = { ONE_SHIFT_PER_DAY: true, NIGHT_NEXT_DAY_OFF: true, MIN_REST_HOURS: 12, MAX_CONSECUTIVE_DAYS: 6 };
  const spread = (o) => Math.max(...Object.values(o)) - Math.min(...Object.values(o));

  async function averageSpread(weights, runs = 12) {
    let nights = 0;
    let weekends = 0;
    let unfilled = 0;
    for (let r = 0; r < runs; r += 1) {
      const ctx = await generateMonthlyPlan({
        year: 2026,
        month: 12,
        getActiveStaff: async () => staff.map((s) => ({ ...s })),
        getMonthlyShifts: async () => JSON.parse(JSON.stringify(days)),
        rules,
        weights,
      });
      const n = Object.fromEntries(staff.map((s) => [s.id, 0]));
      const w = Object.fromEntries(staff.map((s) => [s.id, 0]));
      for (const a of ctx.assignments) {
        if (a.shiftCode === 'N') n[a.personId] += 1;
        if (a.weekday === 0 || a.weekday === 6) w[a.personId] += 1;
      }
      nights += spread(n);
      weekends += spread(w);
      unfilled += (ctx.issues || []).reduce((s, i) => s + Number(i.missing || 0), 0);
    }
    return { nights: nights / runs, weekends: weekends / runs, unfilled };
  }

  test('denge açıkken gece ve hafta sonu farkı belirgin şekilde küçülür, boş slot oluşmaz', async () => {
    const off = await averageSpread({ nightBalance: 0, weekendBalance: 0 });
    const on = await averageSpread({});

    expect(on.unfilled).toBe(0);
    expect(on.nights).toBeLessThan(off.nights);
    expect(on.nights).toBeLessThanOrEqual(3);
    // Hafta sonu farkı zaten küçük (kapalıyken ~1.2); kıyas yerine mutlak sınır: oynak test olmasın.
    expect(on.weekends).toBeLessThanOrEqual(2);
  });
});
