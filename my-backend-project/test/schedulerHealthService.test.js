'use strict';

jest.mock('../models/MonthlySchedule');
jest.mock('../models/GeneratedSchedule');
jest.mock('../models/Assignment');
jest.mock('../models/Setting');

const MonthlySchedule = require('../models/MonthlySchedule');
const GeneratedSchedule = require('../models/GeneratedSchedule');
const Assignment = require('../models/Assignment');
const Setting = require('../models/Setting');
const {
  EXACT_SCOPE_CODE,
  buildSchedulerHealth,
  normalizeExactScope,
  summarizeAssignments,
} = require('../services/schedulerHealthService');

const SCOPE = {
  hospitalId: 'hospital-1',
  sectionId: 'calisma-cizelgesi',
  serviceId: 'service-a',
  role: 'Nurse',
  year: 2026,
  month: 6,
};

function chainLean(value) {
  return { lean: jest.fn().mockResolvedValue(value) };
}

function chainSortLean(value) {
  return {
    sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(value) }),
  };
}

function assignment(index, overrides = {}) {
  return {
    _id: `a-${index}`,
    hospitalId: SCOPE.hospitalId,
    sectionId: SCOPE.sectionId,
    serviceId: SCOPE.serviceId,
    role: SCOPE.role,
    year: SCOPE.year,
    month: SCOPE.month,
    sourceScheduleId: 'schedule-1',
    date: `2026-06-${String((index % 30) + 1).padStart(2, '0')}`,
    personId: `person-${index}`,
    shiftCode: index % 2 ? 'V1' : 'M',
    startTime: index % 2 ? '08:00' : '08:00',
    endTime: index % 2 ? '00:00' : '16:00',
    hours: index % 2 ? 16 : 8,
    duration: index % 2 ? 16 : 8,
    updatedAt: '2026-06-20T12:00:00.000Z',
    ...overrides,
  };
}

function assignments(count, overrides = {}) {
  return Array.from({ length: count }, (_, index) => assignment(index, overrides));
}

function mockReads({
  monthlyAssignments = assignments(2),
  generatedAssignments = monthlyAssignments,
  projectionAssignments = monthlyAssignments,
  monthlyOverrides = {},
  generatedOverrides = {},
  leaves = {},
} = {}) {
  const monthly = monthlyAssignments
    ? {
        _id: 'schedule-1',
        ...SCOPE,
        updatedAt: '2026-06-20T10:00:00.000Z',
        data: { assignments: monthlyAssignments },
        ...monthlyOverrides,
      }
    : null;
  const generated = generatedAssignments
    ? {
        _id: 'generated-1',
        ...SCOPE,
        sourceScheduleId: 'schedule-1',
        updatedAt: '2026-06-20T10:05:00.000Z',
        data: {
          assignments: generatedAssignments,
          issues: generatedOverrides.issues || [],
          debug: generatedOverrides.debug || {},
        },
        ...generatedOverrides,
      }
    : null;

  MonthlySchedule.findOne.mockReturnValue(chainLean(monthly));
  GeneratedSchedule.findOne.mockReturnValue(chainSortLean(generated));
  Assignment.find.mockReturnValue(chainLean(projectionAssignments || []));
  Setting.countDocuments.mockImplementation(async (query) => {
    if (query.key !== 'leavesV2') return 0;
    if (query.serviceId === '') return leaves.scopedDocumentCount || 0;
    if (query.serviceId === SCOPE.serviceId) return leaves.exactServiceDocumentCount || 0;
    return 0;
  });
  Setting.collection = {
    countDocuments: jest.fn(async (query) => {
      if (query?.$or) return leaves.legacyDocumentCount || 0;
      return leaves.totalDocumentCount ?? ((leaves.scopedDocumentCount || 0) + (leaves.exactServiceDocumentCount || 0));
    }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockReads();
});

describe('scheduler health exact scope', () => {
  test.each([
    { serviceId: '' },
    { serviceId: 'all' },
    { serviceId: 'Tümü' },
    { role: '' },
    { role: 'all roles' },
    { role: 'Tüm Roller' },
    { sectionId: '' },
    { year: 'bad' },
    { month: 13 },
    { hospitalId: '' },
  ])('rejects incomplete scope %p', (patch) => {
    expect(() => normalizeExactScope({ ...SCOPE, ...patch })).toThrow(
      expect.objectContaining({ code: EXACT_SCOPE_CODE })
    );
  });

  test('accepts exact scope', () => {
    expect(normalizeExactScope({ ...SCOPE })).toEqual(SCOPE);
  });
});

describe('scheduler health calculations', () => {
  test('returns GREEN when monthly, generated and projection are consistent', async () => {
    const result = await buildSchedulerHealth(SCOPE);

    expect(result.status).toBe('GREEN');
    expect(result.cards.scheduleConsistency.monthly.assignmentCount).toBe(2);
    expect(result.cards.scheduleConsistency.generated.assignmentCount).toBe(2);
    expect(result.cards.scheduleConsistency.assignmentProjection.assignmentCount).toBe(2);
    expect(result.errors).toHaveLength(0);
  });

  test('detects schedule mismatch when Assignment projection has fewer records', async () => {
    mockReads({
      monthlyAssignments: assignments(3),
      generatedAssignments: assignments(3),
      projectionAssignments: assignments(2),
    });

    const result = await buildSchedulerHealth(SCOPE);

    expect(result.status).toBe('RED');
    expect(result.errors.map((item) => item.code)).toContain('SCHEDULE_COUNTS');
    expect(result.errors.map((item) => item.code)).toContain('PROJECTION_DRIFT');
  });

  test('detects missing projection when MonthlySchedule exists and Assignment is empty', async () => {
    mockReads({
      monthlyAssignments: assignments(2),
      generatedAssignments: assignments(2),
      projectionAssignments: [],
    });

    const result = await buildSchedulerHealth(SCOPE);

    expect(result.status).toBe('RED');
    expect(result.errors.map((item) => item.code)).toContain('PROJECTION_MISSING');
  });

  test('detects stale projection when Assignment updatedAt is older than MonthlySchedule', async () => {
    mockReads({
      monthlyAssignments: assignments(2),
      generatedAssignments: assignments(2),
      projectionAssignments: assignments(2, { updatedAt: '2026-06-19T09:00:00.000Z' }),
      monthlyOverrides: { updatedAt: '2026-06-20T10:00:00.000Z' },
    });

    const result = await buildSchedulerHealth(SCOPE);

    expect(result.status).toBe('YELLOW');
    expect(result.warnings.map((item) => item.code)).toContain('PROJECTION_STALE');
  });

  test('detects missing shift metadata', async () => {
    mockReads({
      monthlyAssignments: [assignment(1, { startTime: null, endTime: null, hours: 0, duration: null })],
      generatedAssignments: [assignment(1)],
      projectionAssignments: [assignment(1)],
    });

    const result = await buildSchedulerHealth(SCOPE);

    expect(result.status).toBe('YELLOW');
    expect(result.warnings.map((item) => item.code)).toContain('MISSING_SHIFT_METADATA');
    expect(result.cards.metadataHealth.missingMetadataCount).toBe(1);
  });

  test('detects legacy leavesV2 document risk', async () => {
    mockReads({
      leaves: {
        scopedDocumentCount: 1,
        legacyDocumentCount: 1,
        totalDocumentCount: 2,
      },
    });

    const result = await buildSchedulerHealth(SCOPE);

    expect(result.status).toBe('RED');
    expect(result.errors.map((item) => item.code)).toContain('LEAVES_DUPLICATE_RISK');
  });

  test('summarizeAssignments includes V1 as 16 hours', () => {
    expect(summarizeAssignments([assignment(1)]).totalHours).toBe(16);
  });
});
