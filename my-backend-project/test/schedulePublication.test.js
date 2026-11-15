'use strict';

// Taslak / yayınlandı: personel ('user') taslak çizelgeyi göremez; sorumlu görür.
// Yayınla → durum 'published' + sadece o çizelgedeki kişilere bildirim.

jest.mock('../models/MonthlySchedule', () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
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
  beforeEach(() => jest.clearAllMocks());

  test('yayınlar ve sadece bu çizelgedeki kişilere bildirim gönderir', async () => {
    MonthlySchedule.findOne.mockReturnValue(selectLean({ _id: 'sched-1', publication: { status: 'draft' } }));
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
});
