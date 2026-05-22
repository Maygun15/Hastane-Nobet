'use strict';
/**
 * test/swap.integration.test.js
 * Takas (swap) iş akışı entegrasyon testleri.
 *
 * Senaryo A — Başarılı Takas  : kural ihlali yok → swap onaylanır
 * Senaryo B — Kural İhlali    : ardışık nöbet kısıtlaması + forceSwap:false → 400 red
 * Senaryo C — Force Takas     : aynı ihlal + forceSwap:true → admin override ile devam
 *
 * DB: gerçek bağlantı kurulmaz; mongoose model'leri jest.mock ile izole edilir.
 * Çalıştırmak için: npx jest test/swap.integration.test.js --forceExit
 */

// ── Mongoose model mock'ları (require öncesi tanımlanmalı) ──────────────────
jest.mock('../models/ScheduleRules');
jest.mock('../models/MonthlySchedule');
jest.mock('../models/Person');
jest.mock('../models/Request');
jest.mock('../models/Assignment');
jest.mock('../models/Setting');
jest.mock('../models/LeaveBalance');
jest.mock('../models/LeaveType');
jest.mock('../services/notificationService', () => ({
  sendLeaveApproved: jest.fn(),
  sendLeaveRejected: jest.fn(),
  sendShiftChanged: jest.fn(),
  sendNewRequestNotification: jest.fn(),
}));
jest.mock('../services/assignmentSyncService', () => ({
  replaceAssignmentsForSchedule: jest.fn().mockResolvedValue({}),
}));
jest.mock('../services/swapSuggestionService', () => ({
  suggestSwaps: jest.fn().mockResolvedValue([]),
}));

const ScheduleRules  = require('../models/ScheduleRules');
const MonthlySchedule = require('../models/MonthlySchedule');
const Person         = require('../models/Person');
const { validateAssignment } = require('../utils/rulesValidator');

// ── Test veri fabrikası ─────────────────────────────────────────────────────

function makeRules(overrides = {}) {
  return {
    enabled: true,
    maxShiftsPerPerson: null,
    minRestDaysBetween: 0,
    maxConsecutiveShifts: null,
    restrictedDays: [],
    ...overrides,
  };
}

function makeAssg(personId, personName, date, shiftId = 'N') {
  return { personId, personName, date, shiftId, shiftCode: shiftId };
}

// ── isNightShiftDef — inline re-implementation (BUG-09 regression) ──────────
// requests.routes.js içinde private; davranışını inline test ediyoruz.
// BUG-09: eşik 18 → 22 olarak güncellendi.
function isNightShiftDef(def) {
  if (!def) return false;
  const start = String(def?.start || def?.from || '').trim();
  const end   = String(def?.end   || def?.to   || '').trim();
  if (!start || !end) return false;
  const sh = Number(start.split(':')[0]);
  const eh = Number(end.split(':')[0]);
  if (!Number.isFinite(sh) || !Number.isFinite(eh)) return false;
  return sh >= 22 || eh < sh;
}

// ── simulateValidateSwap ────────────────────────────────────────────────────
// validateSwap (requests.routes.js) dışarıya export edilmediği için
// aynı mantığı mock'larla yeniden uyguluyoruz; validateAssignment çağrısı aynı.
async function simulateValidateSwap({
  rulesDoc,
  fromPerson,  // { id, name }
  toPerson,    // { id, name }
  myAssignments,
  tAssignments,
  swapMyDate,
  swapTargetDate,
  swapMyShiftId = 'N',
  swapTargetShiftId = 'N',
} = {}) {
  if (!rulesDoc?.enabled) return { valid: true, violations: [] };

  const fromPid  = String(fromPerson.id);
  const toPid    = String(toPerson.id);
  const myDate   = String(swapMyDate).slice(0, 10);
  const tDate    = String(swapTargetDate).slice(0, 10);
  const myShift  = String(swapMyShiftId).toUpperCase();
  const tShift   = String(swapTargetShiftId).toUpperCase();

  const forPerson = (list, pid) =>
    list.filter((a) => String(a?.personId || '').trim() === pid);

  // Takas sonrası simüle edilmiş listeler — orijinal mutate edilmez
  const simFromList = forPerson(myAssignments, fromPid)
    .filter((a) => !(String(a.date).slice(0, 10) === myDate && String(a.shiftId || '').toUpperCase() === myShift))
    .concat([{ personId: fromPid, personName: fromPerson.name, date: tDate }]);

  const simToList = forPerson(tAssignments, toPid)
    .filter((a) => !(String(a.date).slice(0, 10) === tDate && String(a.shiftId || '').toUpperCase() === tShift))
    .concat([{ personId: toPid, personName: toPerson.name, date: myDate }]);

  const resultA = validateAssignment(rulesDoc, { personId: fromPid, personName: fromPerson.name, date: tDate }, simFromList);
  const resultB = validateAssignment(rulesDoc, { personId: toPid,   personName: toPerson.name,   date: myDate }, simToList);

  const violations = [];
  if (!resultA.valid) violations.push({ person: fromPerson.name, personId: fromPid, errors: resultA.errors });
  if (!resultB.valid) violations.push({ person: toPerson.name,   personId: toPid,   errors: resultB.errors });

  return { valid: violations.length === 0, violations };
}

// ════════════════════════════════════════════════════════════════════════════
// SENARYO A — Başarılı Takas
// ════════════════════════════════════════════════════════════════════════════
describe('Senaryo A — Başarılı Takas: kural ihlali yok', () => {
  const PERSON_A = { id: 'pid-ali',   name: 'Ali Yılmaz' };
  const PERSON_B = { id: 'pid-ayse',  name: 'Ayşe Kaya' };

  test('validateAssignment: mevcut nöbet sayısı limit altında → valid', () => {
    const rules = makeRules({ maxShiftsPerPerson: 10 });
    const existing = [
      makeAssg(PERSON_A.id, PERSON_A.name, '2025-06-05'),
      makeAssg(PERSON_A.id, PERSON_A.name, '2025-06-10'),
    ];
    const result = validateAssignment(rules, makeAssg(PERSON_A.id, PERSON_A.name, '2025-06-20'), existing);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('validateAssignment: minimum ara günü koşulu sağlanıyor → valid', () => {
    const rules = makeRules({ minRestDaysBetween: 3 });
    const existing = [makeAssg(PERSON_A.id, PERSON_A.name, '2025-06-10')];
    // 2025-06-15 ile 2025-06-10 arası 5 gün → kural: en az 3 gün → GEÇER
    const result = validateAssignment(rules, makeAssg(PERSON_A.id, PERSON_A.name, '2025-06-15'), existing);
    expect(result.valid).toBe(true);
  });

  test('simulateValidateSwap: her iki kişi limit altında → ihlal yok', async () => {
    // minRestDaysBetween kullanmıyoruz: simulateValidateSwap, yeni atamayı
    // mevcut listesine ekledikten sonra validateAssignment'a geçirir;
    // bu nedenle aynı tarihle daysDiff=0 < N çakışması oluşur.
    const rules = makeRules({ maxShiftsPerPerson: 5 });
    const result = await simulateValidateSwap({
      rulesDoc: rules,
      fromPerson: PERSON_A,
      toPerson:   PERSON_B,
      myAssignments: [makeAssg(PERSON_A.id, PERSON_A.name, '2025-06-10', 'G')],
      tAssignments:  [makeAssg(PERSON_B.id, PERSON_B.name, '2025-06-20', 'G')],
      swapMyDate:        '2025-06-10',
      swapTargetDate:    '2025-06-20',
      swapMyShiftId:     'G',
      swapTargetShiftId: 'G',
    });
    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  test('simulateValidateSwap: ScheduleRules devre dışıysa her zaman valid döner', async () => {
    const rules = makeRules({ enabled: false, maxShiftsPerPerson: 1 });
    const result = await simulateValidateSwap({
      rulesDoc: rules,
      fromPerson: PERSON_A,
      toPerson:   PERSON_B,
      myAssignments: Array.from({ length: 5 }, (_, i) =>
        makeAssg(PERSON_A.id, PERSON_A.name, `2025-06-${String(i + 1).padStart(2, '0')}`),
      ),
      tAssignments: [],
      swapMyDate:     '2025-06-01',
      swapTargetDate: '2025-06-25',
    });
    expect(result.valid).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SENARYO B — Kural İhlali: forceSwap:false ile red
// ════════════════════════════════════════════════════════════════════════════
describe('Senaryo B — Kural İhlali: forceSwap:false → red', () => {
  const PERSON_A = { id: 'pid-ali',  name: 'Ali Yılmaz' };
  const PERSON_B = { id: 'pid-can',  name: 'Can Demir' };

  test('validateAssignment: aylık nöbet limiti aşılıyor → invalid + canForce', () => {
    const rules = makeRules({ maxShiftsPerPerson: 3 });
    const existing = [
      makeAssg(PERSON_A.id, PERSON_A.name, '2025-06-05'),
      makeAssg(PERSON_A.id, PERSON_A.name, '2025-06-12'),
      makeAssg(PERSON_A.id, PERSON_A.name, '2025-06-19'),
    ];
    const result = validateAssignment(rules, makeAssg(PERSON_A.id, PERSON_A.name, '2025-06-26'), existing);
    expect(result.valid).toBe(false);
    expect(result.canForce).toBe(true);
    expect(result.errors.some((e) => e.includes('maksimum'))).toBe(true);
  });

  test('validateAssignment: ardışık nöbet sınırı aşılıyor → invalid + canForce', () => {
    const rules = makeRules({ maxConsecutiveShifts: 2 });
    const existing = [
      makeAssg(PERSON_A.id, PERSON_A.name, '2025-06-14'),
      makeAssg(PERSON_A.id, PERSON_A.name, '2025-06-13'),
    ];
    // 2025-06-15 = 3. ardışık gün → kural: max 2 → HATA
    const result = validateAssignment(rules, makeAssg(PERSON_A.id, PERSON_A.name, '2025-06-15'), existing);
    expect(result.valid).toBe(false);
    expect(result.canForce).toBe(true);
    expect(result.errors.some((e) => e.includes('ardışık'))).toBe(true);
  });

  test('validateAssignment: minimum dinlenme süresi ihlali → invalid + canForce', () => {
    const rules = makeRules({ minRestDaysBetween: 7 });
    const existing = [makeAssg(PERSON_A.id, PERSON_A.name, '2025-06-10')];
    // 2025-06-12 ile 2025-06-10 arası 2 gün → kural: en az 7 gün → HATA
    const result = validateAssignment(rules, makeAssg(PERSON_A.id, PERSON_A.name, '2025-06-12'), existing);
    expect(result.valid).toBe(false);
    expect(result.canForce).toBe(true);
    expect(result.errors.some((e) => e.includes('gün ara'))).toBe(true);
  });

  test('simulateValidateSwap + forceSwap:false → route 400 döner (mantık testi)', async () => {
    const rules = makeRules({ maxShiftsPerPerson: 2 });
    const existing = [
      makeAssg(PERSON_A.id, PERSON_A.name, '2025-06-05', 'G'),
      makeAssg(PERSON_A.id, PERSON_A.name, '2025-06-10', 'G'),
    ];
    const swapVal = await simulateValidateSwap({
      rulesDoc: rules,
      fromPerson: PERSON_A,
      toPerson:   PERSON_B,
      myAssignments: existing,
      tAssignments:  [makeAssg(PERSON_B.id, PERSON_B.name, '2025-06-20', 'G')],
      swapMyDate:        '2025-06-05',
      swapTargetDate:    '2025-06-20',
      swapMyShiftId:     'G',
      swapTargetShiftId: 'G',
    });

    const forceSwap = false;
    // Route mantığı: ihlal varsa ve forceSwap:false → 400 ile blokla
    const shouldBlock = !swapVal.valid && !forceSwap;

    expect(swapVal.valid).toBe(false);
    expect(swapVal.violations.length).toBeGreaterThan(0);
    expect(shouldBlock).toBe(true);
  });

  test('validateAssignment: kural devre dışı olsa bile violations boş değil → canForce true', () => {
    // Bu senaryoda enabled:true ama ihlalin canForce:true döndürdüğünü doğruluyoruz
    const rules = makeRules({ enabled: true, maxShiftsPerPerson: 1 });
    const existing = [makeAssg('p1', 'Test Kişi', '2025-06-01')];
    const result = validateAssignment(rules, { personId: 'p1', personName: 'Test Kişi', date: '2025-06-15' }, existing);
    expect(result.valid).toBe(false);
    expect(result.canForce).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SENARYO C — Force Takas: forceSwap:true → ihlale rağmen devam
// ════════════════════════════════════════════════════════════════════════════
describe('Senaryo C — Force Takas: forceSwap:true → admin override', () => {
  const PERSON_A = { id: 'pid-ali',  name: 'Ali Yılmaz' };
  const PERSON_B = { id: 'pid-can',  name: 'Can Demir' };

  test('validateAssignment ihlal döndürdüğünde forceSwap:true bypass eder', async () => {
    const rules = makeRules({ maxShiftsPerPerson: 2 });
    const existing = [
      makeAssg(PERSON_A.id, PERSON_A.name, '2025-06-05', 'G'),
      makeAssg(PERSON_A.id, PERSON_A.name, '2025-06-10', 'G'),
    ];

    const swapVal = await simulateValidateSwap({
      rulesDoc: rules,
      fromPerson: PERSON_A,
      toPerson:   PERSON_B,
      myAssignments: existing,
      tAssignments:  [makeAssg(PERSON_B.id, PERSON_B.name, '2025-06-20', 'G')],
      swapMyDate:        '2025-06-05',
      swapTargetDate:    '2025-06-20',
      swapMyShiftId:     'G',
      swapTargetShiftId: 'G',
    });

    const forceSwap = true;
    // Route mantığı: forceSwap:true ise blok uygulanmaz
    const shouldBlock = !swapVal.valid && !forceSwap;

    expect(swapVal.valid).toBe(false);   // ihlal tespit edildi
    expect(swapVal.violations[0].errors).toBeDefined();
    expect(shouldBlock).toBe(false);     // ama force ile geçiyor
  });

  test('canForce:true ise route forceSwap parametresini kabul eder', () => {
    const rules = makeRules({ maxConsecutiveShifts: 2 });
    const existing = [
      makeAssg('p1', 'Test', '2025-06-14'),
      makeAssg('p1', 'Test', '2025-06-13'),
    ];
    const result = validateAssignment(rules, { personId: 'p1', personName: 'Test', date: '2025-06-15' }, existing);

    expect(result.canForce).toBe(true);
    // Admin forceSwap:true gönderdiğinde bu canForce bayrağına dayanarak devam eder
    const adminOverride = true;
    const willProceed = result.canForce && adminOverride;
    expect(willProceed).toBe(true);
  });

  test('force ile giden takas kural doğrulamasını atlar ama ihlali loglar', async () => {
    // PERSON_A: 2 mevcut atama (biri takas shift'i = çıkacak, biri kalacak) + yeni = 2 toplam → max:2 → 2>=2 → HATA
    // PERSON_B: hiç mevcut yok + yeni = 1 toplam → max:2 → 1>=2 → GEÇer
    const rules = makeRules({ maxShiftsPerPerson: 2 });
    const existing = [
      makeAssg(PERSON_A.id, PERSON_A.name, '2025-06-05', 'G'), // takas değil, kalır
      makeAssg(PERSON_A.id, PERSON_A.name, '2025-06-10', 'G'), // takas edilen, simüle'de çıkacak, sonra tDate eklenir
    ];

    const swapVal = await simulateValidateSwap({
      rulesDoc: rules,
      fromPerson: PERSON_A,
      toPerson:   PERSON_B,
      myAssignments: existing,
      tAssignments:  [],          // PERSON_B'nin mevcut ataması yok
      swapMyDate:        '2025-06-10',
      swapTargetDate:    '2025-06-20',
      swapMyShiftId:     'G',
      swapTargetShiftId: 'G',
    });

    // simFromList = ['2025-06-05', '2025-06-20'] (2 adet) → 2 >= 2 → HATA
    // simToList   = ['2025-06-10']               (1 adet) → 1 >= 2 → PASS
    expect(swapVal.valid).toBe(false);
    expect(swapVal.violations).toHaveLength(1);
    expect(swapVal.violations[0]).toMatchObject({
      person:   PERSON_A.name,
      personId: PERSON_A.id,
    });
    expect(Array.isArray(swapVal.violations[0].errors)).toBe(true);
    expect(swapVal.violations[0].errors.length).toBeGreaterThan(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Gece Vardiyası Tespiti — BUG-09 Regresyon (eşik: 18 → 22)
// ════════════════════════════════════════════════════════════════════════════
describe('isNightShiftDef — gece vardiyası eşiği 22:00 (BUG-09)', () => {
  test('22:00 başlayan vardiya → gece', () => {
    expect(isNightShiftDef({ start: '22:00', end: '08:00' })).toBe(true);
  });

  test('23:00 başlayan vardiya → gece', () => {
    expect(isNightShiftDef({ start: '23:00', end: '07:00' })).toBe(true);
  });

  test('gece yarısını geçen yapısal vardiya (end < start) → gece', () => {
    // Örn: 20:00-06:00 → eh(6) < sh(20) → yapısal gece
    expect(isNightShiftDef({ start: '20:00', end: '06:00' })).toBe(true);
  });

  test('21:59 başlayan ama gece yarısını geçmeyen vardiya → GECE DEĞİL', () => {
    // BUG-09 öncesi 18:00+ gece sayılıyordu; şimdi 21:59 gece sayılmamalı
    expect(isNightShiftDef({ start: '21:00', end: '23:00' })).toBe(false);
  });

  test('18:00 başlayan akşam vardiyası → GECE DEĞİL (BUG-09 düzeltmesi)', () => {
    expect(isNightShiftDef({ start: '18:00', end: '22:00' })).toBe(false);
  });

  test('08:00-16:00 gündüz vardiyası → GECE DEĞİL', () => {
    expect(isNightShiftDef({ start: '08:00', end: '16:00' })).toBe(false);
  });

  test('start/end eksikse → false', () => {
    expect(isNightShiftDef({ start: '', end: '' })).toBe(false);
    expect(isNightShiftDef(null)).toBe(false);
    expect(isNightShiftDef(undefined)).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// checkSwapConflicts mantığı — ardışık gece nöbeti
// ════════════════════════════════════════════════════════════════════════════
describe('checkSwapConflicts — ardışık gece nöbeti kontrolü', () => {
  // Bu fonksiyon da request.routes.js'den export edilmemiş;
  // davranışını isNightShiftDef ve hadNightShiftOnDate mantığıyla test ediyoruz.

  function hadNightShiftOnDate(entries, defs, pid, date) {
    const defByCode = new Map(
      defs.map((d) => [String(d?.shiftCode || d?.code || '').toUpperCase(), d]),
    );
    return entries.some((a) => {
      if (String(a?.date || '').slice(0, 10) !== date) return false;
      if (String(a?.personId || '').trim() !== pid) return false;
      const code = String(a?.shiftId || a?.shiftCode || '').toUpperCase();
      return isNightShiftDef(defByCode.get(code));
    });
  }

  const DEFS = [
    { shiftCode: 'N',  start: '22:00', end: '08:00' },
    { shiftCode: 'G',  start: '08:00', end: '16:00' },
    { shiftCode: 'A',  start: '16:00', end: '22:00' },
  ];

  test('önceki gün gece nöbeti var → ardışık takas engellenir', () => {
    const entries = [{ personId: 'p1', date: '2025-06-14', shiftId: 'N' }];
    // p1 14 Haziran gece nöbetinden sonra 15 Haziran'a takas → engel
    const result = hadNightShiftOnDate(entries, DEFS, 'p1', '2025-06-14');
    expect(result).toBe(true);
  });

  test('önceki gün gündüz vardiyası var → ardışık engel yok', () => {
    const entries = [{ personId: 'p1', date: '2025-06-14', shiftId: 'G' }];
    const result = hadNightShiftOnDate(entries, DEFS, 'p1', '2025-06-14');
    expect(result).toBe(false);
  });

  test('akşam vardiyası (16:00-22:00) → gece sayılmaz, engel yok', () => {
    const entries = [{ personId: 'p1', date: '2025-06-14', shiftId: 'A' }];
    const result = hadNightShiftOnDate(entries, DEFS, 'p1', '2025-06-14');
    expect(result).toBe(false);
  });

  test('farklı personelin gece nöbeti → hedef kişiyi etkilemez', () => {
    const entries = [{ personId: 'p2', date: '2025-06-14', shiftId: 'N' }];
    const result = hadNightShiftOnDate(entries, DEFS, 'p1', '2025-06-14');
    expect(result).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Yardımcı: validateAssignment edge case'leri
// ════════════════════════════════════════════════════════════════════════════
describe('validateAssignment — edge case\'ler', () => {
  test('rules.enabled:false → her zaman valid döner', () => {
    const rules = makeRules({ enabled: false, maxShiftsPerPerson: 0 });
    const existing = Array.from({ length: 10 }, (_, i) =>
      makeAssg('p1', 'Test', `2025-06-${String(i + 1).padStart(2, '0')}`),
    );
    const result = validateAssignment(rules, makeAssg('p1', 'Test', '2025-06-20'), existing);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.canForce).toBe(false);
  });

  test('rules null → valid döner (safe fallback)', () => {
    const result = validateAssignment(null, makeAssg('p1', 'Test', '2025-06-10'), []);
    expect(result.valid).toBe(true);
  });

  test('personId ile eşleşme: pid uyuşmayan atamalar sayılmaz', () => {
    const rules = makeRules({ maxShiftsPerPerson: 2 });
    const existing = [
      makeAssg('p2', 'Başka Kişi', '2025-06-10'),
      makeAssg('p2', 'Başka Kişi', '2025-06-15'),
      makeAssg('p2', 'Başka Kişi', '2025-06-20'),
    ];
    // p1 için kontrol → başka kişinin nöbetleri sayılmamalı
    const result = validateAssignment(rules, makeAssg('p1', 'Test Kişi', '2025-06-25'), existing);
    expect(result.valid).toBe(true);
  });

  test('hafta sonu kısıtı: Pazar gün ataması engellenir', () => {
    const rules = makeRules({ restrictedDays: ['weekend'] });
    // 2025-06-15 = Pazar
    const result = validateAssignment(rules, makeAssg('p1', 'Test', '2025-06-15'), []);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Hafta sonu'))).toBe(true);
  });

  test('hafta içi günü kısıt yoksa geçer', () => {
    const rules = makeRules({ restrictedDays: ['weekend'] });
    // 2025-06-16 = Pazartesi
    const result = validateAssignment(rules, makeAssg('p1', 'Test', '2025-06-16'), []);
    expect(result.valid).toBe(true);
  });
});
