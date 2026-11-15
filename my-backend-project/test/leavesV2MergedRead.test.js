'use strict';

// BUG-02: onaylı izinler leavesV2 global kovasına (serviceId '') yazılır.
// Scheduler ve takas önerileri bu kovayı servis kovasıyla birlikte okumalı.

jest.mock('../models/Setting', () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
  collection: { findOne: jest.fn(), findOneAndUpdate: jest.fn() },
}));

const Setting = require('../models/Setting');
const {
  loadMergedLeavesV2Value,
  mergeLeavesV2Values,
} = require('../services/leavesV2SettingsService');

function mockFind(docs) {
  Setting.find.mockReturnValueOnce({ lean: () => Promise.resolve(docs) });
}

describe('mergeLeavesV2Values', () => {
  test('kişi/ay/gün düzeyinde birleştirir, overlay günü ezer', () => {
    const base = { p1: { '2026-11': { 3: { code: 'YI' }, 4: { code: 'YI' } } } };
    const overlay = { p1: { '2026-11': { 4: { code: 'RP' } } }, p2: { '2026-11': { 9: 'MI' } } };

    expect(mergeLeavesV2Values(base, overlay)).toEqual({
      p1: { '2026-11': { 3: { code: 'YI' }, 4: { code: 'RP' } } },
      p2: { '2026-11': { 9: 'MI' } },
    });
    // girdiler değişmemeli
    expect(base.p1['2026-11'][4]).toEqual({ code: 'YI' });
  });

  test('geçersiz girdileri yok sayar', () => {
    expect(mergeLeavesV2Values(null, undefined)).toEqual({});
    expect(mergeLeavesV2Values({ p1: null, '': {} }, 'x')).toEqual({});
  });
});

describe('loadMergedLeavesV2Value', () => {
  beforeEach(() => jest.clearAllMocks());

  test('global + servis kovasını hastane filtresiyle okur', async () => {
    mockFind([
      { serviceId: '', value: { p1: { '2026-11': { 5: { code: 'YI' } } } } },
      { serviceId: 'svc-a', value: { p2: { '2026-11': { 6: { code: 'RP' } } } } },
    ]);

    const value = await loadMergedLeavesV2Value({ hospitalId: 'h1', serviceId: 'svc-a' });

    expect(Setting.find).toHaveBeenCalledWith({
      key: 'leavesV2',
      serviceId: { $in: ['', 'svc-a'] },
      hospitalId: 'h1',
    });
    expect(value).toEqual({
      p1: { '2026-11': { 5: { code: 'YI' } } },
      p2: { '2026-11': { 6: { code: 'RP' } } },
    });
  });

  test('servis kovası aynı günde global kovaya göre önceliklidir', async () => {
    mockFind([
      { serviceId: 'svc-a', value: { p1: { '2026-11': { 5: { code: 'RP' } } } } },
      { serviceId: '', value: { p1: { '2026-11': { 5: { code: 'YI' } } } } },
    ]);

    const value = await loadMergedLeavesV2Value({ hospitalId: 'h1', serviceId: 'svc-a' });
    expect(value.p1['2026-11'][5]).toEqual({ code: 'RP' });
  });

  test('serviceId boşsa sadece global kova sorgulanır', async () => {
    mockFind([]);
    await expect(loadMergedLeavesV2Value({ hospitalId: 'h1' })).resolves.toEqual({});
    expect(Setting.find).toHaveBeenCalledWith({
      key: 'leavesV2',
      serviceId: { $in: [''] },
      hospitalId: 'h1',
    });
  });
});
