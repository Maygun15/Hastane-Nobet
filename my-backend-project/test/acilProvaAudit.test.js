'use strict';

// Prova denetçisi gerçekten ihlal yakalıyor mu? (scripts/acilProva.js — "0 ihlal" sonucuna güven için)

const { audit } = require('../scripts/acilProva');

const rules = { MIN_REST_HOURS: 12, MAX_CONSECUTIVE_DAYS: 6, NIGHT_NEXT_DAY_OFF: true };
const staff = [
  { id: 's1', name: 'A', meta: { areas: ['KIRMIZI', 'TRİAJ'], shiftCodes: ['M', 'N', 'M4'] } },
];
const shift = (id, code, area, start, end, hours) => ({ id, code, area, start, end, hours, requiredCount: 1 });
const day = (date, weekday, shifts) => ({ date, weekday, shifts });
const asg = (date, shiftId, code, start, end, hours, personId = 's1') =>
  ({ date, shiftId, shiftCode: code, start, end, hours, personId, personName: personId });

const types = (v) => v.map((x) => x.type).sort();

describe('acilProva audit', () => {
  test('temiz çizelgede ihlal yok', () => {
    const days = [day('2026-12-01', 2, [shift('r1', 'M', 'KIRMIZI', '08:00', '16:00', 8)]),
      day('2026-12-02', 3, [shift('r1', 'M', 'KIRMIZI', '08:00', '16:00', 8)])];
    const v = audit({ assignments: [asg('2026-12-01', 'r1', 'M', '08:00', '16:00', 8), asg('2026-12-02', 'r1', 'M', '08:00', '16:00', 8)], days, staff, rules, maxWeeklyHours: 72 });
    expect(v).toEqual([]);
  });

  test('24 saat nöbetin ertesi günü çalışma ve 12 saat dinlenme yakalanır', () => {
    const days = [day('2026-12-01', 2, [shift('r1', 'N', 'KIRMIZI', '08:00', '08:00', 24)]),
      day('2026-12-02', 3, [shift('r2', 'M', 'KIRMIZI', '08:00', '16:00', 8)])];
    const v = audit({ assignments: [asg('2026-12-01', 'r1', 'N', '08:00', '08:00', 24), asg('2026-12-02', 'r2', 'M', '08:00', '16:00', 8)], days, staff, rules, maxWeeklyHours: 72 });
    expect(types(v)).toEqual(['DINLENME_12S', 'GECE_SONRASI_GUN']);
  });

  test('alan, vardiya kodu, aynı gün iki vardiya ve hafta sonu M4 yakalanır', () => {
    const days = [day('2026-12-05', 6, [
      shift('r1', 'M', 'ÇOCUK', '08:00', '16:00', 8),
      shift('r2', 'V1', 'KIRMIZI', '08:00', '00:00', 16),
      shift('r3', 'M4', 'TRİAJ', '16:00', '00:00', 8),
    ])];
    const v = audit({ assignments: [
      asg('2026-12-05', 'r1', 'M', '08:00', '16:00', 8),
      asg('2026-12-05', 'r3', 'M4', '16:00', '00:00', 8),
    ], days, staff, rules, maxWeeklyHours: 72 });
    // M (08-16) ardından M4 (16-24): aynı gün iki vardiya + arada 0 saat dinlenme.
    expect(types(v)).toEqual(['ALAN_UYGUN_DEGIL', 'DINLENME_12S', 'GUNDE_IKI_VARDIYA', 'HAFTA_SONU_M4']);

    const v2 = audit({ assignments: [asg('2026-12-05', 'r2', 'V1', '08:00', '00:00', 16)], days, staff, rules, maxWeeklyHours: 72 });
    expect(types(v2)).toEqual(['VARDIYA_KODU_UYGUN_DEGIL']);
  });

  test('art arda 7 gün ve haftalık saat sınırı yakalanır', () => {
    // 1 Aralık 2026 Salı: 1-6 Aralık aynı ISO haftası → 6 × 13 = 78 saat > 72.
    const dates = Array.from({ length: 7 }, (_, i) => `2026-12-0${i + 1}`);
    const days = dates.map((d, i) => day(d, (i + 2) % 7, [shift('r1', 'M', 'KIRMIZI', '08:00', '21:00', 13)]));
    const v = audit({
      assignments: dates.map((d) => asg(d, 'r1', 'M', '08:00', '21:00', 13)),
      days, staff, rules, maxWeeklyHours: 72,
    });
    expect(types(v)).toContain('ART_ARDA_GUN');
    expect(types(v)).toContain('HAFTALIK_SAAT');
  });
});
