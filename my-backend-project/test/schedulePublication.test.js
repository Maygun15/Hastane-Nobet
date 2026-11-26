'use strict';

// Taslak / yayınlandı: personel ('user') taslak çizelgeyi göremez; sorumlu görür.
// Yayınla → durum 'published' + sadece o çizelgedeki kişilere bildirim.

jest.mock('../models/MonthlySchedule', () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
  updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
}));
jest.mock('../models/Assignment', () => ({
  find: jest.fn(),
  distinct: jest.fn(),
}));
jest.mock('../models/ScheduleRules');
jest.mock('../services/holidayService', () => ({ listHolidays: jest.fn().mockResolvedValue([]) }));
jest.mock('../services/notificationService', () => ({
  sendShiftChanged: jest.fn().mockResolvedValue(undefined),
  sendSchedulePublished: jest.fn().mockResolvedValue(undefined),
  sendScheduleRevised: jest.fn().mockResolvedValue(2),
}));
jest.mock('../services/scheduleChangeService', () => ({
  recordChange: jest.fn().mockResolvedValue({ _id: 'ev-1' }),
  listChanges: jest.fn().mockResolvedValue([]),
  preparePublish: jest.fn().mockResolvedValue({ version: 1, isRevision: false, added: [], removed: [], affectedPersonIds: [], snapshot: [] }),
}));
jest.mock('../services/fairnessEngine', () => ({
  computeMonthlyFairnessScores: jest.fn(),
}));
jest.mock('../services/conflictService', () => ({
  checkSameDayConflict: jest.fn(),
  checkLeaveConflict: jest.fn(),
}));
jest.mock('../services/assignmentSyncService', () => ({
  replaceAssignmentsForSchedule: jest.fn(),
  removeAssignment: jest.fn(),
}));
jest.mock('../services/undoService', () => ({
  captureMonthlyScheduleSnapshot: jest.fn(() => ({})),
  recordUndoableOperation: jest.fn().mockResolvedValue({ _id: 'op-1' }),
}));
// Yayın öncesi risk hesabının DB bağımlılıkları
jest.mock('../services/scheduler/staffResolver', () => ({ resolveStaff: jest.fn() }));
jest.mock('../services/scheduler/ruleResolver', () => ({
  fetchDutyRules: jest.fn().mockResolvedValue({ rules: {} }),
  DEFAULT_RULES: {},
  DEFAULT_WEIGHTS: {},
}));
// Kurum kuralları (yetkili kaynak): varsayılan olarak tam tanımlı, sürüm 'kv-test'.
const mockResolvedRules = {
  configured: true, complete: true, missingRequired: [], version: 'kv-test',
  values: { ONE_SHIFT_PER_DAY: true, LEAVE_BLOCK: true, NIGHT_NEXT_DAY_OFF: true, MIN_REST_HOURS: 11, MAX_CONSECUTIVE_DAYS: 6 },
  sources: {}, origin: {}, layers: [{ level: 'genel', revision: 1 }],
};
jest.mock('../services/institutionRules', () => {
  const actual = jest.requireActual('../services/institutionRules');
  return { ...actual, resolveInstitutionRules: jest.fn() };
});
jest.mock('../services/preferenceRequestService', () => ({
  loadPreferencesFromDb: jest.fn().mockResolvedValue({}),
  normalizePreferenceKind: jest.fn((x) => x),
  mergeWantIntoRequests: jest.fn((x) => x),
}));

const MonthlySchedule = require('../models/MonthlySchedule');
const Assignment = require('../models/Assignment');
const { sendSchedulePublished } = require('../services/notificationService');
const { computeMonthlyFairnessScores } = require('../services/fairnessEngine');
const {
  canViewDrafts,
  excludeDraftScopes,
  isDraftSchedule,
} = require('../services/schedulePublicationService');
const schedulesRouter = require('../routes/schedules.routes');
const institutionRules = require('../services/institutionRules');

const HOSPITAL_ID = 'hospital-1';
const SCOPE = { sectionId: 'calisma-cizelgesi', serviceId: 'acil', role: 'Nurse', year: 2026, month: 12 };

const lean = (value) => ({ lean: jest.fn().mockResolvedValue(value) });
const selectLean = (value) => ({ select: jest.fn(() => lean(value)), lean: jest.fn().mockResolvedValue(value) });

function handlersFor(method, path) {
  const layer = schedulesRouter.stack.find((l) => l.route?.path === path && l.route?.methods?.[method]);
  if (!layer) throw new Error(`route not found: ${method} ${path}`);
  return layer.route.stack.map((l) => l.handle);
}

function call(method, path, { user, query = {}, body = {} }) {
  const handlers = handlersFor(method, path);
  const req = {
    method: method.toUpperCase(),
    query,
    body,
    params: {},
    user,
    hospitalId: HOSPITAL_ID,
  };
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ status: this.statusCode, body: payload }); return this; },
    };
    const run = (i) => {
      if (i >= handlers.length) return reject(new Error('no response'));
      try {
        const r = handlers[i](req, res, (err) => (err ? reject(err) : run(i + 1)));
        if (r && typeof r.catch === 'function') r.catch(reject);
      } catch (e) { reject(e); }
    };
    run(0);
  });
}

const STAFF = { uid: 'u-1', role: 'user', personId: 'p-1', name: 'Ayşe' };
const PLANNER = { uid: 'admin-1', role: 'admin', name: 'Sorumlu' };

const draftDoc = {
  _id: 'sched-1',
  hospitalId: HOSPITAL_ID,
  ...SCOPE,
  data: { assignments: [{ personId: 'p-1', personName: 'Ayşe', date: '2026-12-01', shiftCode: 'N' }] },
  publication: { status: 'draft' },
};

describe('schedulePublicationService', () => {
  test('eski kayıt (publication yok) taslak sayılmaz', () => {
    expect(isDraftSchedule({ data: {} })).toBe(false);
    expect(isDraftSchedule(null)).toBe(false);
    expect(isDraftSchedule({ publication: { status: 'published' } })).toBe(false);
    expect(isDraftSchedule({ publication: { status: 'draft' } })).toBe(true);
  });

  test('taslağı sadece yöneten roller görür', () => {
    expect(canViewDrafts({ role: 'user' })).toBe(false);
    expect(canViewDrafts({ role: 'standard' })).toBe(false);
    expect(canViewDrafts(null)).toBe(false);
    for (const role of ['admin', 'manager', 'authorized', 'staff', 'ADMIN']) {
      expect(canViewDrafts({ role })).toBe(true);
    }
  });

  test('excludeDraftScopes taslak kapsamlarını $nor ile dışlar, girdiyi değiştirmez', () => {
    const q = { personId: 'p-1' };
    expect(excludeDraftScopes(q, [])).toBe(q);
    const out = excludeDraftScopes(q, [{ sectionId: 's', serviceId: 'acil', role: 'Nurse' }]);
    expect(out).toEqual({ personId: 'p-1', $nor: [{ sectionId: 's', serviceId: 'acil', role: 'Nurse' }] });
    expect(q).toEqual({ personId: 'p-1' });
  });
});

describe('GET /monthly taslak görünürlüğü', () => {
  beforeEach(() => jest.clearAllMocks());

  test('personel taslağı göremez', async () => {
    MonthlySchedule.findOne.mockReturnValue(lean(draftDoc));
    const r = await call('get', '/monthly', { user: STAFF, query: { ...SCOPE } });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, schedule: null, issues: [], unpublished: true });
  });

  test('sorumlu taslağı ve yayın durumunu görür', async () => {
    MonthlySchedule.findOne.mockReturnValue(lean(draftDoc));
    const r = await call('get', '/monthly', { user: PLANNER, query: { ...SCOPE } });
    expect(r.status).toBe(200);
    expect(r.body.schedule.publication).toEqual({ status: 'draft' });
    expect(r.body.schedule.data.assignments).toHaveLength(1);
  });

  test('eski kayıt personele görünmeye devam eder', async () => {
    const { publication, ...legacy } = draftDoc;
    MonthlySchedule.findOne.mockReturnValue(lean(legacy));
    const r = await call('get', '/monthly', { user: STAFF, query: { ...SCOPE } });
    expect(r.body.schedule).not.toBeNull();
    expect(r.body.schedule.publication).toMatchObject({ status: 'published', legacy: true });
  });
});

describe('Personel takvimi (Assignment okumaları)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('person-calendar taslak kapsamı dışlar', async () => {
    MonthlySchedule.find.mockReturnValue(selectLean([{ ...SCOPE }]));
    Assignment.find.mockReturnValue({ sort: () => lean([]) });

    const r = await call('get', '/person-calendar', {
      user: STAFF,
      query: { personId: 'p-1', year: '2026', month: '12', sectionId: SCOPE.sectionId },
    });

    expect(r.status).toBe(200);
    expect(MonthlySchedule.find).toHaveBeenCalledWith(expect.objectContaining({
      hospitalId: HOSPITAL_ID, year: 2026, month: 12, 'publication.status': 'draft',
    }));
    expect(Assignment.find.mock.calls[0][0].$nor).toEqual([
      { sectionId: SCOPE.sectionId, serviceId: 'acil', role: 'Nurse' },
    ]);
  });

  test('sorumlu person-calendar okurken taslak filtresi uygulanmaz', async () => {
    Assignment.find.mockReturnValue({ sort: () => lean([]) });
    await call('get', '/person-calendar', {
      user: PLANNER,
      query: { personId: 'p-1', year: '2026', month: '12' },
    });
    expect(MonthlySchedule.find).not.toHaveBeenCalled();
    expect(Assignment.find.mock.calls[0][0].$nor).toBeUndefined();
  });

  test('/assignments (personel) taslak kapsamı dışlar', async () => {
    MonthlySchedule.find.mockReturnValue(selectLean([{ ...SCOPE }]));
    Assignment.find.mockReturnValue(lean([]));
    await call('get', '/assignments', {
      user: STAFF,
      query: { sectionId: SCOPE.sectionId, year: '2026', month: '12' },
    });
    expect(Assignment.find.mock.calls[0][0]).toMatchObject({ personId: 'p-1' });
    expect(Assignment.find.mock.calls[0][0].$nor).toHaveLength(1);
  });
});

describe('POST /publish', () => {
  const { resolveStaff } = require('../services/scheduler/staffResolver');
  const okPerson = { _id: 'p-1', name: 'Ayşe', meta: { areas: ['KIRMIZI'], shiftCodes: ['N'] } };
  const noAreaPerson = { _id: 'p-9', name: 'Alanı Boş', meta: { areas: [], shiftCodes: ['M'] } };

  beforeEach(() => {
    jest.clearAllMocks();
    resolveStaff.mockResolvedValue({ staff: [okPerson] });
    institutionRules.resolveInstitutionRules.mockResolvedValue(mockResolvedRules);
  });

  test('karara bağlanmamış risk varken yayın engellenir (RISKS_PENDING)', async () => {
    resolveStaff.mockResolvedValue({ staff: [okPerson, noAreaPerson] });
    MonthlySchedule.findOne.mockReturnValue(selectLean({ _id: 'sched-1', ...SCOPE, data: {}, publication: { status: 'draft' }, ruleContext: { version: 'kv-test' } }));

    const r = await call('post', '/publish', { user: PLANNER, body: { ...SCOPE } });

    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ ok: false, code: 'RISKS_PENDING', pending: 1 });
    expect(r.body.risks[0]).toMatchObject({ key: 'VERI_EKSIGI|p-9', type: 'VERI_EKSIGI' });
    expect(MonthlySchedule.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test('"Bu şekilde devam" kararı verilen risk yayını engellemez', async () => {
    resolveStaff.mockResolvedValue({ staff: [okPerson, noAreaPerson] });
    MonthlySchedule.findOne.mockReturnValue(selectLean({
      _id: 'sched-1', ...SCOPE, data: {}, publication: { status: 'draft' }, ruleContext: { version: 'kv-test' },
      riskAcks: { 'VERI_EKSIGI|p-9': { by: 'admin-1', at: new Date() } },
    }));
    MonthlySchedule.findOneAndUpdate.mockReturnValue(lean({ _id: 'sched-1', publication: { status: 'published' } }));
    Assignment.distinct.mockResolvedValue([]);
    computeMonthlyFairnessScores.mockResolvedValue({ people: [] });

    const r = await call('post', '/publish', { user: PLANNER, body: { ...SCOPE } });
    expect(r.status).toBe(200);
  });

  test('POST /risks/ack kararı kaydeder; personel karar veremez', async () => {
    MonthlySchedule.findOne.mockReturnValue(selectLean({ _id: 'sched-1', riskAcks: { 'eski|k': { by: 'x' } } }));
    const r = await call('post', '/risks/ack', { user: PLANNER, body: { ...SCOPE, keys: ['BOS_SLOT|2026-12-05|r1'], note: 'kadro yok' } });
    expect(r.status).toBe(200);
    const [filter, update] = MonthlySchedule.updateOne.mock.calls[0];
    expect(filter).toEqual({ _id: 'sched-1' });
    expect(Object.keys(update.$set.riskAcks).sort()).toEqual(['BOS_SLOT|2026-12-05|r1', 'eski|k']);
    expect(update.$set.riskAcks['BOS_SLOT|2026-12-05|r1']).toMatchObject({ by: 'admin-1', note: 'kadro yok' });

    const denied = await call('post', '/risks/ack', { user: STAFF, body: { ...SCOPE, keys: ['x'] } });
    expect(denied.status).toBe(403);
  });

  test('GET /risks: sorumlu riskleri görür, personel göremez', async () => {
    resolveStaff.mockResolvedValue({ staff: [okPerson, noAreaPerson] });
    MonthlySchedule.findOne.mockReturnValue(selectLean({ _id: 'sched-1', ...SCOPE, data: {} }));
    const r = await call('get', '/risks', { user: PLANNER, query: { ...SCOPE } });
    expect(r.body).toMatchObject({ ok: true, total: 1, pending: 1 });
    expect(r.body.context).toBeUndefined();
    expect(r.body.doc).toBeUndefined();
    const denied = await call('get', '/risks', { user: STAFF, query: { ...SCOPE } });
    expect(denied.status).toBe(403);
  });

  test('yayınlar ve sadece bu çizelgedeki kişilere bildirim gönderir', async () => {
    MonthlySchedule.findOne.mockReturnValue(selectLean({ _id: 'sched-1', ...SCOPE, data: {}, publication: { status: 'draft' }, ruleContext: { version: 'kv-test' } }));
    MonthlySchedule.findOneAndUpdate.mockReturnValue(lean({ _id: 'sched-1', publication: { status: 'published' } }));
    Assignment.distinct.mockResolvedValue(['p-1']);
    computeMonthlyFairnessScores.mockResolvedValue({
      people: [{ personId: 'p-1', fairnessScore: 90 }, { personId: 'p-other-service', fairnessScore: 70 }],
    });

    const r = await call('post', '/publish', { user: PLANNER, body: { ...SCOPE } });

    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, publication: { status: 'published' }, notified: 1 });
    const update = MonthlySchedule.findOneAndUpdate.mock.calls[0][1];
    expect(update.$set.publication).toMatchObject({ status: 'published', publishedBy: 'admin-1' });
    expect(sendSchedulePublished).toHaveBeenCalledWith(expect.objectContaining({
      people: [{ personId: 'p-1', fairnessScore: 90 }],
    }));
  });

  test('içerik değişmediyse tekrar yayın: yeniden yayın ve bildirim yok', async () => {
    const { sendScheduleRevised } = require('../services/notificationService');
    MonthlySchedule.findOne.mockReturnValue(selectLean({ _id: 'sched-1', ...SCOPE, data: {}, revision: 7,
      publication: { status: 'published', contentRevision: 7, version: 2 }, ruleContext: { version: 'kv-test' } }));
    const r = await call('post', '/publish', { user: PLANNER, body: { ...SCOPE } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ alreadyPublished: true, notified: 0 });
    expect(MonthlySchedule.findOneAndUpdate).not.toHaveBeenCalled();
    expect(sendSchedulePublished).not.toHaveBeenCalled();
    expect(sendScheduleRevised).not.toHaveBeenCalled();
  });

  test('yayından sonra değişen plan yeni sürüm olarak yayınlanır; yalnız etkilenenlere bildirim', async () => {
    const scheduleChanges = require('../services/scheduleChangeService');
    const { sendScheduleRevised } = require('../services/notificationService');
    scheduleChanges.preparePublish.mockResolvedValueOnce({
      version: 3, isRevision: true, previousVersion: 2,
      added: [{ date: '2026-12-05', personId: 'p-1', shiftCode: 'N' }], removed: [{ date: '2026-12-05', personId: 'p-2' }],
      affectedPersonIds: ['p-1', 'p-2'], snapshot: ['k'],
    });
    MonthlySchedule.findOne.mockReturnValue(selectLean({ _id: 'sched-1', ...SCOPE, data: {}, revision: 9,
      publication: { status: 'published', contentRevision: 7, version: 2 }, ruleContext: { version: 'kv-test' } }));
    MonthlySchedule.findOneAndUpdate.mockReturnValue(lean({ _id: 'sched-1', publication: { status: 'published', version: 3, contentRevision: 9 } }));
    const r = await call('post', '/publish', { user: PLANNER, body: { ...SCOPE } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ version: 3, notified: 2, revision: { previousVersion: 2, added: 1, removed: 1, affected: 2 } });
    expect(MonthlySchedule.findOneAndUpdate.mock.calls[0][1].$set.publication).toMatchObject({ contentRevision: 9, version: 3 });
    expect(sendScheduleRevised).toHaveBeenCalledWith(expect.objectContaining({ version: 3 }));
    expect(sendSchedulePublished).not.toHaveBeenCalled();
  });

  test('revizyon numarası değişti ama görevler son yayınla aynı: yeni sürüm, geçmiş kaydı ve bildirim yok', async () => {
    const scheduleChanges = require('../services/scheduleChangeService');
    const { sendScheduleRevised } = require('../services/notificationService');
    scheduleChanges.preparePublish.mockResolvedValueOnce({
      version: 3, isRevision: true, previousVersion: 2, added: [], removed: [], affectedPersonIds: [], snapshot: ['k'],
    });
    MonthlySchedule.findOne.mockReturnValue(selectLean({ _id: 'sched-1', ...SCOPE, data: {}, revision: 9,
      publication: { status: 'published', contentRevision: 7, version: 2, publishedBy: 'ilk' }, ruleContext: { version: 'kv-test' } }));
    MonthlySchedule.findOneAndUpdate.mockReturnValue(lean({ _id: 'sched-1', publication: { status: 'published', version: 2, contentRevision: 9 } }));
    const r = await call('post', '/publish', { user: PLANNER, body: { ...SCOPE } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ alreadyPublished: true, unchanged: true, notified: 0, version: 2 });
    expect(scheduleChanges.recordChange).not.toHaveBeenCalled();
    // Yayın kimliği korunur: yalnız içerik revizyonu güncellenir
    expect(MonthlySchedule.findOneAndUpdate.mock.calls[0][1]).toEqual({ $set: { 'publication.contentRevision': 9 } });
    expect(sendScheduleRevised).not.toHaveBeenCalled();
    expect(sendSchedulePublished).not.toHaveBeenCalled();
  });

  test('bildirim gönderimi hata verirse yayın yine tamamlanır; bildirim sayısı 0 döner', async () => {
    MonthlySchedule.findOne.mockReturnValue(selectLean({ _id: 'sched-1', ...SCOPE, data: {}, publication: { status: 'draft' }, ruleContext: { version: 'kv-test' } }));
    MonthlySchedule.findOneAndUpdate.mockReturnValue(lean({ _id: 'sched-1', publication: { status: 'published', version: 1 } }));
    Assignment.distinct.mockResolvedValue(['p-1']);
    computeMonthlyFairnessScores.mockResolvedValue({ people: [{ personId: 'p-1', fairnessScore: 90 }] });
    sendSchedulePublished.mockRejectedValueOnce(new Error('posta sunucusu yanıt vermiyor'));
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const r = await call('post', '/publish', { user: PLANNER, body: { ...SCOPE } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, publication: { status: 'published' }, notified: 0, version: 1 });
    expect(errSpy.mock.calls.some((c) => String(c.join(' ')).includes('bildirim'))).toBe(true);
    errSpy.mockRestore();
  });

  test('çizelge yoksa 404', async () => {
    MonthlySchedule.findOne.mockReturnValue(selectLean(null));
    const r = await call('post', '/publish', { user: PLANNER, body: { ...SCOPE } });
    expect(r.status).toBe(404);
    expect(MonthlySchedule.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test('personel yayınlayamaz', async () => {
    const r = await call('post', '/publish', { user: STAFF, body: { ...SCOPE } });
    expect(r.status).toBe(403);
    expect(MonthlySchedule.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test('kural sürümü bilinmeyen (eski) plan yayınlanmaz: RULE_VERSION_UNKNOWN', async () => {
    MonthlySchedule.findOne.mockReturnValue(selectLean({ _id: 'sched-1', ...SCOPE, data: {}, publication: { status: 'draft' } }));
    const r = await call('post', '/publish', { user: PLANNER, body: { ...SCOPE } });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ ok: false, code: 'RULE_VERSION_UNKNOWN', rules: { status: 'unknown', currentVersion: 'kv-test' } });
    expect(MonthlySchedule.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test('kurallar plan sonrası değiştiyse yayın durur: RULE_VERSION_CONFLICT', async () => {
    MonthlySchedule.findOne.mockReturnValue(selectLean({ _id: 'sched-1', ...SCOPE, data: {}, publication: { status: 'draft' }, ruleContext: { version: 'kv-eski' } }));
    const r = await call('post', '/publish', { user: PLANNER, body: { ...SCOPE } });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: 'RULE_VERSION_CONFLICT', rules: { status: 'outdated', planVersion: 'kv-eski', currentVersion: 'kv-test' } });
  });

  test('zorunlu kural eksikse yayın açıklayıcı 422 döner', async () => {
    institutionRules.resolveInstitutionRules.mockResolvedValue({ ...mockResolvedRules, complete: false, missingRequired: ['MIN_REST_HOURS'] });
    MonthlySchedule.findOne.mockReturnValue(selectLean({ _id: 'sched-1', ...SCOPE, data: {}, publication: { status: 'draft' }, ruleContext: { version: 'kv-test' } }));
    const r = await call('post', '/publish', { user: PLANNER, body: { ...SCOPE } });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('RULES_INCOMPLETE');
    expect(r.body.message).toMatch(/İki vardiya arası en az dinlenme/);
  });
});
