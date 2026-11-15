'use strict';

jest.mock('../models/Setting', () => ({
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
  collection: {
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
  },
}));

const Setting = require('../models/Setting');
const {
  CONFLICT_CODE,
  findLeavesV2Doc,
  saveLeavesV2Value,
} = require('../services/leavesV2SettingsService');

const req = {
  hospitalId: 'hospital-a',
  user: { uid: 'user-1' },
};

describe('leavesV2SettingsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('findLeavesV2Doc resolves existing legacy hospitalId null document', async () => {
    const legacy = { _id: 'legacy-1', hospitalId: null, key: 'leavesV2', serviceId: '', value: { p1: {} } };
    Setting.findOne.mockResolvedValueOnce(null);
    Setting.collection.findOne.mockResolvedValueOnce(legacy);

    await expect(findLeavesV2Doc(req, '')).resolves.toBe(legacy);

    expect(Setting.findOne).toHaveBeenNthCalledWith(1, {
      hospitalId: 'hospital-a',
      key: 'leavesV2',
      serviceId: '',
    });
    expect(Setting.collection.findOne).toHaveBeenNthCalledWith(1, {
      hospitalId: null,
      key: 'leavesV2',
      serviceId: '',
    });
  });

  test('saveLeavesV2Value updates legacy document instead of inserting duplicate', async () => {
    const saved = { _id: 'legacy-1', hospitalId: null, key: 'leavesV2', serviceId: '', value: { p1: {} } };
    Setting.findOneAndUpdate.mockResolvedValueOnce(null);
    Setting.collection.findOneAndUpdate.mockResolvedValueOnce(saved);

    await expect(saveLeavesV2Value(req, '', { p1: {} })).resolves.toBe(saved);

    expect(Setting.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(Setting.collection.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(Setting.collection.findOneAndUpdate).toHaveBeenNthCalledWith(
      1,
      { hospitalId: null, key: 'leavesV2', serviceId: '' },
      {
        $set: {
          key: 'leavesV2',
          serviceId: '',
          value: { p1: {} },
          updatedBy: 'user-1',
        },
      },
      { returnDocument: 'after' }
    );
  });

  test('saveLeavesV2Value catches duplicate upsert and recovers by updating legacy document', async () => {
    const duplicate = Object.assign(new Error('E11000 duplicate key error'), { code: 11000 });
    const recovered = { _id: 'legacy-1', hospitalId: null, key: 'leavesV2', serviceId: '', value: { p2: {} } };

    Setting.findOneAndUpdate
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(duplicate)
    Setting.collection.findOneAndUpdate
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(recovered);

    await expect(saveLeavesV2Value(req, '', { p2: {} })).resolves.toBe(recovered);
    expect(Setting.findOneAndUpdate).toHaveBeenCalledTimes(3);
    expect(Setting.collection.findOneAndUpdate).toHaveBeenCalledTimes(3);
  });

  test('saveLeavesV2Value returns structured conflict when duplicate recovery is impossible', async () => {
    const duplicate = Object.assign(new Error('E11000 duplicate key error'), { code: 11000 });
    Setting.findOneAndUpdate
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(duplicate)
    Setting.collection.findOneAndUpdate
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    await expect(saveLeavesV2Value(req, '', { p3: {} })).rejects.toMatchObject({
      code: CONFLICT_CODE,
      status: 409,
    });
  });

  test('non-leaves keys are not handled by this service', () => {
    expect(typeof saveLeavesV2Value).toBe('function');
  });
});
