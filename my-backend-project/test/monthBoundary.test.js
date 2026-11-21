'use strict';

/**
 * İP-2 / B — aylar arası planlama.
 * Motor rastlantı içerdiği için atama birebir beklenmez; her senaryo 20 kez çalıştırılır ve
 * KURAL kontrolü yapılır (önceki ay görevi olan kişi ay başında yasaklı slota hiç atanmamalı).
 */

const {
  computeLookbackDays, dateRange, loadPriorAssignments, seedPersonStateFromPrior, shiftLengthHours,
} = require('../services/scheduler/monthBoundary');
const { generateMonthlyPlan } = require('../services/scheduler');
const { computeScheduleRisks } = require('../services/scheduleRiskService');

const META = {
  M: { start: '08:00', end: '16:00', hours: 8 },
  V1: { start: '08:00', end: '24:00', hours: 16 },
  N: { start: '08:00', end: '08:00', hours: 24 },
};
const RULES = { ONE_SHIFT_PER_DAY: true, LEAVE_BLOCK: true, NIGHT_NEXT_DAY_OFF: true, MIN_REST_HOURS: 11, MAX_CONSECUTIVE_DAYS: 6 };

describe('geriye bakış süresi etkin kurallardan türetilir', () => {
  test('24 saatlik vardiya + 11 saat dinlenme → 2 gün; ardışık 6 → 6 gün', () => {
    expect(shiftLengthHours(META.N)).toBe(24);
    expect(shiftLengthHours(META.V1)).toBe(16);
    const r = computeLookbackDays({ rules: RULES, shiftMetaByCode: META, year: 2027, month: 1 });
    expect(r.parts).toMatchObject({ rest: 2, night: 1, consecutive: 6 });
    expect(r.days).toBe(6);
  });
  test('haftalık sınır varsa ISO haftanın pazartesisine kadar (1 Ocak 2027 Cuma → 4 gün)', () => {
    const r = computeLookbackDays({ rules: { MAX_SHIFTS_PER_WEEK: 3 }, shiftMetaByCode: META, year: 2027, month: 1 });
    expect(r.parts.weekly).toBe(4);
  });
  test('kurallar kapalıysa en az 1 gün', () => {
    expect(computeLookbackDays({ rules: {}, shiftMetaByCode: {}, year: 2026, month: 3 }).days).toBe(1);
  });
  test('yıl değişimi ve ay uzunlukları (Ocak → Aralık, Mart → Şubat 28 gün)', () => {
    expect(dateRange(2027, 1, 6)).toEqual({ from: '2026-12-26', to: '2026-12-31' });
    expect(dateRange(2027, 3, 2)).toEqual({ from: '2027-02-27', to: '2027-02-28' });
    expect(dateRange(2028, 3, 2)).toEqual({ from: '2028-02-28', to: '2028-02-29' }); // artık yıl
  });
});

function models({ rows = [], prevDoc = null } = {}) {
  return {
    assignmentModel: { find: jest.fn(() => ({ lean: () => Promise.resolve(rows) })) },
    monthlyModel: { findOne: jest.fn(() => ({ lean: () => Promise.resolve(prevDoc) })) },
  };
}
const STAFF = [{ id: 'p0', name: 'AYŞE' }, { id: 'p1', name: 'FATMA' }];
const base = { hospitalId: 'h1', sectionId: 'calisma-cizelgesi', serviceId: 'svc', role: 'Nurse', year: 2027, month: 1, staff: STAFF, lookbackDays: 2, shiftMetaByCode: META };

describe('önceki dönem verisi ve durum bildirimi', () => {
  test('önceki ay planı ve görev yoksa "missing" + açıklama', async () => {
    const r = await loadPriorAssignments({ ...base, ...models() });
    expect(r.status).toBe('missing');
    expect(r.message).toMatch(/Önceki dönem \(2026-12\) verisi yok/);
  });
  test('görev Assignment koleksiyonundan okunur; isimle eşleşen eski kayıt da alınır; gece yarısını aşan saatler tanımdan', async () => {
    const m = models({
      rows: [
        { date: '2026-12-31', personId: 'p0', shiftCode: 'N' },
        { date: '2026-12-30', personId: '', personName: 'fatma', shiftCode: 'V1' },
        { date: '2026-12-31', personId: 'baska-kisi', shiftCode: 'M' },
      ],
      prevDoc: { _id: 'dec' },
    });
    const r = await loadPriorAssignments({ ...base, ...m });
    expect(r.status).toBe('found');
    expect(r.assignments).toEqual([
      expect.objectContaining({ date: '2026-12-30', personId: 'p1', shiftCode: 'V1', start: '08:00', end: '24:00' }),
      expect.objectContaining({ date: '2026-12-31', personId: 'p0', shiftCode: 'N', hours: 24 }),
    ]);
    expect(m.assignmentModel.find.mock.calls[0][0].date).toEqual({ $gte: '2026-12-30', $lte: '2026-12-31' });
  });
  test('plan var ama bu personelin görevi yok → "empty" (tam kontrol)', async () => {
    const r = await loadPriorAssignments({ ...base, ...models({ prevDoc: { _id: 'dec', data: { assignments: [] } } }) });
    expect(r.status).toBe('empty');
  });
  test('projeksiyon yoksa aynı kapsamdaki önceki ay planından okunur', async () => {
    const r = await loadPriorAssignments({ ...base, ...models({ prevDoc: { data: { assignments: [{ date: '2026-12-31', personId: 'p0', shiftCode: 'N' }] } } }) });
    expect(r.status).toBe('found');
    expect(r.source).toBe('monthly');
  });
});

function janDays(shift) {
  return Array.from({ length: 3 }, (_, i) => {
    const date = `2027-01-0${i + 1}`;
    return { date, weekday: new Date(`${date}T00:00:00Z`).getUTCDay(), shifts: [{ ...shift, requiredCount: 1 }] };
  });
}
async function plan({ shift, prior, rules = RULES }) {
  return generateMonthlyPlan({
    year: 2027, month: 1,
    getActiveStaff: async () => STAFF.map((s) => ({ ...s, active: true, role: 'Nurse' })),
    getMonthlyShifts: async () => janDays(shift),
    rules,
    weights: {},
    priorAssignments: prior,
  });
}
const firstDay = (ctx) => (ctx.assignments || []).filter((a) => a.date === '2027-01-01').map((a) => a.personId);

describe('motor önceki ay sonundaki görevi hesaba katar (20 tekrar)', () => {
  test('31 Aralık N (24 saat) → 1 Ocak aynı kişi yazılmaz', async () => {
    for (let i = 0; i < 20; i += 1) {
      const ctx = await plan({
        shift: { id: 'r-n', code: 'N', start: '08:00', end: '08:00', hours: 24, isNight: true },
        prior: [{ date: '2026-12-31', personId: 'p0', shiftCode: 'N', start: '08:00', end: '08:00', hours: 24 }],
      });
      expect(firstDay(ctx)).toEqual(['p1']);
    }
  });
  test('31 Aralık V1 (08–24) + 11 saat dinlenme → 1 Ocak 08:00 M aynı kişi yazılmaz (gece yarısını aşma)', async () => {
    for (let i = 0; i < 20; i += 1) {
      const ctx = await plan({
        shift: { id: 'r-m', code: 'M', start: '08:00', end: '16:00', hours: 8 },
        prior: [{ date: '2026-12-31', personId: 'p0', shiftCode: 'V1', start: '08:00', end: '24:00', hours: 16 }],
        rules: { ...RULES, NIGHT_NEXT_DAY_OFF: false },
      });
      expect(firstDay(ctx)).toEqual(['p1']);
    }
  });
  test('26–31 Aralık 6 gün art arda → 1 Ocak 7. gün olamaz', async () => {
    const prior = ['26', '27', '28', '29', '30', '31'].map((d) => ({ date: `2026-12-${d}`, personId: 'p0', shiftCode: 'M', start: '08:00', end: '16:00', hours: 8 }));
    for (let i = 0; i < 20; i += 1) {
      const ctx = await plan({ shift: { id: 'r-m', code: 'M', start: '08:00', end: '16:00', hours: 8 }, prior });
      expect(firstDay(ctx)).toEqual(['p1']);
    }
  });
  test('önceki görevler çıktıya ve bu ayın toplamlarına girmez', async () => {
    const ctx = await plan({
      shift: { id: 'r-m', code: 'M', start: '08:00', end: '16:00', hours: 8 },
      prior: [{ date: '2026-12-31', personId: 'p0', shiftCode: 'M', start: '08:00', end: '16:00', hours: 8 }],
    });
    expect((ctx.assignments || []).every((a) => a.date.startsWith('2027-01'))).toBe(true);
  });
});

describe('ortak doğrulama: risk paneli de önceki dönemi görür', () => {
  test('elle yazılmış 1 Ocak görevi, 31 Aralık N sonrası → GECE_SONRASI_GUN riski; önceki görev için risk yok', () => {
    const days = [{ date: '2027-01-01', weekday: 5, shifts: [{ id: 'r-m', code: 'M', start: '08:00', end: '16:00', hours: 8, requiredCount: 1 }] }];
    const res = computeScheduleRisks({
      assignments: [{ date: '2027-01-01', personId: 'p0', personName: 'AYŞE', shiftId: 'r-m', shiftCode: 'M' }],
      days,
      staff: [{ _id: 'p0', name: 'AYŞE', meta: {} }],
      limits: RULES,
      priorAssignments: [{ date: '2026-12-31', personId: 'p0', shiftCode: 'N', start: '08:00', end: '08:00', hours: 24 }],
    });
    const kural = res.risks.filter((r) => r.type === 'KURAL');
    expect(kural.map((r) => r.rule)).toEqual(expect.arrayContaining(['GECE_SONRASI_GUN']));
    expect(kural.every((r) => r.date === '2027-01-01')).toBe(true);
  });
  test('önceki dönem yokken aynı görev risk üretmez (bu yüzden "missing" bildirimi gerekir)', () => {
    const days = [{ date: '2027-01-01', weekday: 5, shifts: [{ id: 'r-m', code: 'M', start: '08:00', end: '16:00', hours: 8, requiredCount: 1 }] }];
    const res = computeScheduleRisks({
      assignments: [{ date: '2027-01-01', personId: 'p0', shiftId: 'r-m', shiftCode: 'M' }],
      days, staff: [{ _id: 'p0', name: 'AYŞE', meta: {} }], limits: RULES, priorAssignments: [],
    });
    expect(res.risks.filter((r) => r.type === 'KURAL')).toHaveLength(0);
  });
});

describe('kişi durumu tohumlama', () => {
  test('ardışık gün ve son vardiya kurulur; toplamlar değişmez', () => {
    const staff = [{ id: 'p0' }];
    seedPersonStateFromPrior(staff, [
      { date: '2026-12-30', personId: 'p0', shiftCode: 'M' },
      { date: '2026-12-31', personId: 'p0', shiftCode: 'N', start: '08:00', end: '08:00' },
    ], { getISOWeekKey: () => '2026-W53', isNightCode: (c) => c === 'N' });
    expect(staff[0]).toMatchObject({ consecutiveDays: 2, lastAssignedDate: '2026-12-31', lastShift: { code: 'N', isNight: true } });
    expect(staff[0].totalHours).toBeUndefined();
  });
});
