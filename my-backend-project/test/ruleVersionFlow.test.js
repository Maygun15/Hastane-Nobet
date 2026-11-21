'use strict';

/**
 * İP-1 — planlama ve kayıt aynı kural kaynağını kullanır.
 *  1) Plan üretimi: istemcinin gönderdiği kural değerleri motora GİTMEZ; sunucu değerleri gider;
 *     kullanılan sürüm + anlık kopya plana yazılır; zorunlu eksikse 422.
 *  2) Kayıt: plan düzenlenirken kural sürümü değiştiyse 409; sürüm bildirmeyen eski istemci kabul.
 *  3) Kural durumu: sürümü olmayan eski plan "unknown".
 */

jest.mock('../models/MonthlySchedule', () => ({
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  updateOne: jest.fn(),
}));
jest.mock('../models/GeneratedSchedule', () => ({ create: jest.fn(), findByIdAndUpdate: jest.fn() }));
jest.mock('../models/Assignment', () => ({ find: jest.fn(), deleteMany: jest.fn() }));
jest.mock('../models/ScheduleRules');
jest.mock('../services/holidayService', () => ({ listHolidays: jest.fn().mockResolvedValue([]) }));
jest.mock('../services/scheduler/inputBuilder', () => ({ buildSchedulerInput: jest.fn() }));
jest.mock('../services/scheduler/holidayPolicyAdapter', () => ({ applyHolidayPolicies: jest.fn(({ days }) => days) }));
jest.mock('../services/scheduler/staffResolver', () => ({ resolveStaff: jest.fn() }));
jest.mock('../services/scheduler', () => ({ generateMonthlyPlan: jest.fn() }));
jest.mock('../services/scheduler/ruleResolver', () => ({
  fetchDutyRules: jest.fn().mockResolvedValue({ doc: null, rules: {}, weights: {} }),
  DEFAULT_RULES: {},
  DEFAULT_WEIGHTS: {},
}));
jest.mock('../services/leavesV2SettingsService', () => ({ loadMergedLeavesV2Value: jest.fn().mockResolvedValue({}) }));
jest.mock('../services/preferenceRequestService', () => ({
  loadPreferencesFromDb: jest.fn().mockResolvedValue({}),
  mergeWantIntoRequests: jest.fn((x) => x),
  normalizePreferenceKind: jest.fn((x) => x),
}));
jest.mock('../services/assignmentSyncService', () => ({ replaceAssignmentsForSchedule: jest.fn(), removeAssignment: jest.fn() }));
jest.mock('../services/notificationService', () => ({ sendShiftChanged: jest.fn() }));
jest.mock('../services/institutionRules', () => {
  const actual = jest.requireActual('../services/institutionRules');
  return { ...actual, resolveInstitutionRules: jest.fn() };
});

const MonthlySchedule = require('../models/MonthlySchedule');
const { buildSchedulerInput } = require('../services/scheduler/inputBuilder');
const { resolveStaff } = require('../services/scheduler/staffResolver');
const { generateMonthlyPlan } = require('../services/scheduler');
const institutionRules = require('../services/institutionRules');
const { generateSchedule } = require('../services/schedulerService');
const schedulesRouter = require('../routes/schedules.routes');

const SERVER = {
  configured: true, complete: true, missingRequired: [], version: 'kv-sunucu1',
  values: { ONE_SHIFT_PER_DAY: true, LEAVE_BLOCK: true, NIGHT_NEXT_DAY_OFF: true, MIN_REST_HOURS: 11, MAX_CONSECUTIVE_DAYS: 6 },
  sources: { MIN_REST_HOURS: 'kurum' }, origin: {}, layers: [{ level: 'genel', revision: 3 }],
};
const SCOPE = { sectionId: 'calisma-cizelgesi', serviceId: 'svc-a', role: 'Nurse', year: 2026, month: 12 };

beforeEach(() => {
  jest.clearAllMocks();
  institutionRules.resolveInstitutionRules.mockResolvedValue(SERVER);
  MonthlySchedule.findOne.mockReturnValue({
    select: () => ({ lean: () => Promise.resolve({ _id: 'sched-1', ...SCOPE, data: { defs: [{ id: 'r1' }] } }) }),
    lean: () => Promise.resolve({ _id: 'sched-1', ...SCOPE, data: { defs: [{ id: 'r1' }] } }),
  });
  buildSchedulerInput.mockReturnValue({
    effectiveDefs: [{ id: 'r1', shiftCode: 'M' }],
    effectiveOverrides: {},
    effectiveShiftOptions: [],
    days: [{ date: '2026-12-01', shifts: [{ id: 'r1', code: 'M', requiredCount: 1, hours: 8 }] }],
    holidayKindByDate: {},
    shiftMetaByCode: {},
  });
  resolveStaff.mockResolvedValue({ staff: [{ id: 'p1', name: 'Ayşe' }] });
  generateMonthlyPlan.mockResolvedValue({ assignments: [], issues: [] });
});

describe('plan üretimi yalnız sunucu kurallarını kullanır', () => {
  test('tarayıcıdan gelen kurallar motora gitmez, fark raporlanır, sürüm plana yazılır', async () => {
    const result = await generateSchedule({
      ...SCOPE,
      hospitalId: 'hospital-1',
      userId: 'u-admin',
      dryRun: true,
      // Eski tarayıcı ayarı: dinlenme kuralını kapatmaya çalışıyor
      payload: { rules: { MIN_REST_HOURS: 0, ONE_SHIFT_PER_DAY: false } },
    });
    const engineRules = generateMonthlyPlan.mock.calls[0][0].rules;
    expect(engineRules).toEqual(SERVER.values);
    expect(result.ignoredClientRules).toEqual([
      { key: 'ONE_SHIFT_PER_DAY', client: false, server: true },
      { key: 'MIN_REST_HOURS', client: 0, server: 11 },
    ]);
    expect(result.ruleContext).toMatchObject({ version: 'kv-sunucu1', mode: 'generated', values: SERVER.values, capturedBy: 'u-admin' });
  });

  test('zorunlu kural eksikse plan üretilmez (RULES_INCOMPLETE, 422)', async () => {
    institutionRules.resolveInstitutionRules.mockResolvedValue({ ...SERVER, complete: false, missingRequired: ['MIN_REST_HOURS'] });
    await expect(generateSchedule({ ...SCOPE, hospitalId: 'hospital-1', dryRun: true, payload: {} }))
      .rejects.toMatchObject({ code: 'RULES_INCOMPLETE', status: 422 });
    expect(generateMonthlyPlan).not.toHaveBeenCalled();
  });

  test('kurum kuralı hiç yoksa RULES_NOT_CONFIGURED', async () => {
    institutionRules.resolveInstitutionRules.mockResolvedValue({ configured: false, complete: false, missingRequired: ['MIN_REST_HOURS'], values: {}, layers: [], version: null });
    await expect(generateSchedule({ ...SCOPE, hospitalId: 'hospital-1', dryRun: true, payload: {} }))
      .rejects.toMatchObject({ code: 'RULES_NOT_CONFIGURED' });
  });
});

function call(method, path, { user, body = {} }) {
  const layer = schedulesRouter.stack.find((l) => l.route?.path === path && l.route.methods[method]);
  const handlers = layer.route.stack.map((x) => x.handle);
  const req = { method: method.toUpperCase(), body, query: {}, params: {}, user, hospitalId: 'hospital-1' };
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(payload) { resolve({ status: this.statusCode, body: payload }); },
    };
    let i = 0;
    const next = (err) => {
      if (err) return reject(err);
      const h = handlers[i++];
      if (!h) return resolve({ status: res.statusCode, body: null });
      return Promise.resolve(h(req, res, next)).catch(reject);
    };
    next();
  });
}

describe('kaydetmede kural sürümü çakışması', () => {
  const ADMIN = { uid: 'u-admin', role: 'admin', serviceIds: [] };
  test('planı eski kural sürümüyle düzenleyen istemci 409 alır, kayıt yapılmaz', async () => {
    const r = await call('put', '/monthly', {
      user: ADMIN,
      body: { ...SCOPE, data: { defs: [{ id: 'r1' }] }, ruleVersion: 'kv-eski' },
    });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({
      code: 'RULE_VERSION_CONFLICT',
      rules: { status: 'outdated', planVersion: 'kv-eski', currentVersion: 'kv-sunucu1' },
    });
    expect(MonthlySchedule.findOneAndUpdate).not.toHaveBeenCalled();
  });
});

describe('kural durumu', () => {
  const { ruleStatusOf } = schedulesRouter;
  test('sürümsüz eski plan "unknown", güncel "current", değişmiş "outdated"', () => {
    expect(ruleStatusOf({}, SERVER).status).toBe('unknown');
    expect(ruleStatusOf({ ruleContext: { version: 'kv-sunucu1' } }, SERVER).status).toBe('current');
    expect(ruleStatusOf({ ruleContext: { version: 'kv-eski' } }, SERVER)).toMatchObject({ status: 'outdated', planVersion: 'kv-eski', currentVersion: 'kv-sunucu1' });
  });
});
