'use strict';

const { computeScheduleRisks } = require('../services/scheduleRiskService');
// Kurum kuralları (yetkili kaynak) — risk servisi gizli varsayılan kullanmaz.
const INSTITUTION_LIMITS = { ONE_SHIFT_PER_DAY: true, LEAVE_BLOCK: true, NIGHT_NEXT_DAY_OFF: true, MIN_REST_HOURS: 11, MAX_CONSECUTIVE_DAYS: 6 };

const day = (date, weekday, shifts) => ({ date, weekday, shifts });
const shift = (id, code, area, start, end, hours, requiredCount = 1) => ({ id, code, area, start, end, hours, requiredCount });
const staff = [
  { _id: 'p1', name: 'Ayşe', meta: { areas: ['SERVİS SORUMLUSU', 'KIRMIZI'], shiftCodes: ['M', 'N', 'V1'] } },
  { _id: 'p2', name: 'Fatma', meta: { areas: ['KIRMIZI'], shiftCodes: ['M', 'N'] } },
];

describe('computeScheduleRisks', () => {
  test('boş slot: gereken 2, atanan 1', () => {
    const days = [day('2026-12-07', 1, [shift('r1', 'M', 'SERVİS SORUMLUSU', '08:00', '16:00', 8, 2)])];
    const res = computeScheduleRisks({
      assignments: [{ date: '2026-12-07', shiftId: 'r1', shiftCode: 'M', personId: 'p1', personName: 'Ayşe' }],
      days, staff,
    });
    expect(res.risks).toEqual([expect.objectContaining({
      key: 'BOS_SLOT|2026-12-07|r1', type: 'BOS_SLOT', severity: 'yuksek',
      message: '07.12 · SERVİS SORUMLUSU (M): 2 kişi gerekli, 1 atandı', acknowledged: false,
    })]);
    expect(res.pending).toBe(1);
  });

  test('karar verilen risk acknowledged olur ve pending düşer', () => {
    const days = [day('2026-12-07', 1, [shift('r1', 'M', 'SERVİS SORUMLUSU', '08:00', '16:00', 8, 1)])];
    const res = computeScheduleRisks({
      assignments: [], days, staff,
      acks: { 'BOS_SLOT|2026-12-07|r1': { by: 'admin', note: 'kadro yok' } },
    });
    expect(res.risks[0]).toMatchObject({ acknowledged: true, ack: { note: 'kadro yok' } });
    expect(res.pending).toBe(0);
  });

  test('elle yapılan kural ihlali (24 saat sonrası gün) KURAL riski olur', () => {
    const days = [
      day('2026-12-01', 2, [shift('rN', 'N', 'KIRMIZI', '08:00', '08:00', 24)]),
      day('2026-12-02', 3, [shift('rM', 'M', 'KIRMIZI', '08:00', '16:00', 8)]),
    ];
    const res = computeScheduleRisks({ limits: INSTITUTION_LIMITS,
      assignments: [
        { date: '2026-12-01', shiftId: 'rN', shiftCode: 'N', personId: 'p2', personName: 'Fatma' },
        { date: '2026-12-02', shiftId: 'rM', shiftCode: 'M', personId: 'p2', personName: 'Fatma' },
      ],
      days, staff,
    });
    const rules = res.risks.filter((r) => r.type === 'KURAL').map((r) => r.rule).sort();
    expect(rules).toEqual(['DINLENME_12S', 'GECE_SONRASI_GUN']);
  });

  test('V1 sonrası ertesi gün M4: gece sonrası kuralı değil (V1 dinlenme gecesi sayılmaz)', () => {
    const days = [
      day('2026-12-01', 2, [shift('rV', 'V1', 'KIRMIZI', '08:00', '00:00', 16)]),
      day('2026-12-02', 3, [shift('rM4', 'M', 'KIRMIZI', '16:00', '00:00', 8)]),
    ];
    const res = computeScheduleRisks({
      assignments: [
        { date: '2026-12-01', shiftId: 'rV', shiftCode: 'V1', personId: 'p1', personName: 'Ayşe' },
        { date: '2026-12-02', shiftId: 'rM4', shiftCode: 'M', personId: 'p1', personName: 'Ayşe' },
      ],
      days, staff,
    });
    expect(res.risks.filter((r) => r.type === 'KURAL')).toEqual([]);
  });

  test('tercih çelişkisi: onaylı = yüksek, bekleyen = orta; V1 gece sayılır', () => {
    const days = [
      day('2026-12-05', 6, [shift('rV', 'V1', 'KIRMIZI', '08:00', '00:00', 16)]),
      day('2026-12-06', 0, [shift('rM', 'M', 'KIRMIZI', '08:00', '16:00', 8)]),
    ];
    const res = computeScheduleRisks({
      assignments: [
        { date: '2026-12-05', shiftId: 'rV', shiftCode: 'V1', personId: 'p1', personName: 'Ayşe' },
        { date: '2026-12-06', shiftId: 'rM', shiftCode: 'M', personId: 'p2', personName: 'Fatma' },
      ],
      days, staff,
      preferencesByPerson: { p1: { hardNoNight: ['2026-12-05'] }, p2: { softOff: ['2026-12-06'] } },
    });
    const tercih = res.risks.filter((r) => r.type === 'TERCIH');
    expect(tercih.map((r) => [r.key, r.severity])).toEqual([
      ['TERCIH|noNight|2026-12-05|p1', 'yuksek'],
      ['TERCIH|off|2026-12-06|p2', 'orta'],
    ]);
  });

  test('çalışma alanı boş personel VERI_EKSIGI', () => {
    const res = computeScheduleRisks({ assignments: [], days: [], staff: [...staff, { _id: 'p9', name: 'Boş', meta: { areas: [], shiftCodes: [] } }] });
    expect(res.risks).toEqual([expect.objectContaining({
      key: 'VERI_EKSIGI|p9', type: 'VERI_EKSIGI',
      message: 'Boş: çalışma alanı ve vardiya kodu tanımlı değil — hiçbir göreve atanamaz',
    })]);
  });
});

describe('rankSlotCandidates', () => {
  const { rankSlotCandidates } = require('../services/scheduleRiskService');
  const days = [
    day('2026-12-06', 0, [shift('rN', 'N', 'KIRMIZI', '08:00', '08:00', 24)]),
    day('2026-12-07', 1, [shift('r2', 'M', 'SERVİS SORUMLUSU', '08:00', '16:00', 8)]),
  ];
  const people = [
    { _id: 'a', name: 'Alan Uygun', meta: { areas: ['SERVİS SORUMLUSU'], shiftCodes: ['M'] } },
    { _id: 'b', name: 'Gece Çıkışı', meta: { areas: ['SERVİS SORUMLUSU', 'KIRMIZI'], shiftCodes: ['M', 'N'] } },
    { _id: 'c', name: 'Alanı Yok', meta: { areas: ['KIRMIZI'], shiftCodes: ['M'] } },
    { _id: 'd', name: 'İzin İstedi', meta: { areas: ['SERVİS SORUMLUSU'], shiftCodes: ['M'] } },
    { _id: 'e', name: 'Ekip Sorumlusu', meta: { areas: ['EKİP SORUMLUSU'], shiftCodes: ['M'] } },
  ];

  test('uygun aday önce; gece çıkışı, alan ve onaylı tercih gerekçeli elenir', () => {
    const res = rankSlotCandidates({ limits: INSTITUTION_LIMITS,
      assignments: [{ date: '2026-12-06', shiftId: 'rN', shiftCode: 'N', personId: 'b', personName: 'Gece Çıkışı' }],
      days, staff: people,
      preferencesByPerson: { d: { hardOff: ['2026-12-07'] } },
      date: '2026-12-07', rowId: 'r2',
    });
    expect(res.slot).toMatchObject({ rowId: 'r2', shiftCode: 'M', area: 'SERVİS SORUMLUSU' });
    expect(res.candidates[0]).toMatchObject({ personId: 'a', eligible: true, reasons: [] });
    const byId = Object.fromEntries(res.candidates.map((c) => [c.personId, c]));
    expect(byId.b.eligible).toBe(false);
    expect(byId.b.reasons.join(' ')).toContain('Kural ihlali');
    expect(byId.c.reasons).toContain('Alanı uygun değil');
    expect(byId.d.reasons).toContain('Onaylı tercihi var');
    // "EKİP SORUMLUSU" kelime olarak "SERVİS SORUMLUSU" ile eşleşse de servis sorumlusu yetkisi yok
    expect(byId.e.reasons).toContain('Alanı uygun değil');
  });

  test('olmayan görev için slot null', () => {
    expect(rankSlotCandidates({ days, staff: people, date: '2026-12-07', rowId: 'yok' }).slot).toBeNull();
  });
});
