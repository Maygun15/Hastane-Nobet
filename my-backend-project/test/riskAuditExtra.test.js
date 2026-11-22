'use strict';
// Risk paneli (yayın kapısı) motorla aynı kurum kurallarını denetler: izin günü, haftalık vardiya, kişi başı görev.
const { computeScheduleRisks } = require('../services/scheduleRiskService');

const SH = { id: 'r-m', code: 'M', area: 'TRİAJ', start: '08:00', end: '16:00', hours: 8, requiredCount: 1 };
const days = Array.from({ length: 14 }, (_, i) => ({ date: `2030-01-${String(i + 1).padStart(2, '0')}`, weekday: 0, shifts: [{ ...SH }] }));
const staff = [{ _id: 'p1', name: 'SENTETİK 1', meta: { areas: ['TRİAJ'], shiftCodes: ['M'] } }];
const a = (d) => ({ date: `2030-01-${String(d).padStart(2, '0')}`, personId: 'p1', personName: 'SENTETİK 1', shiftId: 'r-m', shiftCode: 'M', hours: 8 });
const rules = (r) => r.risks.filter((x) => x.type === 'KURAL').map((x) => `${x.rule} ${x.date}`);

test('onaylı izin gününe elle yazılan nöbet KURAL riski olur', () => {
  const r = computeScheduleRisks({ assignments: [a(3), a(5)], days, staff, limits: { LEAVE_BLOCK: true }, leavesByPerson: { p1: ['2030-01-05'] } });
  expect(rules(r)).toEqual(['IZIN_GUNU 2030-01-05']);
});
test('izin kuralı kapalıysa izin günü riski yok', () => {
  const r = computeScheduleRisks({ assignments: [a(5)], days, staff, limits: { LEAVE_BLOCK: false }, leavesByPerson: { p1: ['2030-01-05'] } });
  expect(rules(r)).toEqual([]);
});
test('haftalık vardiya sınırı aşılınca (ISO hafta) bir kez raporlanır', () => {
  // 2030-01-07 Pazartesi … 01-11 Cuma: 5 vardiya, sınır 4
  const r = computeScheduleRisks({ assignments: [7, 8, 9, 10, 11].map(a), days, staff, limits: { MAX_SHIFTS_PER_WEEK: 4 } });
  expect(rules(r)).toEqual(['HAFTALIK_VARDIYA 2030-01-11']);
});
test('kişi başı aynı görev sınırı', () => {
  const r = computeScheduleRisks({ assignments: [1, 3, 5].map(a), days, staff, limits: { MAX_TASK_PER_PERSON: 2 } });
  expect(rules(r)).toEqual(['GOREV_SAYISI 2030-01-05']);
});
