// services/scheduler/engine.js
const { isAvailable } = require("./constraints");
const { calculateScore } = require("./scoring");
const { buildCandidates } = require("./candidateBuilder");
const evaluatePolicies = require("./policies/evaluatePolicies");
const {
  createShadowAuditCollector,
  collectShadowObservations,
  appendShadowObservations,
  recordShadowCollectionError,
  aggregateShadowObservations,
} = require("./audit");

// CandidateBuilder hard-reject fallback exclusion allowlist.
// Only blocking rule codes listed here remain authoritative when the engine
// falls back after an empty eligible pool.
const FALLBACK_BLOCKING_RULE_CODES = Object.freeze([
  "ACTIVE_REQUIRED",
  "SERVICE_MATCH",
  "LEAVE_BLOCK",
  "REST_AFTER_NIGHT",
  "MAX_WEEKLY_SHIFTS",
  "MAX_CONSECUTIVE_DAYS",
  "ONE_SHIFT_PER_DAY",
  "MIN_REST_HOURS",
]);

const getISOWeekKey = (dateStr) => {
  if (!dateStr) return null;
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const day = d.getUTCDay() || 7; // 1..7 (Mon..Sun)
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
};

const normalizeCode = (s) =>
  (s || "")
    .toString()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase()
    .trim();
const normalizePersonName = (s) =>
  (s || "")
    .toString()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();

const getShiftKey = (shift) =>
  normalizeCode(shift?.id || shift?.code || shift?.label || shift?.name || "");

const daysBetween = (a, b) => {
  if (!a || !b) return null;
  const da = new Date(`${a}T00:00:00Z`);
  const db = new Date(`${b}T00:00:00Z`);
  return Math.round((db - da) / (24 * 60 * 60 * 1000));
};

function assign(person, day, shift, context) {
  if (!person || !day || !shift) return;
  const hours = Number(shift.hours || context.defaultShiftHours || 0);

  applyAssignmentStateMutation({ person, day, shift, hours });
  appendAssignedPersonToShift({ person, shift });

  if (!context.assignments) context.assignments = [];
  context.assignments.push({
    date: day.date,
    weekday: day.weekday,
    shiftId: shift.id || shift.code || "",
    personId: person.id,
    personName: person.name || "",
    hours,
  });
}

// Runtime state authority point:
// scheduler counters and mutable per-person assignment state are updated here.
function applyAssignmentStateMutation({ person, day, shift, hours = 0 } = {}) {
  const safeHours = Number.isFinite(hours) ? hours : 0;

  person.totalHours = Number(person.totalHours || 0) + safeHours;
  person.totalShifts = Number(person.totalShifts || 0) + 1;

  if (!Array.isArray(person.assignedDays)) person.assignedDays = [];
  if (!person.assignedDays.includes(day.date)) person.assignedDays.push(day.date);

  const diff = daysBetween(person.lastAssignedDate, day.date);
  person.consecutiveDays = diff === 1 ? Number(person.consecutiveDays || 0) + 1 : 1;
  person.lastAssignedDate = day.date;

  const weekKey = getISOWeekKey(day.date);
  if (weekKey) {
    if (!person.weeklyCounts) person.weeklyCounts = {};
    person.weeklyCounts[weekKey] = Number(person.weeklyCounts[weekKey] || 0) + 1;
  }

  const weekday = Number(day.weekday ?? -1);
  if (!person.weekdayCount) person.weekdayCount = {};
  if (weekday >= 0 && weekday <= 6) {
    person.weekdayCount[weekday] = Number(person.weekdayCount[weekday] || 0) + 1;
  }

  const taskKey = getShiftKey(shift);
  if (taskKey) {
    if (!person.taskCounts) person.taskCounts = {};
    person.taskCounts[taskKey] = Number(person.taskCounts[taskKey] || 0) + 1;
  }

  person.lastShift = {
    date: day.date,
    code: shift.code || shift.id || "",
    start: shift.start || null,
    end: shift.end || null,
    isNight: !!shift.isNight,
  };
}

function appendAssignedPersonToShift({ person, shift } = {}) {
  if (!person || !shift) return;

  if (!person.pairHistory) person.pairHistory = {};
  if (!shift.assignedPersons) shift.assignedPersons = [];

  // Pair history: selected with already assigned in this shift.
  for (const other of shift.assignedPersons) {
    if (!other?.id) continue;
    const key1 = `${person.id}-${other.id}`;
    const key2 = `${other.id}-${person.id}`;
    person.pairHistory[key1] = Number(person.pairHistory[key1] || 0) + 1;
    if (!other.pairHistory) other.pairHistory = {};
    other.pairHistory[key2] = Number(other.pairHistory[key2] || 0) + 1;
  }

  shift.assignedPersons.push({ id: person.id, name: person.name || "" });
}

function runScheduler(context) {
  if (!context || !Array.isArray(context.days) || !Array.isArray(context.staff)) return context;
  if (!Array.isArray(context.candidateAudit)) context.candidateAudit = [];
  if (!context.audit || typeof context.audit !== "object" || Array.isArray(context.audit)) {
    context.audit = {};
  }
  if (!Array.isArray(context.audit.observations)) context.audit.observations = [];
  const shadowAuditEnabled = context?.auditOptions?.enableShadowCollection === true;
  if (shadowAuditEnabled && !context.shadowAudit) {
    context.shadowAudit = createShadowAuditCollector({
      ruleCodes: context?.auditOptions?.shadowRuleCodes,
    });
  }

  for (const day of context.days) {
    const usedOnDay = new Set();
    const usedNamesOnDay = new Set();
    if (!day || !Array.isArray(day.shifts)) continue;
    for (const shift of day.shifts) {
      const need = Math.max(1, Number(shift.requiredCount || 1));
      if (!shift.assignedPersons) shift.assignedPersons = [];

      for (let i = 0; i < need; i++) {
        const rawStaffPool = buildRawStaffPoolForSlot(context.staff, usedOnDay, usedNamesOnDay);
        const candidateBuild = buildEligiblePoolForSlot({
          rawStaffPool,
          day,
          shift,
          context,
          slotIndex: i,
        });
        if (shadowAuditEnabled) {
          appendShadowObservations(context.shadowAudit, candidateBuild.shadowObservations);
          if (candidateBuild.shadowError) {
            recordShadowCollectionError(context.shadowAudit, candidateBuild.shadowError, {
              date: day?.date || null,
              shiftCode: shift?.code || shift?.id || null,
              slotIndex: i,
            });
          }
        }

        const selectionStage = buildSelectionStage({
          candidateBuild,
          day,
          shift,
          context,
        });

        const constraintRejected = buildConstraintRejectedEntries(
          selectionStage.postConstraintResult?.blockedCandidates
        );
        const slotAudit = {
          ...selectionStage.audit,
          constraintRejectedCount: constraintRejected.length,
          constraintRejectedByReason: summarizeConstraintRejections(constraintRejected),
          observationSummary: buildSlotObservationSummary({
            date: day?.date || null,
            shift,
            slotIndex: i,
            inputStaffCount: candidateBuild.audit?.inputStaffCount || rawStaffPool.length,
            candidateAudit: selectionStage.audit,
            postConstraintCount: selectionStage.postConstraintPool.length,
            constraintRejected,
          }),
        };

        logSlotDebug({
          day,
          shift,
          slotIndex: i,
          rawStaffPool,
          candidateBuild,
          selectionStage,
          slotAudit,
        });

        if (!selectionStage.postConstraintPool.length) {
          context.candidateAudit.push(slotAudit);
          context.audit.observations.push({
            ...slotAudit.observationSummary,
            selectedCandidateId: null,
            selectedCandidateName: null,
            selectionReason: null,
            topCandidates: [],
            noCandidateReasonSummary: buildNoCandidateReasonSummary(slotAudit),
          });
          break;
        }

        const selectedAudit = {
          ...slotAudit,
          selectedCandidate: selectionStage.selectedCandidate?.person
            ? {
                id: normalizePersonId(selectionStage.selectedCandidate.person.id),
                name: selectionStage.selectedCandidate.person.name || "",
              }
            : null,
        };

        context.candidateAudit.push(selectedAudit);
        context.audit.observations.push({
          ...slotAudit.observationSummary,
          selectedCandidateId: normalizePersonId(selectionStage.selectedCandidate?.id),
          selectedCandidateName: selectionStage.selectedCandidate?.person?.name || "",
          selectionReason: selectionStage.audit?.selectionReason || null,
          topCandidates: Array.isArray(selectionStage.audit?.topCandidates)
            ? selectionStage.audit.topCandidates
            : [],
          noCandidateReasonSummary: null,
        });
        assign(selectionStage.selectedCandidate?.person, day, shift, context);
        if (selectionStage.selectedCandidate?.id) {
          usedOnDay.add(selectionStage.selectedCandidate.id);
        }
        const selectedName = normalizePersonName(selectionStage.selectedCandidate?.person?.name || "");
        if (selectedName) usedNamesOnDay.add(selectedName);
      }

      if (shift.assignedPersons.length < need) {
        recordNoCandidateIssue({
          context,
          day,
          shift,
          missing: need - shift.assignedPersons.length,
        });
      }
    }
  }

  if (shadowAuditEnabled && context?.shadowAudit) {
    context.shadowAudit.summary = aggregateShadowObservations(context.shadowAudit.observations);
  }
  context.audit.summary = buildObservationSummary(context.audit.observations);

  return context;
}

function logSlotDebug({
  day = null,
  shift = null,
  slotIndex = 0,
  rawStaffPool = [],
  candidateBuild = null,
  selectionStage = null,
  slotAudit = null,
} = {}) {
  const totalStaff = Array.isArray(rawStaffPool) ? rawStaffPool.length : 0;
  const eligibleAfterBuilder = Array.isArray(selectionStage?.candidateBuilderEligiblePool)
    ? selectionStage.candidateBuilderEligiblePool.length
    : 0;
  const afterConstraints = Array.isArray(selectionStage?.postConstraintPool)
    ? selectionStage.postConstraintPool.length
    : 0;
  const rejectedByReason =
    slotAudit?.constraintRejectedByReason && typeof slotAudit.constraintRejectedByReason === "object"
      ? slotAudit.constraintRejectedByReason
      : {};
  const payload = {
    date: day?.date || null,
    shift: shift?.code || shift?.id || shift?.label || shift?.name || null,
    slotIndex,
    totalStaff,
    eligibleAfterBuilder,
    afterConstraints,
    fallbackUsed: candidateBuild?.audit?.fallbackUsed === true,
    fallbackReason: candidateBuild?.audit?.fallbackReason || null,
  };

  if (payload.fallbackUsed) {
    payload.fallbackAfterBuilder = Array.isArray(candidateBuild?.pool) ? candidateBuild.pool.length : 0;
  }

  if (afterConstraints === 0 || Object.keys(rejectedByReason).length) {
    payload.rejectedByReason = rejectedByReason;
  }
}

function buildRawStaffPoolForSlot(staff = [], usedOnDay = new Set(), usedNamesOnDay = new Set()) {
  return (Array.isArray(staff) ? staff : []).filter((person) => {
    if (usedOnDay.has(person.id)) return false;
    const personName = normalizePersonName(person?.name || person?.fullName || "");
    if (personName && usedNamesOnDay.has(personName)) return false;
    return true;
  });
}

function buildEligiblePoolForSlot({ rawStaffPool = [], day = null, shift = null, context = null, slotIndex = 0 } = {}) {
  const fallbackPool = Array.isArray(rawStaffPool) ? rawStaffPool : [];
  const baseAudit = {
    date: day?.date || null,
    shiftId: shift?.id || shift?.code || "",
    slotIndex,
    inputStaffCount: fallbackPool.length,
    eligibleCount: 0,
    rejectedCount: 0,
    fallbackUsed: false,
    fallbackReason: null,
    hardFilteredByCandidateBuilderCount: 0,
    hardFilteredBlockingRules: {},
    sectionEligibilityCheckedCount: 0,
    sectionEligibilityHardRejectCount: 0,
    sectionEligibilityPassCount: 0,
    rejected: [],
  };
  const shadowResult = collectSlotShadowObservations({
    rawStaffPool: fallbackPool,
    day,
    shift,
    context,
  });

  if (!fallbackPool.length) {
    return {
      pool: [],
      audit: baseAudit,
      shadowObservations: shadowResult.observations,
      shadowError: shadowResult.error,
    };
  }

  try {
    const candidateResult = buildCandidates({
      staff: fallbackPool,
      day,
      shift,
      section: shift?.section ?? day?.section ?? null,
      serviceId: shift?.serviceId ?? day?.serviceId ?? null,
      schedulerContext: {
        leavesByPerson: context?.leavesByPerson || {},
        assignments: context?.assignments || [],
        rules: context?.rules || [],
      },
      assignmentState: {
        assignments: context?.assignments || [],
      },
      ruleCodes: Array.isArray(context?.candidateRuleCodes) ? context.candidateRuleCodes : null,
      options: context?.candidateBuilderOptions || {},
    });

	    const eligiblePeople = extractEligiblePeople(candidateResult);
	    const rejected = Array.isArray(candidateResult?.rejected) ? candidateResult.rejected : [];
	    const fallbackPoolAfterHardFilter = filterFallbackPoolByHardBlocks(fallbackPool, rejected, context);
	    const sectionEligibilityMetrics = buildSectionEligibilityMetrics(candidateResult);
      const softSignalMetrics = buildSoftSignalMetrics(candidateResult);
	    const audit = buildCandidateBuilderAuditEntry({
	      baseAudit,
	      fallbackPool,
	      fallbackPoolAfterHardFilter,
	      eligiblePeople,
	      rejected,
	      sectionEligibilityMetrics,
        softSignalMetrics,
	      context,
	    });

    if (eligiblePeople.length) {
      return {
        pool: eligiblePeople,
        audit,
        shadowObservations: shadowResult.observations,
        shadowError: shadowResult.error,
      };
    }

    // Controlled fallback: keep scheduler running if builder has no eligible output for this slot.
    return {
      pool: fallbackPoolAfterHardFilter,
      audit: {
        ...audit,
        ...buildFallbackAuditSummary({
          fallbackUsed: true,
          fallbackReason: "NO_ELIGIBLE_FROM_CANDIDATE_BUILDER",
        }),
      },
      shadowObservations: shadowResult.observations,
      shadowError: shadowResult.error,
    };
  } catch (error) {
    // Controlled fallback: any builder runtime error falls back to the existing raw pool.
    return {
      pool: fallbackPool,
      audit: {
        ...baseAudit,
        ...buildFallbackAuditSummary({
          fallbackUsed: true,
          fallbackReason: "CANDIDATE_BUILDER_ERROR",
          error: error?.message || "Unknown candidate builder error",
        }),
      },
      shadowObservations: shadowResult.observations,
      shadowError: shadowResult.error,
    };
  }
}

function buildSelectionStage({ candidateBuild = null, day = null, shift = null, context = null } = {}) {
  const candidateBuilderEligiblePool = Array.isArray(candidateBuild?.pool) ? candidateBuild.pool : [];
  const postConstraintResult = buildPostConstraintPool({
    candidatePool: candidateBuilderEligiblePool,
    day,
    shift,
    context,
  });
  const postConstraintPool = Array.isArray(postConstraintResult?.pool) ? postConstraintResult.pool : [];
  const scoredCandidates = scoreCandidatesForSelection({
    candidatePool: postConstraintPool,
    day,
    shift,
    context,
  });
  const selectedCandidate = selectCandidateFromScoredPool(scoredCandidates);

  return {
    rawPoolCount: Number(candidateBuild?.audit?.inputStaffCount || 0),
    candidateBuilderEligiblePool,
    postConstraintResult,
    postConstraintPool,
    scoredCandidates,
    selectedCandidate,
    audit: buildCandidateAuditEntry({
      candidateBuildAudit: candidateBuild?.audit || {},
      candidateBuilderEligiblePool,
      postConstraintResult,
      postConstraintPool,
      scoredCandidates,
      selectedCandidate,
    }),
  };
}

function buildPostConstraintPool({ candidatePool = [], day = null, shift = null, context = null } = {}) {
  const pool = [];
  const blockingRules = {};
  const blockedCandidates = [];

  for (const person of Array.isArray(candidatePool) ? candidatePool : []) {
    const collectedBlocks = [];
    const runtimeGuardContext = attachRuntimeGuardCollector(context, (code, meta) => {
      collectedBlocks.push({
        code: normalizeRuleCode(code),
        meta: meta && typeof meta === "object" ? { ...meta } : {},
      });
    });

    if (isAvailable(person, day, runtimeGuardContext, shift)) {
      pool.push(person);
      continue;
    }

    const dedupedBlockingRules = dedupeRuleCodes(
      collectedBlocks
        .map((item) => item?.code)
        .filter(Boolean)
    );

    for (const code of dedupedBlockingRules) {
      blockingRules[code] = Number(blockingRules[code] || 0) + 1;
    }

    blockedCandidates.push({
      personId: normalizePersonId(person?.id || person?._id || person?.personId),
      blockingRules: dedupedBlockingRules,
    });
  }

  return {
    pool,
    blockedCount: blockedCandidates.length,
    blockingRules,
    blockedCandidates,
  };
}

function scoreCandidatesForSelection({ candidatePool = [], day = null, shift = null, context = null } = {}) {
  const scoredCandidates = (Array.isArray(candidatePool) ? candidatePool : []).map((candidate) => {
    const policyResult = evaluatePolicies({ person: candidate }, context);
    return {
      id: candidate?.id,
      person: candidate,
      policyScore: Number(policyResult?.totalScore || 0),
      policyBreakdown: Array.isArray(policyResult?.policies) ? policyResult.policies : [],
      schedulerScore: calculateScore(candidate, day, shift, context),
    };
  });

  scoredCandidates.sort((a, b) => {
    const schedulerDiff = Number(a.schedulerScore || 0) - Number(b.schedulerScore || 0);
    if (schedulerDiff !== 0) return schedulerDiff;
    return Number(b.policyScore || 0) - Number(a.policyScore || 0);
  });

  return scoredCandidates;
}

function selectCandidateFromScoredPool(scoredCandidates = []) {
  if (!Array.isArray(scoredCandidates) || !scoredCandidates.length) return null;
  return scoredCandidates[0];
}

function buildCandidateBuilderAuditEntry({
  baseAudit = {},
  fallbackPool = [],
  fallbackPoolAfterHardFilter = [],
  eligiblePeople = [],
  rejected = [],
  sectionEligibilityMetrics = {},
  softSignalMetrics = {},
  context = null,
} = {}) {
  return {
    ...baseAudit,
    eligibleCount: Array.isArray(eligiblePeople) ? eligiblePeople.length : 0,
    rejectedCount: Array.isArray(rejected) ? rejected.length : 0,
    hardFilteredByCandidateBuilderCount:
      Math.max(0, Number(fallbackPool.length || 0) - Number(fallbackPoolAfterHardFilter.length || 0)),
    hardFilteredBlockingRules: summarizeBlockingRules(rejected, context),
    roleEligibilityHardRejectCount: countHardRejectedByRule(rejected, "ROLE_ELIGIBILITY"),
    sectionEligibilityCheckedCount: Number(sectionEligibilityMetrics?.checkedCount || 0),
    sectionEligibilityHardRejectCount: Number(sectionEligibilityMetrics?.hardRejectCount || 0),
    sectionEligibilityPassCount: Number(sectionEligibilityMetrics?.passCount || 0),
    eligibleSoftSignalCount: Number(softSignalMetrics?.count || 0),
    eligibleSoftSignalRules:
      softSignalMetrics?.rules && typeof softSignalMetrics.rules === "object"
        ? { ...softSignalMetrics.rules }
        : {},
    rejected: buildRejectedCandidateSummary(rejected),
  };
}

function buildFallbackAuditSummary({ fallbackUsed = false, fallbackReason = null, error = null } = {}) {
  return {
    fallbackUsed: fallbackUsed === true,
    fallbackReason: fallbackReason || null,
    ...(error ? { error } : {}),
  };
}

function buildCandidateAuditEntry({
  candidateBuildAudit = {},
  candidateBuilderEligiblePool = [],
  postConstraintResult = {},
  postConstraintPool = [],
  scoredCandidates = [],
  selectedCandidate = null,
} = {}) {
  return {
    ...candidateBuildAudit,
    ...buildSelectionExplainability({
      candidateBuilderEligiblePool,
      postConstraintResult,
      postConstraintPool,
      scoredCandidates,
      selectedCandidate,
    }),
  };
}

function buildSelectionExplainability({
  candidateBuilderEligiblePool = [],
  postConstraintResult = {},
  postConstraintPool = [],
  scoredCandidates = [],
  selectedCandidate = null,
} = {}) {
  return {
    candidateBuilderEligibleCount: Array.isArray(candidateBuilderEligiblePool)
      ? candidateBuilderEligiblePool.length
      : 0,
    postConstraintCount: Array.isArray(postConstraintPool) ? postConstraintPool.length : 0,
    runtimeGuardBlockedCount: Number(postConstraintResult?.blockedCount || 0),
    runtimeGuardBlockingRules:
      postConstraintResult?.blockingRules && typeof postConstraintResult.blockingRules === "object"
        ? { ...postConstraintResult.blockingRules }
        : {},
    scoredCandidateCount: Array.isArray(scoredCandidates) ? scoredCandidates.length : 0,
    selectedCandidateId: normalizePersonId(selectedCandidate?.id),
    selectedSchedulerScore: Number(selectedCandidate?.schedulerScore || 0),
    selectedPolicyScore: Number(selectedCandidate?.policyScore || 0),
    selectedPolicyBreakdown: Array.isArray(selectedCandidate?.policyBreakdown)
      ? selectedCandidate.policyBreakdown.map(clonePolicyResult)
      : [],
    selectionReason: determineSelectionReason(scoredCandidates),
    topCandidates: buildTopCandidateSummary(scoredCandidates, selectedCandidate?.id),
  };
}

function collectSlotShadowObservations({ rawStaffPool = [], day = null, shift = null, context = null } = {}) {
  if (context?.auditOptions?.enableShadowCollection !== true) {
    return { observations: [], error: null };
  }

  try {
    return {
      observations: collectShadowObservations({
        staff: rawStaffPool,
        day,
        shift,
        section: shift?.section ?? day?.section ?? null,
        serviceId: shift?.serviceId ?? day?.serviceId ?? null,
        schedulerContext: {
          leavesByPerson: context?.leavesByPerson || {},
          assignments: context?.assignments || [],
          rules: context?.rules || [],
        },
        assignmentState: {
          assignments: context?.assignments || [],
        },
        ruleCodes: context?.auditOptions?.shadowRuleCodes,
        options: context?.auditOptions?.shadowOptions || null,
      }),
      error: null,
    };
  } catch (error) {
    return {
      observations: [],
      error,
    };
  }
}

function extractEligiblePeople(candidateResult) {
  if (Array.isArray(candidateResult?.candidates) && candidateResult.candidates.length) {
    return candidateResult.candidates.filter(Boolean);
  }

  if (!Array.isArray(candidateResult?.eligible)) return [];
  return candidateResult.eligible
    .map((item) => item?.person || null)
    .filter(Boolean);
}

function filterFallbackPoolByHardBlocks(fallbackPool, rejected, context) {
  const safePool = Array.isArray(fallbackPool) ? fallbackPool : [];
  const blockedRules = getFallbackBlockingRuleCodes(context);
  if (!safePool.length || blockedRules.size === 0) return safePool;

  const blockedPersonIds = new Set();
  for (const item of rejected || []) {
    if (!item?.hardRejected || !Array.isArray(item?.blockingRules)) continue;
    const hasBlockingRule = item.blockingRules.some((code) => blockedRules.has(String(code).trim()));
    if (!hasBlockingRule) continue;
    const personId = normalizePersonId(item?.personId || item?.person?.id || item?.person?._id);
    if (personId) blockedPersonIds.add(personId);
  }

  if (!blockedPersonIds.size) return safePool;
  return safePool.filter((person) => !blockedPersonIds.has(normalizePersonId(person?.id || person?._id || person?.personId)));
}

function summarizeBlockingRules(rejected, context) {
  const blockedRules = getFallbackBlockingRuleCodes(context);
  const counts = {};

  for (const item of rejected || []) {
    if (!item?.hardRejected || !Array.isArray(item?.blockingRules)) continue;
    for (const code of item.blockingRules) {
      const normalizedCode = String(code || "").trim();
      if (!normalizedCode || !blockedRules.has(normalizedCode)) continue;
      counts[normalizedCode] = Number(counts[normalizedCode] || 0) + 1;
    }
  }

  return counts;
}

function getFallbackBlockingRuleCodes(context) {
  const configured = context?.candidateBuilderOptions?.fallbackBlockingRuleCodes;
  const source = Array.isArray(configured) && configured.length
    ? configured.slice()
    : Array.from(FALLBACK_BLOCKING_RULE_CODES);

  if (context?.candidateBuilderOptions?.strictRoleEligibility === true) {
    source.push("ROLE_ELIGIBILITY");
  }

  if (context?.candidateBuilderOptions?.strictSectionEligibility === true) {
    source.push("SECTION_ELIGIBILITY");
  }

  if (Array.isArray(context?.candidateBuilderOptions?.strictCandidateHardRules)) {
    source.push(...context.candidateBuilderOptions.strictCandidateHardRules);
  }

  return new Set(
    source
      .map((item) => String(item || "").trim())
      .filter(Boolean)
  );
}

function normalizePersonId(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function buildRejectedCandidateSummary(rejected = []) {
  return (Array.isArray(rejected) ? rejected : []).map((item) => ({
    personId: item?.personId || null,
    failedRuleCodes: Array.isArray(item?.failedRules)
      ? item.failedRules.map((rule) => rule?.code).filter(Boolean)
      : [],
    hardRejected: item?.hardRejected === true,
    blockingRules: Array.isArray(item?.blockingRules) ? item.blockingRules.filter(Boolean) : [],
    reasonCodes: Array.isArray(item?.reasonCodes) ? item.reasonCodes.filter(Boolean) : [],
  }));
}

function buildSoftSignalMetrics(candidateResult = null) {
  const counts = {};
  let totalCount = 0;

  for (const item of Array.isArray(candidateResult?.eligible) ? candidateResult.eligible : []) {
    for (const failedRule of Array.isArray(item?.failedRules) ? item.failedRules : []) {
      const severity = String(failedRule?.severity || "").trim().toLowerCase();
      const code = normalizeRuleCode(failedRule?.code);
      if (!code || severity === "hard" || severity === "error") continue;
      counts[code] = Number(counts[code] || 0) + 1;
      totalCount += 1;
    }
  }

  return {
    count: totalCount,
    rules: counts,
  };
}

function attachRuntimeGuardCollector(context, collectBlock) {
  const baseContext = context && typeof context === "object" ? context : {};
  const baseDebug =
    baseContext.debug && typeof baseContext.debug === "object" && !Array.isArray(baseContext.debug)
      ? baseContext.debug
      : {};

  return {
    ...baseContext,
    debug: {
      ...baseDebug,
      collectBlock,
    },
  };
}

function normalizeRuleCode(code) {
  if (code == null) return null;
  const normalized = String(code).trim();
  return normalized || null;
}

function dedupeRuleCodes(codes = []) {
  const out = [];
  const seen = new Set();
  for (const code of codes) {
    const normalized = normalizeRuleCode(code);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function countHardRejectedByRule(rejected, ruleCode) {
  const normalizedRuleCode = String(ruleCode || "").trim();
  if (!normalizedRuleCode) return 0;

  let count = 0;
  for (const item of rejected || []) {
    if (!item?.hardRejected || !Array.isArray(item?.blockingRules)) continue;
    if (item.blockingRules.some((code) => String(code || "").trim() === normalizedRuleCode)) {
      count += 1;
    }
  }
  return count;
}

function buildSectionEligibilityMetrics(candidateResult) {
  const evaluations = Array.isArray(candidateResult?.evaluations) ? candidateResult.evaluations : [];
  let checkedCount = 0;
  let hardRejectCount = 0;
  let passCount = 0;

  for (const item of evaluations) {
    const hasSectionResult = Array.isArray(item?.ruleResults)
      && item.ruleResults.some((rule) => rule?.code === "SECTION_ELIGIBILITY");
    if (!hasSectionResult) continue;

    checkedCount += 1;
    const blockedBySection = item?.hardRejected === true
      && Array.isArray(item?.blockingRules)
      && item.blockingRules.some((code) => String(code || "").trim() === "SECTION_ELIGIBILITY");

    if (blockedBySection) {
      hardRejectCount += 1;
    } else {
      passCount += 1;
    }
  }

  return {
    checkedCount,
    hardRejectCount,
    passCount,
  };
}

function determineSelectionReason(scoredCandidates = []) {
  if (!Array.isArray(scoredCandidates) || scoredCandidates.length <= 1) {
    return "ONLY_ELIGIBLE_CANDIDATE";
  }

  const [first, second] = scoredCandidates;
  const firstSchedulerScore = Number(first?.schedulerScore || 0);
  const secondSchedulerScore = Number(second?.schedulerScore || 0);
  if (firstSchedulerScore !== secondSchedulerScore) {
    return "SCHEDULER_PRIMARY";
  }

  const firstPolicyScore = Number(first?.policyScore || 0);
  const secondPolicyScore = Number(second?.policyScore || 0);
  if (firstPolicyScore !== secondPolicyScore) {
    return "POLICY_TIE_BREAK";
  }

  return "ID_TIE_BREAK";
}

function buildTopCandidateSummary(scoredCandidates = [], selectedId = null) {
  return (Array.isArray(scoredCandidates) ? scoredCandidates : [])
    .slice(0, 3)
    .map((candidate) => ({
      personId: normalizePersonId(candidate?.id),
      schedulerScore: Number(candidate?.schedulerScore || 0),
      policyScore: Number(candidate?.policyScore || 0),
      totalScore: Number(candidate?.policyScore || 0) + Number(candidate?.schedulerScore || 0),
      selected: normalizePersonId(candidate?.id) === normalizePersonId(selectedId),
    }));
}

function summarizeConstraintRejections(constraintRejected = []) {
  const counts = {};
  for (const item of constraintRejected || []) {
    const reason = String(item?.reason || "").trim();
    if (!reason) continue;
    counts[reason] = Number(counts[reason] || 0) + 1;
  }
  return counts;
}

function buildConstraintRejectedEntries(blockedCandidates = []) {
  const entries = [];
  for (const item of blockedCandidates || []) {
    const personId = normalizePersonId(item?.personId);
    const rules = Array.isArray(item?.blockingRules) ? item.blockingRules : [];
    if (!rules.length) {
      entries.push({
        personId,
        personName: "",
        reason: "UNAVAILABLE",
      });
      continue;
    }
    for (const rule of rules) {
      entries.push({
        personId,
        personName: "",
        reason: normalizeRuleCode(rule) || "UNAVAILABLE",
      });
    }
  }
  return entries;
}

function summarizeCandidateBuilderRejections(rejected = []) {
  const counts = {};
  for (const item of rejected || []) {
    const reasons = []
      .concat(Array.isArray(item?.blockingRules) ? item.blockingRules : [])
      .concat(Array.isArray(item?.reasonCodes) ? item.reasonCodes : [])
      .concat(Array.isArray(item?.failedRuleCodes) ? item.failedRuleCodes : []);
    for (const reason of reasons) {
      const key = String(reason || "").trim();
      if (!key) continue;
      counts[key] = Number(counts[key] || 0) + 1;
    }
  }
  return counts;
}

function buildSlotObservationSummary({
  date = null,
  shift = null,
  slotIndex = 0,
  inputStaffCount = 0,
  candidateAudit = {},
  postConstraintCount = 0,
  constraintRejected = [],
} = {}) {
  return {
    date,
    shiftId: shift?.id || shift?.code || "",
    shiftLabel: shift?.label || shift?.name || shift?.code || shift?.id || "",
    slotIndex,
    totalCandidates: Number(inputStaffCount || 0),
    candidateBuilderEligibleCount: Number(candidateAudit?.eligibleCount || 0),
    eligibleCandidates: Number(postConstraintCount || 0),
    candidateBuilderRejectedByReason: summarizeCandidateBuilderRejections(candidateAudit?.rejected),
    constraintRejectedByReason: summarizeConstraintRejections(constraintRejected),
    fallbackUsed: candidateAudit?.fallbackUsed === true,
    fallbackReason: candidateAudit?.fallbackReason || null,
  };
}

function buildNoCandidateReasonSummary(slotAudit = {}) {
  const builderReasons = summarizeCandidateBuilderRejections(slotAudit?.rejected);
  const constraintReasons = slotAudit?.constraintRejectedByReason || {};
  return {
    candidateBuilder: builderReasons,
    constraints: constraintReasons,
    fallbackUsed: slotAudit?.fallbackUsed === true,
    fallbackReason: slotAudit?.fallbackReason || null,
  };
}

function buildObservationSummary(observations = []) {
  const safe = Array.isArray(observations) ? observations : [];
  const selectionReasons = {};
  const rejectedByReason = {};
  let noCandidateCount = 0;

  for (const item of safe) {
    if (!item?.selectedCandidateId) noCandidateCount += 1;
    const selectionReason = String(item?.selectionReason || "").trim();
    if (selectionReason) {
      selectionReasons[selectionReason] = Number(selectionReasons[selectionReason] || 0) + 1;
    }

    const sources = [
      item?.candidateBuilderRejectedByReason,
      item?.constraintRejectedByReason,
    ];
    for (const source of sources) {
      for (const [reason, count] of Object.entries(source || {})) {
        if (!reason) continue;
        rejectedByReason[reason] = Number(rejectedByReason[reason] || 0) + Number(count || 0);
      }
    }
  }

  return {
    slotCount: safe.length,
    noCandidateCount,
    selectedCount: safe.length - noCandidateCount,
    selectionReasons,
    rejectedByReason,
  };
}

function clonePolicyResult(policyResult) {
  return {
    name: policyResult?.name || policyResult?.policy || "UNKNOWN_POLICY",
    policy: policyResult?.policy || policyResult?.name || "UNKNOWN_POLICY",
    score: Number(policyResult?.score || 0),
    reason: policyResult?.reason ?? null,
    meta:
      policyResult?.meta && typeof policyResult.meta === "object" && !Array.isArray(policyResult.meta)
        ? { ...policyResult.meta }
        : {},
  };
}

function recordNoCandidateIssue({ context = null, day = null, shift = null, missing = 0 } = {}) {
  if (!context) return;
  if (!context.issues) context.issues = [];
  context.issues.push({
    date: day?.date || null,
    shiftId: shift?.id || shift?.code || "",
    missing: Number(missing || 0),
    reason: "NO_CANDIDATE",
  });
}

module.exports = { runScheduler, assign };
