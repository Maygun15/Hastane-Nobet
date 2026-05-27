const GeneratedSchedule = require('../models/GeneratedSchedule');
const MonthlySchedule = require('../models/MonthlySchedule');
const Person = require('../models/Person');
const Setting = require('../models/Setting');
const mongoose = require('mongoose');
const { computeQualityScore } = require('./scheduleQuality');
const { listHolidays } = require('./holidayService');
const { generateMonthlyPlan } = require('./scheduler');
const { generateDraftRoster } = require('./scheduler/draftRoster');
const { fetchDutyRules, DEFAULT_RULES, DEFAULT_WEIGHTS } = require('./scheduler/ruleResolver');
const { replaceAssignmentsForSchedule } = require('./assignmentSyncService');
const { resolveStaff } = require('./scheduler/staffResolver');
const { validateAssignments } = require('./scheduler/validator');
const { applyHolidayPolicies } = require('./scheduler/holidayPolicyAdapter');
const { buildSchedulerInput } = require('./scheduler/inputBuilder');

const MONTHLY_SCHEDULER_INPUT_PROJECTION = {
  _id: 1,
  'data.defs': 1,
  'data.rows': 1,
  'data.overrides': 1,
  'data.shiftOptions': 1,
  'data.roster': 1,
};

function normalizeRuleCode(code) {
  return String(code || '').trim().toUpperCase();
}

function addRuleCounts(target = {}, source = {}) {
  Object.entries(source || {}).forEach(([code, count]) => {
    const normalized = normalizeRuleCode(code);
    if (!normalized) return;
    target[normalized] = Number(target[normalized] || 0) + (Number(count || 0) || 0);
  });
}

function buildIssueDiagnostics({ issues = [], candidateAudit = [] } = {}) {
  if (!Array.isArray(issues) || !issues.length) return [];

  const auditBySlot = new Map();
  (Array.isArray(candidateAudit) ? candidateAudit : []).forEach((entry) => {
    const key = `${String(entry?.date || '')}|${String(entry?.shiftId || '')}`;
    if (!auditBySlot.has(key)) auditBySlot.set(key, []);
    auditBySlot.get(key).push(entry);
  });

  return issues.map((issue) => {
    const key = `${String(issue?.date || '')}|${String(issue?.shiftId || issue?.rowId || issue?.shiftCode || '')}`;
    const audits = auditBySlot.get(key) || [];
    const blockers = {};
    let inputStaffCount = 0;
    let candidateBuilderEligibleCount = 0;
    let postConstraintCount = 0;

    audits.forEach((audit) => {
      inputStaffCount = Math.max(inputStaffCount, Number(audit?.inputStaffCount || 0));
      candidateBuilderEligibleCount = Math.max(
        candidateBuilderEligibleCount,
        Number((audit?.candidateBuilderEligibleCount ?? audit?.eligibleCount) || 0)
      );
      postConstraintCount = Math.max(postConstraintCount, Number(audit?.postConstraintCount || 0));

      addRuleCounts(blockers, audit?.hardFilteredBlockingRules);
      addRuleCounts(blockers, audit?.runtimeGuardBlockingRules);

      (Array.isArray(audit?.rejected) ? audit.rejected : []).forEach((item) => {
        (Array.isArray(item?.failedRuleCodes) ? item.failedRuleCodes : []).forEach((code) => {
          const normalized = normalizeRuleCode(code);
          if (!normalized) return;
          blockers[normalized] = Number(blockers[normalized] || 0) + 1;
        });
        (Array.isArray(item?.reasonCodes) ? item.reasonCodes : []).forEach((code) => {
          const normalized = normalizeRuleCode(code).replace(/_EXCEEDED$/, '');
          if (!normalized) return;
          blockers[normalized] = Number(blockers[normalized] || 0) + 1;
        });
      });
    });

    const topBlockers = Object.entries(blockers)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([code, count]) => ({ code, count: Number(count || 0) }));

    return {
      date: issue?.date || null,
      shiftId: issue?.shiftId || issue?.rowId || issue?.shiftCode || '',
      reason: issue?.reason || null,
      missing: Number(issue?.missing || 0) || 0,
      inputStaffCount,
      candidateBuilderEligibleCount,
      postConstraintCount,
      blockers,
      topBlockers,
    };
  });
}

function safeBuildIssueDiagnostics(params) {
  try {
    return buildIssueDiagnostics(params);
  } catch (err) {
    console.error('[schedulerService] buildIssueDiagnostics hata:', {
      function: 'buildIssueDiagnostics',
      issueCount: Array.isArray(params?.issues) ? params.issues.length : '?',
      auditCount: Array.isArray(params?.candidateAudit) ? params.candidateAudit.length : '?',
      error: err?.message,
      code: err?.code,
    });
    return [];
  }
}

function buildGeneratedScheduleData({
  useDraft = false,
  draftResult = null,
  context = null,
  validated = null,
  days = [],
  staffPack = null,
  shiftCount = 0,
  requiredSlots = 0,
} = {}) {
  const baseAssignmentsRaw = useDraft ? (draftResult?.assignments || []) : (context?.assignments || []);
  const baseIssues = useDraft ? (draftResult?.issues || []) : (context?.issues || []);

  return {
    assignments: Array.isArray(validated?.assignments) ? validated.assignments : baseAssignmentsRaw,
    issues: [...baseIssues, ...(validated?.issues || [])],
    candidateAudit: useDraft ? [] : (Array.isArray(context?.candidateAudit) ? context.candidateAudit : []),
    shadowAudit: useDraft ? null : (context?.shadowAudit || null),
    issueDiagnostics: useDraft
      ? []
      : safeBuildIssueDiagnostics({
          issues: [...baseIssues, ...(validated?.issues || [])],
          candidateAudit: Array.isArray(context?.candidateAudit) ? context.candidateAudit : [],
        }),
    days: Array.isArray(days) ? days.length : 0,
    debug: {
      staff: staffPack?.debug || null,
      shiftCount: Number(shiftCount || 0),
      requiredSlots: Number(requiredSlots || 0),
      engine: useDraft ? 'draft' : 'optimized',
      hardFiltered: validated?.debug?.hardFiltered || 0,
      invalidAssignmentCount: validated?.debug?.invalidAssignmentCount || 0,
      invalidAssignments: Array.isArray(validated?.debug?.invalidAssignments)
        ? validated.debug.invalidAssignments
        : [],
      invalidAssignmentByReason:
        validated?.debug?.invalidAssignmentByReason &&
        typeof validated.debug.invalidAssignmentByReason === 'object'
          ? validated.debug.invalidAssignmentByReason
          : {},
    },
  };
}

function safeDiagnosticMessage(error, fallback = 'MonthlySchedule write-back failed.') {
  const message = error?.message != null ? String(error.message).trim() : '';
  return message || fallback;
}

function buildMonthlyWriteBackDiagnostic(error) {
  return {
    ok: false,
    stage: 'MONTHLY_WRITE_BACK',
    severity: 'warning',
    message: safeDiagnosticMessage(error),
  };
}

function isGeneratedPayloadTooLargeError(error) {
  const message = safeDiagnosticMessage(error, '').toLowerCase();
  return (
    (message.includes('offset') && message.includes('out of range')) ||
    message.includes('bson') ||
    message.includes('object to insert too large') ||
    message.includes('document is larger than') ||
    message.includes('rangeerror')
  );
}

function buildGeneratedPayloadSizeDiagnostic(error) {
  return {
    ok: false,
    stage: 'GENERATED_WRITE',
    severity: 'warning',
    code: 'GENERATED_PAYLOAD_TOO_LARGE',
    message: safeDiagnosticMessage(
      error,
      'Generated scheduler payload exceeded persistence size limits; explainability was truncated.'
    ),
  };
}

function toNonEmptyArray(value) {
  if (!Array.isArray(value)) return null;
  const cleaned = value.filter((item) => item != null && String(item).trim() !== '');
  return cleaned.length ? cleaned : null;
}

function pickFirstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

async function hydratePayloadStaffFromDb(payloadStaff = [], hospitalId = null) {
  const safePayloadStaff = Array.isArray(payloadStaff) ? payloadStaff : [];
  if (!safePayloadStaff.length) {
    return {
      staff: [],
      debug: { rawCount: 0, hydratedCount: 0, missingDbCount: 0 },
    };
  }

  const ids = safePayloadStaff
    .map((person) => String(person?._id || person?.id || '').trim())
    .filter(Boolean);

  if (!ids.length) {
    return {
      staff: safePayloadStaff,
      debug: { rawCount: safePayloadStaff.length, hydratedCount: 0, missingDbCount: safePayloadStaff.length },
    };
  }

  const objectIds = ids.filter((id) => mongoose.Types.ObjectId.isValid(id));
  const legacyIds = ids.filter((id) => !mongoose.Types.ObjectId.isValid(id));
  const queryClauses = [];
  if (objectIds.length) queryClauses.push({ _id: { $in: objectIds } });
  if (legacyIds.length) queryClauses.push({ tc: { $in: legacyIds } });

  if (!queryClauses.length) {
    return {
      staff: safePayloadStaff,
      debug: { rawCount: safePayloadStaff.length, hydratedCount: 0, missingDbCount: safePayloadStaff.length },
    };
  }

  const query = queryClauses.length === 1 ? queryClauses[0] : { $or: queryClauses };
  if (hospitalId) query.hospitalId = hospitalId;
  const dbStaff = await Person.find(query)
    .select({
      _id: 1,
      name: 1,
      tc: 1,
      active: 1,
      serviceId: 1,
      meta: 1,
    })
    .lean();

  const dbMap = new Map();
  dbStaff.forEach((person) => {
    const objectIdKey = String(person?._id || '').trim();
    const tcKey = String(person?.tc || '').trim();
    if (objectIdKey) dbMap.set(objectIdKey, person);
    if (tcKey) dbMap.set(tcKey, person);
  });
  let hydratedCount = 0;
  let missingDbCount = 0;

  const hydratedStaff = safePayloadStaff.map((person) => {
    const personId = String(person?._id || person?.id || '').trim();
    const db = personId ? dbMap.get(personId) : null;
    if (!db) {
      missingDbCount += 1;
      return person;
    }

    hydratedCount += 1;
    const payloadMeta = person?.meta && typeof person.meta === 'object' ? person.meta : {};
    const dbMeta = db?.meta && typeof db.meta === 'object' ? db.meta : {};
    const payloadAreas = toNonEmptyArray(person?.areas);
    const payloadShiftCodes = toNonEmptyArray(person?.shiftCodes);
    const dbAreas = toNonEmptyArray(db?.areas) || toNonEmptyArray(dbMeta?.areas) || toNonEmptyArray(dbMeta?.sections);
    const dbShiftCodes = toNonEmptyArray(db?.shiftCodes) || toNonEmptyArray(dbMeta?.shiftCodes) || toNonEmptyArray(dbMeta?.shifts);

    return {
      ...db,
      ...person,
      id: person?.id || personId,
      _id: db?._id || person?._id || personId,
      name: pickFirstDefined(person?.name, person?.fullName, db?.name, personId),
      fullName: pickFirstDefined(person?.fullName, person?.name, db?.name, personId),
      active: pickFirstDefined(person?.active, db?.active, dbMeta?.active, true),
      isActive: pickFirstDefined(person?.isActive, dbMeta?.isActive, db?.active, true),
      status: pickFirstDefined(person?.status, dbMeta?.status, null),
      serviceId: pickFirstDefined(person?.serviceId, db?.serviceId, dbMeta?.serviceId, ''),
      role: pickFirstDefined(person?.role, payloadMeta?.role, dbMeta?.role, dbMeta?.unvan, ''),
      title: pickFirstDefined(person?.title, payloadMeta?.title, dbMeta?.title, dbMeta?.unvan, ''),
      stats: pickFirstDefined(person?.stats, payloadMeta?.stats, dbMeta?.stats, {}),
      areas: payloadAreas || dbAreas || [],
      shiftCodes: payloadShiftCodes || dbShiftCodes || [],
      meta: {
        ...dbMeta,
        ...payloadMeta,
        active: pickFirstDefined(person?.active, payloadMeta?.active, db?.active, dbMeta?.active, true),
        isActive: pickFirstDefined(person?.isActive, payloadMeta?.isActive, dbMeta?.isActive, db?.active, true),
        serviceId: pickFirstDefined(person?.serviceId, payloadMeta?.serviceId, db?.serviceId, dbMeta?.serviceId, ''),
        role: pickFirstDefined(person?.role, payloadMeta?.role, dbMeta?.role, dbMeta?.unvan, ''),
        title: pickFirstDefined(person?.title, payloadMeta?.title, dbMeta?.title, dbMeta?.unvan, ''),
        stats: pickFirstDefined(person?.stats, payloadMeta?.stats, dbMeta?.stats, {}),
        areas: payloadAreas || dbAreas || [],
        shiftCodes: payloadShiftCodes || dbShiftCodes || [],
      },
    };
  });

  return {
    staff: hydratedStaff,
    debug: {
      rawCount: safePayloadStaff.length,
      hydratedCount,
      missingDbCount,
    },
  };
}

function attachMonthlyWriteBackDiagnostic(data = {}, diagnostic = null) {
  if (!diagnostic || typeof diagnostic !== 'object') return data;
  const nextDebug =
    data?.debug && typeof data.debug === 'object' && !Array.isArray(data.debug)
      ? { ...data.debug, monthlyWriteBack: diagnostic }
      : { monthlyWriteBack: diagnostic };
  return {
    ...data,
    debug: nextDebug,
  };
}

function attachGeneratedWriteDiagnostic(data = {}, diagnostic = null) {
  if (!diagnostic || typeof diagnostic !== 'object') return data;
  const baseDebug =
    data?.debug && typeof data.debug === 'object' && !Array.isArray(data.debug)
      ? data.debug
      : {};
  return {
    ...data,
    candidateAudit: [],
    shadowAudit: null,
    debug: {
      ...baseDebug,
      generatedWrite: diagnostic,
      explainabilityTruncated: true,
      candidateAuditEntriesBeforeTruncation: Array.isArray(data?.candidateAudit) ? data.candidateAudit.length : 0,
      shadowAuditPresentBeforeTruncation: Boolean(data?.shadowAudit),
    },
  };
}

// GeneratedSchedule is the authoritative scheduler write model:
// full assignments, issues, explainability, and scheduler meta are persisted here.
function buildGeneratedSchedulePayload({
  hospitalId = null,
  sectionId,
  serviceId = '',
  role = '',
  year,
  month,
  scheduleDoc = null,
  data = {},
  rules = {},
  weights = {},
  userId = null,
} = {}) {
  return {
    ...(hospitalId ? { hospitalId } : {}),
    sectionId,
    serviceId,
    role,
    year,
    month,
    sourceScheduleId: scheduleDoc?._id || null,
    data,
    meta: { rules, weights },
    createdBy: userId || null,
    updatedBy: userId || null,
  };
}

// MonthlySchedule remains the operational assignment snapshot read model.
// Only assignment-shaped data is written back here for legacy/monthly readers.
function assignmentsToNamed(assignments = []) {
  const named = {};
  for (const a of assignments) {
    let day;
    if (typeof a.day === 'number' && a.day >= 1 && a.day <= 31) {
      day = String(a.day);
    } else {
      const d = new Date((String(a.date || '') + 'T00:00:00'));
      if (!isNaN(d.getTime())) day = String(d.getDate());
    }
    if (!day) continue;
    const rowKey = String(a.rowId || a.shiftId || a.shiftCode || '').trim();
    if (!rowKey) continue;
    const personName = String(a.personName || '').trim();
    if (!personName) continue;
    if (!named[day]) named[day] = {};
    if (!named[day][rowKey]) named[day][rowKey] = [];
    if (!named[day][rowKey].includes(personName)) named[day][rowKey].push(personName);
  }
  return named;
}

function buildMonthlyScheduleWriteback({ data = {}, existingRoster = {} } = {}) {
  const assignments = Array.isArray(data?.assignments) ? data.assignments : [];
  const roster =
    existingRoster && typeof existingRoster === 'object' && !Array.isArray(existingRoster)
      ? existingRoster
      : {};
  return {
    'data.assignments': assignments,
    'data.generatedAt': new Date().toISOString(),
    'data.roster': {
      ...roster,
      namedAssignments: assignmentsToNamed(assignments),
    },
  };
}

// leavesV2 Setting dokümanından onaylı izin günlerini çeker.
// Döndürdüğü format: { [personId]: string[] } — her string "YYYY-MM-DD".
// Array olarak döner; çağıran taraf ihtiyacına göre Set'e çevirir.
async function buildLeavesByPersonFromDb({ serviceId, year, month, hospitalId }) {
  const monthKey = `${year}-${String(month).padStart(2, '0')}`;
  const filter = { key: 'leavesV2', serviceId: String(serviceId || '') };
  if (hospitalId) filter.hospitalId = hospitalId;

  const doc = await Setting.findOne(filter).lean();
  if (!doc?.value || typeof doc.value !== 'object') return {};

  const result = {};
  for (const [pid, monthMap] of Object.entries(doc.value)) {
    if (!pid || typeof monthMap !== 'object') continue;
    const dayMap = monthMap[monthKey];
    if (!dayMap || typeof dayMap !== 'object') continue;
    const dates = [];
    for (const dayStr of Object.keys(dayMap)) {
      const d = Number(dayStr);
      if (!Number.isFinite(d) || d < 1 || d > 31) continue;
      dates.push(`${monthKey}-${String(d).padStart(2, '0')}`);
    }
    if (dates.length) result[pid] = dates;
  }
  return result;
}

// DB izin listesi (Array) ile payload override'larını (Array | Set) birleştirir.
// Her iki kaynak da union'a girer — payload DB'yi ezmez, ikisi toplanır.
// Sonuç: { [personId]: Set<"YYYY-MM-DD"> } — constraints.js Set.has() ile çalışır.
function mergeLeavesByPerson(dbLeaves, payloadLeaves) {
  const result = {};
  const allPids = new Set([
    ...Object.keys(dbLeaves),
    ...Object.keys(payloadLeaves || {}),
  ]);
  for (const pid of allPids) {
    const dbDates  = dbLeaves[pid] || [];
    const pay      = payloadLeaves?.[pid];
    const payDates = pay instanceof Set ? [...pay]
                   : Array.isArray(pay) ? pay
                   : [];
    result[pid] = new Set([...dbDates, ...payDates]);
  }
  return result;
}

async function generateSchedule({ sectionId, serviceId = '', role = '', year, month, dryRun = false, userId, payload = {}, hospitalId = null }) {
  const query = hospitalId ? { hospitalId, sectionId, year, month } : { sectionId, year, month };
  if (serviceId) query.serviceId = serviceId;
  if (role) query.role = role;
  const scheduleDoc = await MonthlySchedule.findOne(query).select(MONTHLY_SCHEDULER_INPUT_PROJECTION).lean();
  const holidays = await listHolidays({ year, month, hospitalId });
  const {
    effectiveDefs,
    effectiveOverrides,
    effectiveShiftOptions,
    days,
    holidayKindByDate,
    shiftMetaByCode,
  } = buildSchedulerInput({
    scheduleDoc,
    payload,
    year,
    month,
    hospitalId,
    holidays,
  });

  if (!days || !days.length) {
    throw new Error('Vardiya şablonu bulunamadı (MonthlySchedule.data.defs bekleniyor).');
  }

  const effectiveDays = applyHolidayPolicies({ days, holidayKindByDate, shiftMetaByCode });

  const staffPack = Array.isArray(payload.staff) && payload.staff.length
    ? await hydratePayloadStaffFromDb(payload.staff, hospitalId)
    : await resolveStaff({ serviceId, role, hospitalId });
  const staff = staffPack.staff;

  const dbLeaves = await buildLeavesByPersonFromDb({ serviceId, year, month, hospitalId });
  const leavesByPerson = mergeLeavesByPerson(dbLeaves, payload.leavesByPerson || {});
  const requestsByPerson = payload.requestsByPerson || {};

  const staffCount = Array.isArray(staff) ? staff.length : 0;
  const totalSlots = Array.isArray(effectiveDays)
    ? effectiveDays.reduce(
        (sum, d) => sum + (d.shifts || []).reduce((s, sh) => s + (Number(sh.requiredCount || 0) || 0), 0),
        0
      )
    : 0;
  const totalHoursCalc = Array.isArray(effectiveDays)
    ? effectiveDays.reduce(
        (sum, d) =>
          sum +
          (d.shifts || []).reduce((s, sh) => {
            const need = Number(sh.requiredCount || 0) || 0;
            const hours = Number(sh.hours || 0) || 0;
            return s + need * hours;
          }, 0),
        0
      )
    : 0;

  const targetHours =
    Number(payload.targetHours || 0) > 0
      ? Number(payload.targetHours || 0)
      : staffCount > 0 && totalHoursCalc > 0
      ? totalHoursCalc / staffCount
      : 0;
  const targetShifts =
    Number(payload.targetShifts || 0) > 0
      ? Number(payload.targetShifts || 0)
      : staffCount > 0 && totalSlots > 0
      ? totalSlots / staffCount
      : 0;

  const engineMode = String(payload.engine || payload.mode || '').toLowerCase();
  const useDraft = engineMode === 'draft';

  const { doc: ruleDoc, rules: dbRules, weights: dbWeights } = await fetchDutyRules({ sectionId, serviceId, role, hospitalId });
  const rules = { ...dbRules, ...(payload.rules || {}) };
  const weights = { ...dbWeights, ...(payload.weights || {}) };

  let context = null;
  let draftResult = null;
  if (useDraft) {
    draftResult = generateDraftRoster({
      year,
      month,
      rows: effectiveDefs,
      overrides: effectiveOverrides,
      staff,
      leavesByPerson,
      pins: Array.isArray(payload.pins) ? payload.pins : [],
      supervisorConfig: payload.supervisorConfig || {},
      supervisorPool: payload.supervisorPool || [],
      leavePolicy: payload.leavePolicy || "hard",
      requireEligibility: payload.requireEligibility !== false,
      nightCodes: payload.nightShiftCodes || null,
      shiftOptions: effectiveShiftOptions,
    });
  } else {
    context = await generateMonthlyPlan({
      year,
      month,
      getActiveStaff: async () => staff,
      getMonthlyShifts: async () => effectiveDays,
      getLeaves: async () => leavesByPerson,
      getRequests: async () => requestsByPerson,
      ruleEngineDoc: ruleDoc || null,
      rules,
      weights,
      targetHours,
      targetShifts,
      debug: {
        logBlocks: payload?.debug?.logBlocks || process.env.SCHEDULER_DEBUG === '1',
      },
    });
  }

  const shiftCount = effectiveDays.reduce((sum, d) => sum + (d.shifts?.length || 0), 0);
  const requiredSlots = effectiveDays.reduce(
    (sum, d) => sum + (d.shifts || []).reduce((s, sh) => s + (Number(sh.requiredCount || 0) || 0), 0),
    0
  );

  const baseAssignmentsRaw = useDraft ? (draftResult?.assignments || []) : (context.assignments || []);
  const validated = validateAssignments({
    assignments: baseAssignmentsRaw,
    leavesByPerson,
    holidayKindByDate,
    shiftMetaByCode,
    defs: effectiveDefs,
    staff,
  });
  const data = buildGeneratedScheduleData({
    useDraft,
    draftResult,
    context,
    validated,
    days,
    staffPack,
    shiftCount,
    requiredSlots,
  });

  const quality = computeQualityScore({
    assignments:  data.assignments  || [],
    issues:       data.issues       || [],
    requiredSlots: Number(data.debug?.requiredSlots || requiredSlots || 0),
  });

  if (dryRun) {
    return { data, rules, weights, quality, sourceScheduleId: scheduleDoc?._id || null };
  }

  let persistedData = data;
  let doc = null;
  try {
    doc = await GeneratedSchedule.create(
      buildGeneratedSchedulePayload({
        hospitalId,
        sectionId,
        serviceId,
        role,
        year,
        month,
        scheduleDoc,
        data: persistedData,
        rules,
        weights,
        userId,
      })
    );
  } catch (error) {
    if (!isGeneratedPayloadTooLargeError(error)) throw error;

    const generatedWriteDiagnostic = buildGeneratedPayloadSizeDiagnostic(error);
    persistedData = attachGeneratedWriteDiagnostic(data, generatedWriteDiagnostic);
    doc = await GeneratedSchedule.create(
      buildGeneratedSchedulePayload({
        hospitalId,
        sectionId,
        serviceId,
        role,
        year,
        month,
        scheduleDoc,
        data: persistedData,
        rules,
        weights,
        userId,
      })
    );
  }

  // MonthlySchedule write-back intentionally stays assignment-only:
  // legacy monthly readers should not become explainability authorities.
  try {
    if (scheduleDoc?._id) {
      await MonthlySchedule.findByIdAndUpdate(
        scheduleDoc._id,
        { $set: buildMonthlyScheduleWriteback({ data: persistedData, existingRoster: scheduleDoc?.data?.roster }) },
        { new: true }
      );
    }
  } catch (e) {
    const monthlyWriteBackDiagnostic = buildMonthlyWriteBackDiagnostic(e);
    Object.assign(persistedData, attachMonthlyWriteBackDiagnostic(persistedData, monthlyWriteBackDiagnostic));
    console.warn('[scheduler] MonthlySchedule assignments yazma hatası:', e.message);
    try {
      if (doc?._id) {
        await GeneratedSchedule.findByIdAndUpdate(
          doc._id,
          { $set: { 'data.debug.monthlyWriteBack': monthlyWriteBackDiagnostic } },
          { new: false }
        );
      }
    } catch (persistErr) {
      console.warn('[scheduler] GeneratedSchedule monthlyWriteBack diagnostic yazma hatası:', persistErr?.message || persistErr);
    }
  }

  // Sync to Assignment collection (SSOT) so personal calendars stay consistent
  try {
    await replaceAssignmentsForSchedule({
      scope: {
        hospitalId,
        sectionId,
        serviceId,
        role,
        year,
        month,
        sourceScheduleId: scheduleDoc?._id || doc._id,
      },
      payload: { assignments: persistedData.assignments || [] },
      source: 'scheduler',
      createdBy: userId || null,
      updatedBy: userId || null,
    });
  } catch (syncErr) {
    console.warn('[scheduler] Assignment sync hatası:', syncErr?.message || syncErr);
  }

  return { data: persistedData, rules, weights, quality, generatedId: String(doc._id) };
}

module.exports = {
  generateSchedule,
  fetchDutyRules,
  DEFAULT_RULES,
  DEFAULT_WEIGHTS,
};
