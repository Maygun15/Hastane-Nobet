'use strict';

jest.mock('../services/undoService', () => ({
  assertUndoScope: jest.fn((scope) => ({
    hospitalId: String(scope.hospitalId),
    sectionId: String(scope.sectionId),
    serviceId: String(scope.serviceId),
    role: String(scope.role),
    year: Number(scope.year),
    month: Number(scope.month),
  })),
  listRecentOperations: jest.fn().mockResolvedValue([{ _id: 'op-1', operationType: 'MANUAL_ASSIGNMENT_ADD', undoStatus: 'available', reversible: true }]),
  undoOperation: jest.fn().mockResolvedValue({
    operation: {
      _id: 'op-1',
      sectionId: 'calisma-cizelgesi',
      serviceId: 'service-a',
      role: 'Nurse',
      year: 2026,
      month: 6,
    },
    schedule: { _id: 'schedule-1' },
  }),
}));

const undoService = require('../services/undoService');
const undoRouter = require('../routes/undo.routes');

function getHandlers(path, method) {
  const layer = undoRouter.stack.find((item) => item.route?.path === path && item.route?.methods?.[method]);
  return layer.route.stack.map((item) => item.handle);
}

async function runRoute(handlers, { user = { uid: 'u1', role: 'admin' }, query = {}, params = {}, body = {}, hospitalId = 'hospital-1' } = {}) {
  const req = { user, query, params, body, hospitalId };
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
      if (index >= handlers.length) return reject(new Error('route completed without response'));
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

describe('/api/undo routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('GET /recent rejects non-privileged user', async () => {
    const result = await runRoute(getHandlers('/recent', 'get'), {
      user: { uid: 'u1', role: 'user' },
    });

    expect(result.status).toBe(403);
    expect(result.body).toEqual({ ok: false, code: 'FORBIDDEN', message: 'Bu işlem için yetkiniz yok.' });
    expect(undoService.listRecentOperations).not.toHaveBeenCalled();
  });

  test('GET /recent requires exact scope and returns safe operation list', async () => {
    const result = await runRoute(getHandlers('/recent', 'get'), {
      query: {
        sectionId: 'calisma-cizelgesi',
        serviceId: 'service-a',
        role: 'Nurse',
        year: '2026',
        month: '6',
      },
    });

    expect(result.status).toBe(200);
    expect(result.body.operations[0]).toMatchObject({ id: 'op-1', operationType: 'MANUAL_ASSIGNMENT_ADD' });
    expect(result.body.operations[0].beforeSnapshot).toBeUndefined();
    expect(undoService.assertUndoScope).toHaveBeenCalled();
  });

  test('POST /:operationId calls undo service for admin', async () => {
    const result = await runRoute(getHandlers('/:operationId', 'post'), {
      params: { operationId: 'op-1' },
      body: { reason: 'test' },
    });

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, undone: true, scheduleId: 'schedule-1' });
    expect(undoService.undoOperation).toHaveBeenCalledWith('op-1', expect.objectContaining({
      hospitalId: 'hospital-1',
      reason: 'test',
    }));
  });
});
