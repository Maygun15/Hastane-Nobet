'use strict';

const MonthlySchedule = require('../models/MonthlySchedule');
const GeneratedSchedule = require('../models/GeneratedSchedule');
const Assignment = require('../models/Assignment');
const Setting = require('../models/Setting');

const EXACT_SCOPE_CODE = 'EXACT_SCOPE_REQUIRED';
const EXACT_SCOPE_MESSAGE = 'Scheduler health requires a complete schedule scope.';

const STATUS_RANK = {
  GREEN: 0,
  YELLOW: 1,
  RED: 2,
};

const INVALID_SPECIFIC_VALUES = new Set([
  '',
  'all',
  'all services',
  'all roles',
  'tumu',
  'tum servisler',
  'tum roller',
]);

const SHIFT_HOURS = Object.freeze({
  M: 8,
  A: 4,
  M4: 4,
  V1: 16,
  N: 24,
  V2: 24,
  SV: 24,
  N24: 24,
});

function normalizeValue(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function isSpecificValue(value) {
  return !INVALID_SPECIFIC_VALUES.has(normalizeValue(value));
}

function createExactScopeError() {
  const error = new Error(EXACT_SCOPE_MESSAGE);
  error.code = EXACT_SCOPE_CODE;
  error.status = 400;
  error.statusCode = 400;
  return error;
}

function normalizeExactScope(scope = {}) {
  const sectionId = String(scope.sectionId || '').trim();
  const serviceId = String(scope.serviceId || '').trim();
  const role = String(scope.role || '').trim();
  const year = Number(scope.year);
  const month = Number(scope.month);
  const hospitalId = scope.hospitalId ? String(scope.hospitalId).trim() : '';

  if (
    !hospitalId ||
    !sectionId ||
    !isSpecificValue(serviceId) ||
    !isSpecificValue(role) ||
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    year < 2000 ||
    year > 2100 ||
    month < 1 ||
    month > 12
  ) {
    throw createExactScopeError();
  }

  return Object.freeze({ hospitalId, sectionId, serviceId, role, year, month });
}

function normalizeId(value) {
  if (!value) return '';
  if (typeof value === 'object') return String(value._id || value.id || value.toString?.() || '').trim();
  return String(value).trim();
}

function readAssignmentsFromSchedule(doc) {
  const data = doc?.data || {};
  if (Array.isArray(data.assignments)) return data.assignments;
  return [];
}

function readGeneratedAssignments(doc) {
  const data = doc?.data || {};
  if (Array.isArray(data.assignments)) return data.assignments;
  if (Array.isArray(doc?.assignments)) return doc.assignments;
  return [];
}

function readShiftCode(item = {}) {
  return String(item.shiftCode || item.shiftId || item.shift || item.code || '').trim();
}

function readHours(item = {}) {
  const explicit = Number(item.hours ?? item.duration ?? item.workingHours);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const code = readShiftCode(item).toUpperCase();
  return SHIFT_HOURS[code] || 0;
}

function summarizeAssignments(assignments = []) {
  const list = Array.isArray(assignments) ? assignments : [];
  const shiftDistribution = {};
  const personnel = new Set();
  let totalHours = 0;
  let missingMetadataCount = 0;
  const affectedShiftCodes = new Set();

  for (const item of list) {
    const shiftCode = readShiftCode(item) || 'UNKNOWN';
    shiftDistribution[shiftCode] = (shiftDistribution[shiftCode] || 0) + 1;
    const personId = String(item?.personId || item?.personKey || item?.personName || '').trim();
    if (personId) personnel.add(personId);
    totalHours += readHours(item);

    const hasTiming =
      String(item?.startTime || '').trim() &&
      String(item?.endTime || '').trim() &&
      Number(item?.hours) > 0 &&
      Number(item?.duration ?? item?.hours) > 0 &&
      String(shiftCode || '').trim();
    if (!hasTiming) {
      missingMetadataCount += 1;
      affectedShiftCodes.add(shiftCode);
    }
  }

  return {
    assignmentCount: list.length,
    totalHours,
    shiftDistribution,
    personnelCount: personnel.size,
    missingMetadataCount,
    affectedShiftCodes: Array.from(affectedShiftCodes).sort(),
  };
}

function addCheck(checks, { category, code, status = 'GREEN', message, values = {} }) {
  checks.push({ category, code, status, message, values });
}

function worstStatus(statuses = []) {
  return statuses.reduce((worst, status) => (
    STATUS_RANK[status] > STATUS_RANK[worst] ? status : worst
  ), 'GREEN');
}

function scopeMatches(scope, doc = {}) {
  if (!doc) return true;
  const mismatches = [];
  for (const key of ['sectionId', 'serviceId', 'role']) {
    if (String(doc?.[key] ?? '').trim() !== String(scope[key] ?? '').trim()) mismatches.push(key);
  }
  for (const key of ['year', 'month']) {
    if (Number(doc?.[key]) !== Number(scope[key])) mismatches.push(key);
  }
  if (normalizeId(doc?.hospitalId) && normalizeId(doc.hospitalId) !== normalizeId(scope.hospitalId)) {
    mismatches.push('hospitalId');
  }
  return mismatches;
}

function latestUpdatedAt(assignments = []) {
  let latest = null;
  let latestTs = 0;
  for (const item of assignments || []) {
    const value = item?.updatedAt || item?.createdAt || null;
    const ts = value ? Date.parse(value) : NaN;
    if (Number.isFinite(ts) && ts > latestTs) {
      latest = value;
      latestTs = ts;
    }
  }
  return latest;
}

function collectSourceScheduleIds(assignments = []) {
  const ids = new Set();
  for (const item of assignments || []) {
    const id = normalizeId(item?.sourceScheduleId);
    if (id) ids.add(id);
  }
  return Array.from(ids).sort();
}

function countIssues(generated = null) {
  const data = generated?.data || {};
  const issues = Array.isArray(data.issues) ? data.issues : [];
  const requiredSlots = Number(data?.debug?.requiredSlots ?? data?.requiredSlots ?? 0) || 0;
  const assignmentCount = readGeneratedAssignments(generated).length;
  const missingFromIssues = issues.reduce((sum, item) => sum + Math.max(0, Number(item?.missing || 0) || 0), 0);
  const emptySlots = Math.max(missingFromIssues, requiredSlots ? Math.max(0, requiredSlots - assignmentCount) : 0);
  const byReason = {};
  for (const issue of issues) {
    const reason = String(issue?.reason || issue?.code || 'UNKNOWN').trim() || 'UNKNOWN';
    byReason[reason] = (byReason[reason] || 0) + 1;
  }
  return {
    generatedAssignments: assignmentCount,
    requiredSlots,
    emptySlots,
    issueCount: issues.length,
    byReason,
    underMinCount: Number(byReason.UNDER_MIN || byReason.underMin || 0) || 0,
    overHardMaxCount: Number(byReason.MONTHLY_HARD_MAX || byReason.overHardMax || 0) || 0,
  };
}

async function getLeavesHealth(scope) {
  const hospitalId = scope.hospitalId;
  const base = { key: 'leavesV2' };
  const scopedQuery = { ...base, hospitalId, serviceId: '' };
  const exactServiceQuery = { ...base, hospitalId, serviceId: scope.serviceId };

  const scopedDocumentCount = await Setting.countDocuments(scopedQuery);
  const exactServiceDocumentCount = await Setting.countDocuments(exactServiceQuery);

  let legacyDocumentCount = 0;
  let totalDocumentCount = scopedDocumentCount + exactServiceDocumentCount;
  if (Setting.collection?.countDocuments) {
    legacyDocumentCount = await Setting.collection.countDocuments({
      key: 'leavesV2',
      $or: [
        { hospitalId: null },
        { hospitalId: { $exists: false } },
      ],
    });
    totalDocumentCount = await Setting.collection.countDocuments({ key: 'leavesV2' });
  }

  const duplicateRisk = legacyDocumentCount > 0 && (scopedDocumentCount > 0 || exactServiceDocumentCount > 0);

  return {
    totalDocumentCount,
    scopedDocumentCount,
    exactServiceDocumentCount,
    legacyDocumentCount,
    duplicateRisk,
  };
}

async function buildSchedulerHealth(inputScope = {}) {
  const scope = normalizeExactScope(inputScope);
  const query = {
    hospitalId: scope.hospitalId,
    sectionId: scope.sectionId,
    serviceId: scope.serviceId,
    role: scope.role,
    year: scope.year,
    month: scope.month,
  };

  const [monthly, generated, assignments, leavesHealth] = await Promise.all([
    MonthlySchedule.findOne(query).lean(),
    GeneratedSchedule.findOne(query).sort({ createdAt: -1 }).lean(),
    Assignment.find(query).lean(),
    getLeavesHealth(scope),
  ]);

  const monthlyAssignments = readAssignmentsFromSchedule(monthly);
  const generatedAssignments = readGeneratedAssignments(generated);
  const projectionAssignments = Array.isArray(assignments) ? assignments : [];

  const monthlySummary = summarizeAssignments(monthlyAssignments);
  const generatedSummary = summarizeAssignments(generatedAssignments);
  const projectionSummary = summarizeAssignments(projectionAssignments);
  const schedulerOutput = countIssues(generated);
  const assignmentLatestUpdatedAt = latestUpdatedAt(projectionAssignments);
  const assignmentSourceScheduleIds = collectSourceScheduleIds(projectionAssignments);
  const monthlyId = normalizeId(monthly?._id || monthly?.id);
  const generatedSourceScheduleId = normalizeId(generated?.sourceScheduleId);

  const checks = [];

  addCheck(checks, {
    category: 'Schedule Consistency',
    code: 'SCHEDULE_COUNTS',
    status: (
      monthlySummary.assignmentCount === generatedSummary.assignmentCount &&
      monthlySummary.assignmentCount === projectionSummary.assignmentCount
    ) ? 'GREEN' : 'RED',
    message: 'Compares assignment counts across MonthlySchedule, GeneratedSchedule and Assignment.',
    values: {
      monthlyAssignments: monthlySummary.assignmentCount,
      generatedAssignments: generatedSummary.assignmentCount,
      assignmentProjection: projectionSummary.assignmentCount,
    },
  });

  addCheck(checks, {
    category: 'Hours Consistency',
    code: 'HOURS_CONSISTENCY',
    status: (
      monthlySummary.totalHours === generatedSummary.totalHours &&
      monthlySummary.totalHours === projectionSummary.totalHours
    ) ? 'GREEN' : 'RED',
    message: 'Compares official total hours across backend schedule sources.',
    values: {
      monthlyHours: monthlySummary.totalHours,
      generatedHours: generatedSummary.totalHours,
      assignmentHours: projectionSummary.totalHours,
      difference: Math.max(monthlySummary.totalHours, generatedSummary.totalHours, projectionSummary.totalHours) -
        Math.min(monthlySummary.totalHours, generatedSummary.totalHours, projectionSummary.totalHours),
    },
  });

  let projectionStatus = 'GREEN';
  let projectionCode = 'PROJECTION_OK';
  if (monthly && projectionSummary.assignmentCount === 0) {
    projectionStatus = 'RED';
    projectionCode = 'PROJECTION_MISSING';
  } else if (monthlySummary.assignmentCount !== projectionSummary.assignmentCount) {
    projectionStatus = 'RED';
    projectionCode = 'PROJECTION_DRIFT';
  } else if (monthly?.updatedAt && assignmentLatestUpdatedAt && Date.parse(assignmentLatestUpdatedAt) < Date.parse(monthly.updatedAt)) {
    projectionStatus = 'YELLOW';
    projectionCode = 'PROJECTION_STALE';
  }
  if (monthlyId && assignmentSourceScheduleIds.length && assignmentSourceScheduleIds.some((id) => id !== monthlyId)) {
    projectionStatus = 'RED';
    projectionCode = 'PROJECTION_DRIFT';
  }
  addCheck(checks, {
    category: 'Projection Health',
    code: projectionCode,
    status: projectionStatus,
    message: 'Checks Assignment projection count, freshness and sourceScheduleId alignment.',
    values: {
      projectionCount: projectionSummary.assignmentCount,
      latestProjectionUpdatedAt: assignmentLatestUpdatedAt,
      sourceScheduleIds: assignmentSourceScheduleIds,
      monthlyScheduleId: monthlyId,
    },
  });

  const scopeMismatches = [
    ...scopeMatches(scope, monthly).map((field) => ({ source: 'MonthlySchedule', field })),
    ...scopeMatches(scope, generated).map((field) => ({ source: 'GeneratedSchedule', field })),
    ...projectionAssignments
      .slice(0, 20)
      .flatMap((item) => scopeMatches(scope, item).map((field) => ({ source: 'Assignment', field }))),
  ];
  addCheck(checks, {
    category: 'Scope Integrity',
    code: scopeMismatches.length ? 'WRONG_SCOPE' : 'SCOPE_OK',
    status: scopeMismatches.length ? 'RED' : 'GREEN',
    message: 'Verifies observed data belongs to the requested exact schedule scope.',
    values: { mismatches: scopeMismatches },
  });

  const generationWarning = schedulerOutput.emptySlots > 0 || schedulerOutput.issueCount > 0;
  addCheck(checks, {
    category: 'Scheduler Output Health',
    code: generationWarning ? 'GENERATION_WARNING' : 'GENERATION_OK',
    status: generationWarning ? 'YELLOW' : 'GREEN',
    message: 'Summarizes generated assignments, empty slots and scheduler issues.',
    values: schedulerOutput,
  });

  const missingMetadataCount = Math.max(
    monthlySummary.missingMetadataCount,
    generatedSummary.missingMetadataCount,
    projectionSummary.missingMetadataCount
  );
  addCheck(checks, {
    category: 'Assignment Metadata Health',
    code: missingMetadataCount ? 'MISSING_SHIFT_METADATA' : 'METADATA_OK',
    status: missingMetadataCount ? 'YELLOW' : 'GREEN',
    message: 'Checks shiftCode, startTime, endTime, hours and duration on observed assignments.',
    values: {
      missingMetadataCount,
      affectedShiftCodes: Array.from(new Set([
        ...monthlySummary.affectedShiftCodes,
        ...generatedSummary.affectedShiftCodes,
        ...projectionSummary.affectedShiftCodes,
      ])).sort(),
    },
  });

  addCheck(checks, {
    category: 'Leaves Health',
    code: leavesHealth.duplicateRisk
      ? 'LEAVES_DUPLICATE_RISK'
      : leavesHealth.legacyDocumentCount > 0
        ? 'LEGACY_LEAVES_DOC'
        : 'LEAVES_OK',
    status: leavesHealth.duplicateRisk ? 'RED' : leavesHealth.legacyDocumentCount > 0 ? 'YELLOW' : 'GREEN',
    message: 'Checks leavesV2 scoped and legacy settings document shape.',
    values: leavesHealth,
  });

  if (monthlyId && generatedSourceScheduleId && generatedSourceScheduleId !== monthlyId) {
    addCheck(checks, {
      category: 'Schedule Consistency',
      code: 'SOURCE_SCHEDULE_MISMATCH',
      status: 'RED',
      message: 'GeneratedSchedule sourceScheduleId differs from MonthlySchedule.',
      values: { monthlyScheduleId: monthlyId, generatedSourceScheduleId },
    });
  }

  const errors = checks.filter((item) => item.status === 'RED');
  const warnings = checks.filter((item) => item.status === 'YELLOW');
  const status = worstStatus(checks.map((item) => item.status));

  return {
    ok: true,
    scope,
    status,
    summary: {
      message: status === 'GREEN'
        ? 'All schedule sources are consistent.'
        : status === 'RED'
          ? 'One or more schedule health checks require attention.'
          : 'Scheduler health has warnings. Check recommended.',
      checkedAt: new Date().toISOString(),
    },
    cards: {
      runtimeSummary: {
        status,
        errors: errors.length,
        warnings: warnings.length,
      },
      scheduleConsistency: {
        monthly: monthlySummary,
        generated: generatedSummary,
        assignmentProjection: projectionSummary,
      },
      projectionHealth: {
        projectionCount: projectionSummary.assignmentCount,
        latestProjectionUpdatedAt: assignmentLatestUpdatedAt,
        sourceScheduleIds: assignmentSourceScheduleIds,
        monthlyScheduleId: monthlyId,
      },
      hoursConsistency: {
        monthlyHours: monthlySummary.totalHours,
        generatedHours: generatedSummary.totalHours,
        assignmentHours: projectionSummary.totalHours,
      },
      schedulerOutput,
      leavesHealth,
      scopeIntegrity: { mismatches: scopeMismatches },
      metadataHealth: {
        missingMetadataCount,
        affectedShiftCodes: Array.from(new Set([
          ...monthlySummary.affectedShiftCodes,
          ...generatedSummary.affectedShiftCodes,
          ...projectionSummary.affectedShiftCodes,
        ])).sort(),
      },
    },
    checks,
    warnings,
    errors,
    recommendedActions: buildRecommendedActions(checks),
  };
}

function buildRecommendedActions(checks = []) {
  const actions = [];
  const add = (code, title, message) => actions.push({ code, title, message });

  if (checks.some((item) => item.code === 'SCHEDULE_COUNTS' && item.status === 'RED')) {
    add('CHECK_SCHEDULE_SOURCES', 'Compare schedule sources', 'MonthlySchedule, GeneratedSchedule and Assignment counts differ. Check projection and latest schedule save.');
  }
  if (checks.some((item) => item.code === 'PROJECTION_MISSING' || item.code === 'PROJECTION_DRIFT')) {
    add('CHECK_PROJECTION', 'Check Assignment projection', 'Assignment projection may not match the operational MonthlySchedule.');
  }
  if (checks.some((item) => item.code === 'PROJECTION_STALE')) {
    add('CHECK_PROJECTION_FRESHNESS', 'Check projection freshness', 'Assignment projection appears older than MonthlySchedule.');
  }
  if (checks.some((item) => item.code === 'MISSING_SHIFT_METADATA')) {
    add('CHECK_SHIFT_METADATA', 'Check shift metadata', 'Some assignments are missing shift timing metadata used by hours, rest and overtime calculations.');
  }
  if (checks.some((item) => item.code === 'LEAVES_DUPLICATE_RISK' || item.code === 'LEGACY_LEAVES_DOC')) {
    add('CHECK_LEAVES_SETTINGS', 'Check leave settings', 'Legacy leavesV2 settings documents may affect leave saves.');
  }
  if (checks.some((item) => item.code === 'GENERATION_WARNING')) {
    add('CHECK_SCHEDULER_ISSUES', 'Review scheduler issues', 'GeneratedSchedule contains issues or empty slots.');
  }
  return actions;
}

module.exports = {
  EXACT_SCOPE_CODE,
  EXACT_SCOPE_MESSAGE,
  buildSchedulerHealth,
  normalizeExactScope,
  summarizeAssignments,
};
