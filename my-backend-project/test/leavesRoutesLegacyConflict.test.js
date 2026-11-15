'use strict';

jest.mock('../models/Setting', () => ({
  findOne: jest.fn(),
}));
jest.mock('../models/Person', () => ({
  findOne: jest.fn(),
}));
jest.mock('../models/Assignment', () => ({
  deleteMany: jest.fn(),
}));
jest.mock('../models/LeaveBalance', () => ({
  findOneAndUpdate: jest.fn(),
  updateOne: jest.fn(),
}));
jest.mock('../models/LeaveType', () => ({
  findOne: jest.fn(),
}));
jest.mock('../services/validation.service', () => ({
  checkConflict: jest.fn(),
}));
jest.mock('../services/leavesV2SettingsService', () => ({
  CONFLICT_CODE: 'LEAVESV2_SETTINGS_CONFLICT',
  CONFLICT_MESSAGE: 'Leave settings could not be saved because the settings document scope is inconsistent.',
  findLeavesV2Doc: jest.fn(),
  saveLeavesV2Value: jest.fn(),
}));

const Person = require('../models/Person');
const Assignment = require('../models/Assignment');
const LeaveType = require('../models/LeaveType');
const { checkConflict } = require('../services/validation.service');
const {
  findLeavesV2Doc,
  saveLeavesV2Value,
} = require('../services/leavesV2SettingsService');
const leavesRouter = require('../routes/leaves.routes');

function queryResult(value) {
  return { lean: jest.fn().mockResolvedValue(value) };
}

function getPutHandler() {
  const layer = leavesRouter.stack.find((item) => item.route?.path === '/' && item.route?.methods?.put);
  return layer.route.stack.at(-1).handle;
}

async function callPut({ body = {}, user = { uid: 'user-1', role: 'admin' } } = {}) {
  const req = {
    body: {
      personId: 'person-1',
      year: 2026,
      month: 6,
      day: 12,
      code: 'Y',
      ...body,
    },
    query: {},
    params: {},
    user,
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

    Promise.resolve(getPutHandler()(req, res, (err) => {
      if (err) reject(err);
      else reject(new Error('route called next without response'));
    })).catch(reject);
  });
}

describe('PUT /api/leaves legacy leavesV2 containment', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Person.findOne.mockReturnValue(queryResult({ _id: 'person-1', name: 'Person One' }));
    LeaveType.findOne.mockReturnValue(queryResult(null));
    checkConflict.mockResolvedValue([]);
    findLeavesV2Doc.mockResolvedValue({
      _id: 'legacy-1',
      key: 'leavesV2',
      serviceId: '',
      hospitalId: null,
      value: {},
    });
    saveLeavesV2Value.mockResolvedValue({
      _id: 'legacy-1',
      key: 'leavesV2',
      serviceId: '',
      hospitalId: null,
      value: {},
    });
    Assignment.deleteMany.mockResolvedValue({ deletedCount: 1 });
  });

  test('does not expose raw E11000 when leavesV2 recovery fails', async () => {
    saveLeavesV2Value.mockRejectedValue(Object.assign(
      new Error('Leave settings could not be saved because the settings document scope is inconsistent.'),
      { code: 'LEAVESV2_SETTINGS_CONFLICT', status: 409 }
    ));

    const result = await callPut({ body: { force: true } });

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

  test('force:true does not delete assignments when leavesV2 save fails', async () => {
    saveLeavesV2Value.mockRejectedValue(Object.assign(new Error('scope conflict'), {
      code: 'LEAVESV2_SETTINGS_CONFLICT',
      status: 409,
    }));

    await callPut({ body: { force: true } });

    expect(Assignment.deleteMany).not.toHaveBeenCalled();
  });

  test('force:true deletes assignments only after leavesV2 save succeeds', async () => {
    const order = [];
    saveLeavesV2Value.mockImplementation(async () => {
      order.push('save');
      return { key: 'leavesV2', value: {} };
    });
    Assignment.deleteMany.mockImplementation(async () => {
      order.push('delete');
      return { deletedCount: 1 };
    });

    const result = await callPut({ body: { force: true } });

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, key: 'leavesV2', forced: true });
    expect(order).toEqual(['save', 'delete']);
  });

  test('serviceId empty normalization remains unchanged for save', async () => {
    await callPut({ body: { serviceId: 'other-service' } });

    expect(findLeavesV2Doc).toHaveBeenCalledWith(expect.any(Object), '');
    expect(saveLeavesV2Value).toHaveBeenCalledWith(expect.any(Object), '', expect.any(Object));
  });
});
