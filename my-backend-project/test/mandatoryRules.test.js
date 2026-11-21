'use strict';

/**
 * İP-4 / D — pilot için zorunlu kurallar, gerçek motorla ve BAĞIMSIZ denetçiyle.
 * Motor rastlantı içerir: birebir atama beklenmez; her koşu kural denetiminden geçmeli (15 tekrar).
 *
 * Kurallar (kurum ayarı — deneme ortamındaki "Kurum kuralları" kaydıyla aynı değerler):
 *   günde tek vardiya, izin günü atama yok, gece (24 saat) ertesi gün yok, en az 11 saat dinlenme,
 *   en fazla 6 gün art arda; alan / vardiya kodu uygunluğu; günlük ihtiyaç.
 */

const { generateMonthlyPlan } = require('../services/scheduler');
const { computeScheduleRisks } = require('../services/scheduleRiskService');

// MAX_WEEKLY_HOURS 72: risk panelinde önceden gizli varsayılan olan değer (kaynağı belirsiz);
// burada motor ile denetçinin AYNI kurum değerini uyguladığını göstermek için kullanılır.
const RULES = { ONE_SHIFT_PER_DAY: true, LEAVE_BLOCK: true, NIGHT_NEXT_DAY_OFF: true, MIN_REST_HOURS: 11, MAX_CONSECUTIVE_DAYS: 6, MAX_WEEKLY_HOURS: 72 };
const SHIFTS = [
  { id: 'r-kirmizi', code: 'N', area: 'KIRMIZI', start: '08:00', end: '08:00', hours: 24, isNight: true, requiredCount: 1 },
  { id: 'r-triaj', code: 'M', area: 'TRİAJ', start: '08:00', end: '16:00', hours: 8, requiredCount: 1 },
  { id: 'r-eczane', code: 'V1', area: 'ECZANE', start: '08:00', end: '24:00', hours: 16, requiredCount: 1 },
];
const ALL = { areas: ['KIRMIZI', 'TRİAJ', 'ECZANE'], shiftCodes: ['N', 'M', 'V1'] };
const STAFF = [
  { id: 'p1', name: 'İZİNLİ KİŞİ', ...ALL },                         // 3–5 Aralık izinli
  { id: 'p2', name: 'YALNIZ TRİAJ', areas: ['TRİAJ'], shiftCodes: ['M'] }, // alan kısıtı
  ...Array.from({ length: 6 }, (_, i) => ({ id: `p${i + 3}`, name: `KİŞİ ${i + 3}`, ...ALL })),
];
const LEAVES = { p1: ['2026-12-03', '2026-12-04', '2026-12-05'] };
const DAYS = (n, shifts = SHIFTS) => Array.from({ length: n }, (_, i) => {
  const date = `2026-12-${String(i + 1).padStart(2, '0')}`;
  return { date, weekday: new Date(`${date}T00:00:00Z`).getUTCDay(), shifts: shifts.map((s) => ({ ...s })) };
});

async function run(days, staff = STAFF) {
  return generateMonthlyPlan({
    year: 2026, month: 12,
    getActiveStaff: async () => staff.map((s) => ({ ...s, active: true, role: 'Nurse', meta: { areas: s.areas, shiftCodes: s.shiftCodes } })),
    getMonthlyShifts: async () => JSON.parse(JSON.stringify(days)),
    getLeaves: async () => LEAVES,
    rules: RULES,
    weights: {},
  });
}
const audit = (ctx, days, staff = STAFF) => computeScheduleRisks({
  assignments: ctx.assignments.map((a) => ({ ...a, rowId: a.shiftId })),
  days,
  staff: staff.map((s) => ({ _id: s.id, name: s.name, meta: { areas: s.areas, shiftCodes: s.shiftCodes } })),
  limits: RULES,
});

describe('zorunlu kurallar — 14 günlük plan, 15 tekrar, bağımsız denetim', () => {
  test('izin, çakışma, dinlenme, gece sonrası, art arda gün, haftalık saat, alan ve vardiya kodu ihlali yok; günlük ihtiyaç karşılanır', async () => {
    const days = DAYS(14);
    for (let i = 0; i < 15; i += 1) {
      const ctx = await run(days);
      const res = audit(ctx, days);
      const kural = res.risks.filter((r) => r.type === 'KURAL');
      expect(kural.map((r) => `${r.rule} ${r.date} ${r.personName}`)).toEqual([]);
      // izin günü atama yok
      expect(ctx.assignments.filter((a) => a.personId === 'p1' && LEAVES.p1.includes(a.date))).toEqual([]);
      // alan kısıtı: p2 yalnız TRİAJ
      expect(ctx.assignments.filter((a) => a.personId === 'p2' && a.shiftId !== 'r-triaj')).toEqual([]);
      // günlük ihtiyaç: yeterli kadroyla boş görev yok
      expect(res.risks.filter((r) => r.type === 'BOS_SLOT')).toEqual([]);
    }
  });
});

describe('çözüm bulunamadığında açıklama', () => {
  test('ihtiyaç karşılanamazsa boş görev raporlanır ve neden (aday kalmadı) belirtilir', async () => {
    // Triaj'a günde 3 kişi gerekir; triaj alanı olan yalnız 2 kişi var.
    const staff = [
      { id: 't1', name: 'TRİAJ 1', areas: ['TRİAJ'], shiftCodes: ['M'] },
      { id: 't2', name: 'TRİAJ 2', areas: ['TRİAJ'], shiftCodes: ['M'] },
      { id: 'k1', name: 'KIRMIZI 1', areas: ['KIRMIZI'], shiftCodes: ['N'] },
    ];
    const days = DAYS(2, [{ id: 'r-triaj', code: 'M', area: 'TRİAJ', start: '08:00', end: '16:00', hours: 8, requiredCount: 3 }]);
    const ctx = await run(days, staff);
    const res = audit(ctx, days, staff);
    const bos = res.risks.filter((r) => r.type === 'BOS_SLOT');
    expect(bos.length).toBe(2);
    expect(bos[0].message).toMatch(/3 kişi gerekli, 2 atandı/);
    const issues = ctx.issues || [];
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]).toMatchObject({ reason: expect.stringMatching(/NO_CANDIDATE|EKSIK|MISSING/i) });
  });
});

describe('haftalık saat sınırı motor ve denetçide aynı', () => {
  test('sınır yokken denetçi gizli varsayılan uygulamaz; sınır varken motor aşmaz', async () => {
    const days = DAYS(14);
    const noLimit = computeScheduleRisks({ assignments: [
      { date: '2026-12-07', personId: 'p3', shiftId: 'r-kirmizi', shiftCode: 'N', hours: 24 },
      { date: '2026-12-09', personId: 'p3', shiftId: 'r-kirmizi', shiftCode: 'N', hours: 24 },
      { date: '2026-12-11', personId: 'p3', shiftId: 'r-kirmizi', shiftCode: 'N', hours: 24 },
      { date: '2026-12-13', personId: 'p3', shiftId: 'r-eczane', shiftCode: 'V1', hours: 16 },
    ], days, staff: [{ _id: 'p3', name: 'K', meta: ALL }], limits: { ...RULES, MAX_WEEKLY_HOURS: 0 } });
    expect(noLimit.risks.filter((r) => r.rule === 'HAFTALIK_SAAT')).toEqual([]);
    for (let i = 0; i < 10; i += 1) {
      const ctx = await run(days);
      const res = audit(ctx, days);
      expect(res.risks.filter((r) => r.rule === 'HAFTALIK_SAAT')).toEqual([]);
    }
  });
});
