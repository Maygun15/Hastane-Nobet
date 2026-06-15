'use strict';

jest.mock('../models/MonthlySchedule', () => ({
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
}));
jest.mock('../models/Assignment');
jest.mock('../models/ScheduleRules');
jest.mock('../services/holidayService', () => ({ listHolidays: jest.fn().mockResolvedValue([]) }));
jest.mock('../services/notificationService', () => ({
  sendShiftChanged: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/conflictService', () => ({
  checkSameDayConflict: jest.fn(),
  checkLeaveConflict: jest.fn(),
}));
jest.mock('../services/assignmentSyncService', () => ({
  replaceAssignmentsForSchedule: jest.fn(),
  removeAssignment: jest.fn().mockResolvedValue({ deletedCount: 1 }),
}));

const MonthlySchedule = require('../models/MonthlySchedule');
const { sendShiftChanged } = require('../services/notificationService');
const { removeAssignment } = require('../services/assignmentSyncService');
const schedulesRouter = require('../routes/schedules.routes');

const HOSPITAL_ID = 'hospital-1';
const BASE_BODY = {
  sectionId: 'calisma-cizelgesi',
  serviceId: 'service-a',
  role: 'Nurse',
  date: '2026-06-10',
  shiftId: 'N',
  shiftCode: 'N',
  personId: 'person-1',
  personName: 'Test Person',
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function matches(doc, query) {
  return Object.entries(query).every(([key, value]) => String(doc?.[key] ?? '') === String(value ?? ''));
}

function configureScheduleStore(seedDocs) {
  const docs = seedDocs.map(clone);

  MonthlySchedule.findOne.mockImplementation((query) => ({
    lean: jest.fn().mockResolvedValue(clone(docs.find((doc) => matches(doc, query)) || null)),
  }));

  MonthlySchedule.findOneAndUpdate.mockImplementation((query, update) => ({
    lean: jest.fn().mockImplementation(async () => {
      const doc = docs.find((item) => matches(item, query));
      if (!doc) return null;
      Object.assign(doc, clone(update?.$set || {}), { updatedAt: '2026-06-10T12:00:00.000Z' });
      return clone(doc);
    }),
  }));

  return docs;
}

function getDeleteHandlers() {
  const layer = schedulesRouter.stack.find(
    (item) => item.route?.path === '/assign' && item.route?.methods?.delete
  );
  return layer.route.stack.map((item) => item.handle);
}

async function deleteAssignment(body = BASE_BODY) {
  const handlers = getDeleteHandlers();
  const req = {
    method: 'DELETE',
    body: clone(body),
    query: {},
    params: {},
    user: { uid: 'admin-1', role: 'admin', name: 'Admin' },
    hospitalId: HOSPITAL_ID,
  };

  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        resolve({ status: this.statusCode, body: payload });
        return this;
      },
    };

    const run = (index) => {
      if (index >= handlers.length) {
        reject(new Error('DELETE route completed without a response'));
        return;
      }
      try {
        const result = handlers[index](req, res, (error) => {
          if (error) reject(error);
          else run(index + 1);
        });
        if (result && typeof result.catch === 'function') result.catch(reject);
      } catch (error) {
        reject(error);
      }
    };

    run(0);
  });
}

describe('DELETE /api/schedules/assign exact scope', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('deletes only the exact service and role assignment', async () => {
    const docs = configureScheduleStore([
      {
        _id: 'schedule-a-nurse',
        hospitalId: HOSPITAL_ID,
        sectionId: BASE_BODY.sectionId,
        serviceId: 'service-a',
        role: 'Nurse',
        year: 2026,
        month: 6,
        data: { assignments: [{ ...BASE_BODY }] },
      },
      {
        _id: 'schedule-b-nurse',
        hospitalId: HOSPITAL_ID,
        sectionId: BASE_BODY.sectionId,
        serviceId: 'service-b',
        role: 'Nurse',
        year: 2026,
        month: 6,
        data: { assignments: [{ ...BASE_BODY, serviceId: 'service-b' }] },
      },
      {
        _id: 'schedule-empty-service',
        hospitalId: HOSPITAL_ID,
        sectionId: BASE_BODY.sectionId,
        serviceId: '',
        role: 'Nurse',
        year: 2026,
        month: 6,
        data: { assignments: [{ ...BASE_BODY, serviceId: '' }] },
      },
    ]);

    const result = await deleteAssignment();

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, removed: true });
    expect(MonthlySchedule.findOne).toHaveBeenCalledTimes(1);
    expect(MonthlySchedule.findOne).toHaveBeenCalledWith({
      hospitalId: HOSPITAL_ID,
      sectionId: BASE_BODY.sectionId,
      serviceId: 'service-a',
      role: 'Nurse',
      year: 2026,
      month: 6,
    });
    expect(docs.find((doc) => doc._id === 'schedule-a-nurse').data.assignments).toHaveLength(0);
    expect(docs.find((doc) => doc._id === 'schedule-b-nurse').data.assignments).toHaveLength(1);
    expect(docs.find((doc) => doc._id === 'schedule-empty-service').data.assignments).toHaveLength(1);
    expect(removeAssignment).toHaveBeenCalledTimes(1);
    expect(sendShiftChanged).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['wrong role', { role: 'Doctor' }],
    ['wrong service', { serviceId: 'service-b' }],
  ])('%s returns SCHEDULE_NOT_FOUND_IN_SCOPE without side effects', async (_label, override) => {
    configureScheduleStore([
      {
        _id: 'schedule-a-nurse',
        hospitalId: HOSPITAL_ID,
        sectionId: BASE_BODY.sectionId,
        serviceId: 'service-a',
        role: 'Nurse',
        year: 2026,
        month: 6,
        data: { assignments: [{ ...BASE_BODY }] },
      },
    ]);

    const result = await deleteAssignment({ ...BASE_BODY, ...override });

    expect(result).toEqual({
      status: 404,
      body: {
        ok: false,
        code: 'SCHEDULE_NOT_FOUND_IN_SCOPE',
        message: 'No schedule was found in the requested scope.',
      },
    });
    expect(MonthlySchedule.findOneAndUpdate).not.toHaveBeenCalled();
    expect(removeAssignment).not.toHaveBeenCalled();
    expect(sendShiftChanged).not.toHaveBeenCalled();
  });

  test('existing schedule with no matching assignment returns ASSIGNMENT_NOT_FOUND_IN_SCOPE', async () => {
    configureScheduleStore([
      {
        _id: 'schedule-a-nurse',
        hospitalId: HOSPITAL_ID,
        sectionId: BASE_BODY.sectionId,
        serviceId: 'service-a',
        role: 'Nurse',
        year: 2026,
        month: 6,
        data: {
          assignments: [{ ...BASE_BODY, personId: 'other-person', personName: 'Other Person' }],
        },
      },
    ]);

    const result = await deleteAssignment();

    expect(result).toEqual({
      status: 404,
      body: {
        ok: false,
        code: 'ASSIGNMENT_NOT_FOUND_IN_SCOPE',
        message: 'No matching assignment was found in the requested schedule scope.',
      },
    });
    expect(MonthlySchedule.findOneAndUpdate).not.toHaveBeenCalled();
    expect(removeAssignment).not.toHaveBeenCalled();
    expect(sendShiftChanged).not.toHaveBeenCalled();
  });

  test.each([undefined, null, '', '   ', 'all', 'All Roles', 'Tümü', 'Tüm Roller'])(
    'rejects non-specific role %p before querying schedules',
    async (role) => {
      configureScheduleStore([]);
      const body = { ...BASE_BODY };
      if (role === undefined) delete body.role;
      else body.role = role;

      const result = await deleteAssignment(body);

      expect(result).toEqual({
        status: 400,
        body: {
          ok: false,
          code: 'SPECIFIC_ROLE_REQUIRED',
          message: 'A specific role must be selected before deleting assignments.',
        },
      });
      expect(MonthlySchedule.findOne).not.toHaveBeenCalled();
      expect(MonthlySchedule.findOneAndUpdate).not.toHaveBeenCalled();
      expect(removeAssignment).not.toHaveBeenCalled();
      expect(sendShiftChanged).not.toHaveBeenCalled();
    }
  );
});
