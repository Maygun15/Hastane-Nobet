'use strict';
const { fingerprint, requestContent } = require('../utils/idempotency');

describe('işlem kimliği içerik parmak izi', () => {
  test('alan sırası ve boşluk farkı aynı içeriği değiştirmez', () => {
    const a = requestContent({ type: 'izin', targetDate: '2030-01-14', message: ' rapor ', leaveTypeCode: 'r' });
    const b = requestContent({ leaveTypeCode: 'R', message: 'rapor', targetDate: '2030-01-14T00:00:00Z', type: 'izin' });
    expect(fingerprint(a)).toBe(fingerprint(b));
  });
  test('tarih değişirse parmak izi değişir', () => {
    const a = requestContent({ type: 'izin', targetDate: '2030-01-14', targetDateEnd: '2030-01-15' });
    const b = requestContent({ type: 'izin', targetDate: '2030-01-14', targetDateEnd: '2030-01-16' });
    expect(fingerprint(a)).not.toBe(fingerprint(b));
  });
  test('iç içe nesnede anahtar sırası önemsiz', () => {
    expect(fingerprint({ data: { b: 1, a: [1, { y: 2, x: 1 }] } })).toBe(fingerprint({ data: { a: [1, { x: 1, y: 2 }], b: 1 } }));
  });
});
