'use strict';

/**
 * İP-3 / C — eş zamanlı düzenlemede veri kaybı yok.
 *  - eski revizyonla kayıt → 409 (kim, ne zaman); yazma yok
 *  - karşılaştır-ve-güncelle atomik: filtre okunan revizyonu içerir, $inc ile artar
 *  - okuma ile yazma arasında başkası yazdıysa (CAS kaçtı) → 409
 *  - aynı opId tekrarı → ikinci yazma yok, aynı sonuç
 *  - revizyonsuz eski kayıt 0 kabul edilir
 */

jest.mock('../models/MonthlySchedule', () => ({ findOne: jest.fn(), findOneAndUpdate: jest.fn() }));
jest.mock('../models/Assignment');
jest.mock('../models/Person', () => ({
  find: jest.fn(() => ({ select: () => ({ lean: () => Promise.resolve([
    { _id: 'p2', name: 'Zeynep Ak' }, { _id: 'p3', name: 'Aynı İsim' }, { _id: 'p4', name: 'Aynı İsim' },
  ]) }) })),
}));
jest.mock('../models/ScheduleRules');
jest.mock('../services/holidayService', () => ({ listHolidays: jest.fn().mockResolvedValue([]) }));
jest.mock('../services/notificationService', () => ({ sendShiftChanged: jest.fn() }));
jest.mock('../services/assignmentSyncService', () => ({ replaceAssignmentsForSchedule: jest.fn(), removeAssignment: jest.fn() }));
jest.mock('../services/scheduleChangeService', () => ({ recordChange: jest.fn().mockResolvedValue(null) }), { virtual: false });

const MonthlySchedule = require('../models/MonthlySchedule');
const schedulesRouter = require('../routes/schedules.routes');

const SCOPE = { sectionId: 'calisma-cizelgesi', serviceId: 'svc-a', role: 'Nurse', year: 2026, month: 12 };
const ADMIN = { uid: 'u-1', name: 'Planlayıcı Bir', role: 'admin', serviceIds: [] };
const lean = (v) => ({ lean: () => Promise.resolve(v), select: () => ({ lean: () => Promise.resolve(v) }) });

function call(body) {
  const layer = schedulesRouter.stack.find((l) => l.route?.path === '/monthly' && l.route.methods.put);
  const handlers = layer.route.stack.map((x) => x.handle);
  const req = { method: 'PUT', body: { ...SCOPE, ...body }, query: {}, params: {}, user: ADMIN, hospitalId: 'h1' };
  return new Promise((resolve, reject) => {
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(p) { resolve({ status: this.statusCode, body: p }); } };
    let i = 0;
    const next = (err) => { if (err) return reject(err); const h = handlers[i++]; if (!h) return resolve({ status: res.statusCode }); return Promise.resolve(h(req, res, next)).catch(reject); };
    next();
  });
}

const existing = { _id: 'm1', ...SCOPE, revision: 5, updatedByName: 'Planlayıcı İki', updatedAt: new Date('2026-11-21T20:00:00Z'), data: { defs: [] } };

beforeEach(() => jest.clearAllMocks());

test('eski revizyona dayanan kayıt 409 + kim değiştirdi; yazma yok', async () => {
  MonthlySchedule.findOne.mockReturnValue(lean(existing));
  const r = await call({ data: { defs: [] }, baseRevision: 4 });
  expect(r.status).toBe(409);
  expect(r.body).toMatchObject({ code: 'SCHEDULE_REVISION_CONFLICT', currentRevision: 5, updatedByName: 'Planlayıcı İki' });
  expect(r.body.message).toMatch(/Planlayıcı İki tarafından değiştirildi/);
  expect(MonthlySchedule.findOneAndUpdate).not.toHaveBeenCalled();
});

test('güncel revizyonla kayıt: filtre revizyonu içerir ve $inc ile artar', async () => {
  MonthlySchedule.findOne.mockReturnValue(lean(existing));
  MonthlySchedule.findOneAndUpdate.mockReturnValue(lean({ ...existing, revision: 6, updatedByName: 'Planlayıcı Bir' }));
  const r = await call({ data: { defs: [] }, baseRevision: 5, opId: 'op-abcdefgh1' });
  expect(r.status).toBe(200);
  expect(r.body.schedule.revision).toBe(6);
  const [filter, update] = MonthlySchedule.findOneAndUpdate.mock.calls[0];
  expect(filter).toMatchObject({ _id: 'm1', revision: 5 });
  expect(update.$inc).toEqual({ revision: 1 });
  expect(update.$set).toMatchObject({ lastOpId: 'op-abcdefgh1', updatedByName: 'Planlayıcı Bir' });
});

test('okuma ile yazma arasında başkası yazdıysa (CAS eşleşmedi) 409', async () => {
  MonthlySchedule.findOne
    .mockReturnValueOnce(lean(existing))
    .mockReturnValueOnce(lean({ ...existing, revision: 6, updatedByName: 'Planlayıcı İki' }));
  MonthlySchedule.findOneAndUpdate.mockReturnValue(lean(null));
  const r = await call({ data: { defs: [] }, baseRevision: 5 });
  expect(r.status).toBe(409);
  expect(r.body).toMatchObject({ code: 'SCHEDULE_REVISION_CONFLICT', currentRevision: 6 });
});

test('aynı işlem kimliği tekrarlanınca ikinci yazma olmaz, aynı sonuç döner', async () => {
  MonthlySchedule.findOne.mockReturnValue(lean({ ...existing, revision: 6, lastOpId: 'op-abcdefgh1' }));
  const r = await call({ data: { defs: [] }, baseRevision: 5, opId: 'op-abcdefgh1' });
  expect(r.status).toBe(200);
  expect(r.body).toMatchObject({ replayed: true, schedule: { revision: 6 } });
  expect(MonthlySchedule.findOneAndUpdate).not.toHaveBeenCalled();
});

test('revizyon alanı olmayan eski kayıt 0 sayılır; filtre eski kaydı da yakalar', async () => {
  const legacy = { _id: 'm0', ...SCOPE, data: { defs: [] } };
  MonthlySchedule.findOne.mockReturnValue(lean(legacy));
  MonthlySchedule.findOneAndUpdate.mockReturnValue(lean({ ...legacy, revision: 1 }));
  const r = await call({ data: { defs: [] }, baseRevision: 0 });
  expect(r.status).toBe(200);
  const [filter] = MonthlySchedule.findOneAndUpdate.mock.calls[0];
  expect(filter.$or).toEqual(expect.arrayContaining([{ revision: { $exists: false } }]));
});

test('revizyon bildirmeyen eski istemci kabul edilir ama revizyon yine artar', async () => {
  MonthlySchedule.findOne.mockReturnValue(lean(existing));
  MonthlySchedule.findOneAndUpdate.mockReturnValue(lean({ ...existing, revision: 6 }));
  const r = await call({ data: { defs: [] } });
  expect(r.status).toBe(200);
  expect(MonthlySchedule.findOneAndUpdate.mock.calls[0][1].$inc).toEqual({ revision: 1 });
});

describe('kaydederken personId kaybolmaz', () => {
  const { restorePersonIds } = schedulesRouter.__test;
  test('isimli tablodan gelen atamaya personId geri yazılır (mevcut kayıt → personel listesi); belirsiz isim boş kalır', async () => {
    const r = await restorePersonIds(
      [
        { date: '2026-12-01', personName: 'Ayşe Kaya' },
        { date: '2026-12-02', personName: 'ZEYNEP AK' },
        { date: '2026-12-03', personName: 'Aynı İsim' },
        { date: '2026-12-04', personId: 'p9', personName: 'X' },
      ],
      [{ date: '2026-11-30', personId: 'p1', personName: 'AYŞE KAYA' }],
      'h1'
    );
    expect(r.assignments.map((a) => a.personId)).toEqual(['p1', 'p2', undefined, 'p9']);
    expect(r.restored).toBe(2);
  });
});
