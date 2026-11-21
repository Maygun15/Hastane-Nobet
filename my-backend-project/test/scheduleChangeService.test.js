'use strict';
// İP-5 / E — işlem geçmişi ve yayın sürümleri.
jest.mock('../models/ScheduleChange', () => ({ create: jest.fn((x) => Promise.resolve({ _id: 'ev', ...x })), findOne: jest.fn(), find: jest.fn() }));
const ScheduleChange = require('../models/ScheduleChange');
const svc = require('../services/scheduleChangeService');

const A = (date, personId, rowId = 'r1', shiftCode = 'N') => ({ date, personId, rowId, shiftCode, personName: personId.toUpperCase() });
const chain = (v) => ({ sort: () => ({ select: () => ({ lean: () => Promise.resolve(v) }) }) });
beforeEach(() => jest.clearAllMocks());

test('fark: eklenen ve çıkan nöbetler kişi/tarih/görev ile', () => {
  const d = svc.diffAssignments([A('2026-12-01', 'p1'), A('2026-12-02', 'p2')], [A('2026-12-01', 'p1'), A('2026-12-02', 'p3')]);
  expect(d.added).toEqual([expect.objectContaining({ date: '2026-12-02', personId: 'p3', shiftCode: 'N' })]);
  expect(d.removed).toEqual([expect.objectContaining({ date: '2026-12-02', personId: 'p2' })]);
});

test('içerik değişmeyen kayıt geçmişe yazılmaz; değişen yazılır (kim + revizyon)', async () => {
  const scope = { hospitalId: 'h', sectionId: 's', serviceId: 'v', role: 'Nurse', year: 2026, month: 12 };
  expect(await svc.recordChange({ scope, before: [A('2026-12-01', 'p1')], after: [A('2026-12-01', 'p1')] })).toBeNull();
  await svc.recordChange({ scope, before: [], after: [A('2026-12-01', 'p1')], user: { uid: 'u1', name: 'Planlayıcı' }, contentRevision: 4 });
  expect(ScheduleChange.create).toHaveBeenCalledWith(expect.objectContaining({ kind: 'edit', byName: 'Planlayıcı', contentRevision: 4, addedCount: 1 }));
});

test('ilk yayın sürüm 1; sonraki yayın önceki anlık görüntüye göre fark ve etkilenenler', async () => {
  const scope = { sectionId: 's', year: 2026, month: 12 };
  ScheduleChange.findOne.mockReturnValueOnce(chain(null));
  const first = await svc.preparePublish(scope, [A('2026-12-01', 'p1')]);
  expect(first).toMatchObject({ version: 1, isRevision: false });

  ScheduleChange.findOne.mockReturnValueOnce(chain({ publishVersion: 1, snapshot: first.snapshot }));
  const second = await svc.preparePublish(scope, [A('2026-12-01', 'p2')]);
  expect(second).toMatchObject({ version: 2, isRevision: true, previousVersion: 1 });
  expect(second.added.map((x) => x.personId)).toEqual(['p2']);
  // Önceki anlık görüntüde kişi isimle tutulur (iki veri biçimi aynı anahtarı alsın).
  expect(second.removed.map((x) => x.personName)).toEqual(['P1']);
  expect(second.affectedPersonIds.sort()).toEqual(['n:P1', 'p2']);
});

test('aynı nöbetin personId li ve yalnız isimli biçimi fark üretmez', () => {
  const d = svc.diffAssignments(
    [{ date: '2026-12-01', rowId: 'r1', personId: 'p1', personName: 'Ayşe' }],
    [{ date: '2026-12-01', rowId: 'r1', personName: 'AYŞE' }]
  );
  expect(d).toEqual({ added: [], removed: [] });
});
