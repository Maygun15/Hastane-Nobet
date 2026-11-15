'use strict';

jest.mock('../models/Setting', () => ({
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
}));
jest.mock('../services/leavesV2SettingsService', () => ({
  CONFLICT_CODE: 'LEAVESV2_SETTINGS_CONFLICT',
  CONFLICT_MESSAGE: 'Leave settings could not be saved because the settings document scope is inconsistent.',
  findLeavesV2Doc: jest.fn(),
  saveLeavesV2Value: jest.fn(),
}));

const Setting = require('../models/Setting');
const {
  saveLeavesV2Value,
} = require('../services/leavesV2SettingsService');
const settingsRouter = require('../routes/settings.routes');

function queryResult(value) {
  return { lean: jest.fn().mockResolvedValue(value) };
}

function getPutHandlers() {
  const layer = settingsRouter.stack.find((item) => item.route?.path === '/:key' && item.route?.methods?.put);
  return layer.route.stack.map((item) => item.handle);
}

async function callPut({ key = 'leavesV2', body = {}, role = 'admin' } = {}) {
  const req = {
    method: 'PUT',
    params: { key },
    body: {
      value: { p1: {} },
      serviceId: '',
      ...body,
    },
    query: {},
    user: { uid: 'user-1', role },
    hospitalId: 'hospital-a',
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

    const handlers = getPutHandlers();
    const run = (index) => {
      if (index >= handlers.length) {
        reject(new Error('route completed without response'));
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

describe('PUT /api/settings/:key leavesV2 containment', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    saveLeavesV2Value.mockResolvedValue({
      key: 'leavesV2',
      serviceId: '',
      value: { p1: {} },
      updatedAt: '2026-06-22T10:00:00.000Z',
      createdAt: '2026-06-22T09:00:00.000Z',
    });
  });

  test('PUT /api/settings/leavesV2 uses safe leavesV2 save helper', async () => {
    const result = await callPut();

    expect(result).toEqual({
      status: 200,
      body: {
        ok: true,
        key: 'leavesV2',
        serviceId: '',
        value: { p1: {} },
        updatedAt: '2026-06-22T10:00:00.000Z',
        createdAt: '2026-06-22T09:00:00.000Z',
      },
    });
    expect(saveLeavesV2Value).toHaveBeenCalledWith(
      expect.objectContaining({ hospitalId: 'hospital-a' }),
      '',
      { p1: {} }
    );
  });

  test('PUT /api/settings/leavesV2 returns structured conflict instead of raw duplicate key', async () => {
    saveLeavesV2Value.mockRejectedValue(Object.assign(new Error('E11000 duplicate key error'), {
      code: 'LEAVESV2_SETTINGS_CONFLICT',
      status: 409,
    }));

    const result = await callPut();

    expect(result).toEqual({
      status: 409,
      body: {
        ok: false,
        code: 'LEAVESV2_SETTINGS_CONFLICT',
        message: 'Leave settings could not be saved because the settings document scope is inconsistent.',
      },
    });
    expect(JSON.stringify(result.body)).not.toMatch(/E11000|duplicate key/i);
  });

  test('leaveTypes settings continue to use the generic settings path', async () => {
    Setting.findOneAndUpdate.mockReturnValueOnce(queryResult({
      key: 'leaveTypes',
      serviceId: '',
      value: [{ code: 'Y', name: 'Yıllık İzin' }],
      updatedAt: '2026-06-22T10:00:00.000Z',
      createdAt: '2026-06-22T09:00:00.000Z',
    }));

    const result = await callPut({
      key: 'leaveTypes',
      body: { value: [{ code: 'Y', name: 'Yıllık İzin' }], serviceId: '' },
    });

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      key: 'leaveTypes',
      serviceId: '',
      value: [{ code: 'Y', name: 'Yıllık İzin' }],
    });
    expect(saveLeavesV2Value).not.toHaveBeenCalled();
  });
});
