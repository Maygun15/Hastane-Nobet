'use strict';

jest.mock('../models/MonthlySchedule');
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
  removeAssignment: jest.fn(),
}));
jest.mock('../services/monthlyTemplateCarryForwardService', () => ({
  carryForwardMonthlyTemplate: jest.fn(),
}));

const {
  carryForwardMonthlyTemplate,
} = require('../services/monthlyTemplateCarryForwardService');
const schedulesRouter = require('../routes/schedules.routes');

const BASE_BODY = {
  sectionId: 'calisma-cizelgesi',
  serviceId: 'service-a',
  role: 'Nurse',
  year: 2026,
  month: 6,
};

function getHandlers() {
  const layer = schedulesRouter.stack.find(
    (item) => item.route?.path === '/monthly/carry-forward-template' && item.route?.methods?.post
  );
  return layer.route.stack.map((item) => item.handle);
}

async function callRoute({ body = BASE_BODY, role = 'admin', user = true } = {}) {
  const req = {
    method: 'POST',
    body: { ...body, hospitalId: 'untrusted-body-hospital' },
    query: {},
    params: {},
    hospitalId: 'tenant-hospital',
    ...(user ? { user: { uid: 'user-1', role, serviceIds: ['service-a'] } } : {}),
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
    const handlers = getHandlers();
    const run = (index) => {
      if (index >= handlers.length) {
        reject(new Error('route completed without a response'));
        return;
      }
      Promise.resolve(handlers[index](req, res, (err) => {
        if (err) reject(err);
        else run(index + 1);
      })).catch(reject);
    };
    run(0);
  });
}

describe('POST /api/schedules/monthly/carry-forward-template', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    carryForwardMonthlyTemplate.mockResolvedValue({
      carried: true,
      from: { year: 2026, month: 5 },
      to: { year: 2026, month: 6 },
      defsCount: 41,
      assignmentsCopied: 0,
    });
  });

  test('uses authenticated tenant scope and reaches carry-forward for admin', async () => {
    const result = await callRoute();

    expect(result).toEqual({
      status: 200,
      body: {
        ok: true,
        carried: true,
        from: { year: 2026, month: 5 },
        to: { year: 2026, month: 6 },
        defsCount: 41,
        assignmentsCopied: 0,
      },
    });
    expect(carryForwardMonthlyTemplate).toHaveBeenCalledWith({
      hospitalId: 'tenant-hospital',
      sectionId: 'calisma-cizelgesi',
      serviceId: 'service-a',
      role: 'Nurse',
      year: 2026,
      month: 6,
      userId: 'user-1',
    });
  });

  test.each(['', 'all', 'All Services', 'Tümü', 'Tüm Servisler'])(
    'rejects non-specific service %p before carry-forward',
    async (serviceId) => {
      const result = await callRoute({ body: { ...BASE_BODY, serviceId } });
      expect(result.status).toBe(400);
      expect(result.body.code).toBe('SPECIFIC_SERVICE_REQUIRED');
      expect(carryForwardMonthlyTemplate).not.toHaveBeenCalled();
    }
  );

  test.each(['', 'all', 'All Roles', 'Tümü', 'Tüm Roller'])(
    'rejects non-specific role %p before carry-forward',
    async (scopeRole) => {
      const result = await callRoute({ body: { ...BASE_BODY, role: scopeRole } });
      expect(result).toEqual({
        status: 400,
        body: {
          ok: false,
          code: 'SPECIFIC_ROLE_REQUIRED',
          message: 'A specific role must be selected before carrying schedule templates forward.',
        },
      });
      expect(carryForwardMonthlyTemplate).not.toHaveBeenCalled();
    }
  );

  test('rejects user role before carry-forward', async () => {
    const result = await callRoute({ role: 'user' });
    expect(result.status).toBe(403);
    expect(carryForwardMonthlyTemplate).not.toHaveBeenCalled();
  });

  test('preserves unauthenticated behavior', async () => {
    const result = await callRoute({ user: false });
    expect(result).toEqual({
      status: 401,
      body: { error: 'Auth gerekli' },
    });
    expect(carryForwardMonthlyTemplate).not.toHaveBeenCalled();
  });

  test('maps missing previous template to stable 404 response', async () => {
    const error = new Error('Önceki ay için taşınabilecek çizelge şablonu bulunamadı.');
    error.code = 'PREVIOUS_TEMPLATE_NOT_FOUND';
    error.status = 404;
    carryForwardMonthlyTemplate.mockRejectedValue(error);

    const result = await callRoute();

    expect(result).toEqual({
      status: 404,
      body: {
        ok: false,
        code: 'PREVIOUS_TEMPLATE_NOT_FOUND',
        message: 'Önceki ay için taşınabilecek çizelge şablonu bulunamadı.',
      },
    });
  });
});
