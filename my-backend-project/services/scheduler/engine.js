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

const FALLBACK_BLOCKING_RULE_CODES = Object.freeze(["ACTIVE_REQUIRED", "SERVICE_MATCH", "LEAVE_BLOCK", "REST_AFTER_NIGHT"]);

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

  person.totalHours = Number(person.totalHours || 0) + (Number.isFinite(hours) ? hours : 0);
  person.totalShifts = Number(person.totalShifts || 0) + 1;
  if (!Array.isArray(person.assignedDays)) person.assignedDays = [];
  if (!person.assignedDays.includes(day.date)) person.assignedDays.push(day.date);

  const diff = daysBetween(person.lastAssignedDate, day.date);
  person.consecutiveDays = diff === 1 ? Number(person.consecutiveDays || 0) + 1 : 1;
  person.lastAssignedDate = day.date;

  const wk = getISOWeekKey(day.date);
  if (wk) {
    if (!person.weeklyCounts) person.weeklyCounts = {};
    person.weeklyCounts[wk] = Number(person.weeklyCounts[wk] || 0) + 1;
  }

  const wd = Number(day.weekday ?? -1);
  if (!person.weekdayCount) person.weekdayCount = {};
  if (wd >= 0 && wd <= 6) {
    person.weekdayCount[wd] = Number(person.weekdayCount[wd] || 0) + 1;
  }

  if (!person.pairHistory) person.pairHistory = {};
  if (!shift.assignedPersons) shift.assignedPersons = [];

  // Pair history: selected with already assigned in this shift
  for (const other of shift.assignedPersons) {
    if (!other?.id) continue;
    const key1 = `${person.id}-${other.id}`;
    const key2 = `${other.id}-${person.id}`;
    person.pairHistory[key1] = Number(person.pairHistory[key1] || 0) + 1;
    if (!other.pairHistory) other.pairHistory = {};
    other.pairHistory[key2] = Number(other.pairHistory[key2] || 0) + 1;
  }

  shift.assignedPersons.push({ id: person.id, name: person.name || "" });

  const taskKey = getShiftKey(shift);
  if (taskKey) {
    if (!person.taskCounts) person.taskCounts = {};
    person.taskCounts[taskKey] = Number(person.taskCounts[taskKey] || 0) + 1;
  }

  // last shift snapshot
  person.lastShift = {
    date: day.date,
    code: shift.code || shift.id || "",
    start: shift.start || null,
    end: shift.end || null,
    isNight: !!shift.isNight,
  };

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

function runScheduler(context) {
  if (!context || !Array.isArray(context.days) || !Array.isArray(context.staff)) return context;
  if (!Array.isArray(context.candidateAudit)) context.candidateAudit = [];
  const shadowAuditEnabled = context?.auditOptions?.enableShadowCollection === true;
  if (shadowAuditEnabled && !context.shadowAudit) {
    context.shadowAudit = createShadowAuditCollector({
      ruleCodes: context?.auditOptions?.shadowRuleCodes,
    });
  }

  for (const day of context.days) {
    const usedOnDay = new Set();
    if (!day || !Array.isArray(day.shifts)) continue;
    for (const shift of day.shifts) {
      const need = Math.max(1, Number(shift.requiredCount || 1));
      if (!shift.assignedPersons) shift.assignedPersons = [];

      for (let i = 0; i < need; i++) {
        const rawStaffPool = context.staff.filter((p) => !usedOnDay.has(p.id));
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

        const candidates = candidateBuild.pool.filter((p) =>
          isAvailable(p, day, context, shift)
        );

        const slotAudit = {
          ...candidateBuild.audit,
          postConstraintCount: candidates.length,
        };

        if (!candidates.length) {
          context.candidateAudit.push(slotAudit);
          break;
        }
        const scoredCandidates = candidates.map((candidate) => {
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
        const selected = scoredCandidates[0];
        context.candidateAudit.push({
          ...slotAudit,
          selectedCandidateId: normalizePersonId(selected?.id),
          selectedSchedulerScore: Number(selected?.schedulerScore || 0),
          selectedPolicyScore: Number(selected?.policyScore || 0),
          selectedPolicyBreakdown: Array.isArray(selected?.policyBreakdown)
            ? selected.policyBreakdown.map(clonePolicyResult)
            : [],
          selectionReason: determineSelectionReason(scoredCandidates),
          topCandidates: buildTopCandidateSummary(scoredCandidates, selected?.id),
        });
        assign(selected?.person, day, shift, context);
        if (selected?.id) usedOnDay.add(selected.id);
      }

      if (shift.assignedPersons.length < need) {
        if (!context.issues) context.issues = [];
        context.issues.push({
          date: day.date,
          shiftId: shift.id || shift.code || "",
          missing: need - shift.assignedPersons.length,
          reason: "NO_CANDIDATE",
        });
      }
    }
  }

  if (shadowAuditEnabled && context?.shadowAudit) {
    context.shadowAudit.summary = aggregateShadowObservations(context.shadowAudit.observations);
  }

  return context;
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
    const audit = {
      ...baseAudit,
      eligibleCount: eligiblePeople.length,
      rejectedCount: rejected.length,
      hardFilteredByCandidateBuilderCount:
        Math.max(0, fallbackPool.length - fallbackPoolAfterHardFilter.length),
      hardFilteredBlockingRules: summarizeBlockingRules(rejected, context),
      roleEligibilityHardRejectCount: countHardRejectedByRule(rejected, "ROLE_ELIGIBILITY"),
      sectionEligibilityCheckedCount: sectionEligibilityMetrics.checkedCount,
      sectionEligibilityHardRejectCount: sectionEligibilityMetrics.hardRejectCount,
      sectionEligibilityPassCount: sectionEligibilityMetrics.passCount,
      rejected: rejected.map((item) => ({
        personId: item?.personId || null,
        failedRuleCodes: Array.isArray(item?.failedRules)
          ? item.failedRules.map((rule) => rule?.code).filter(Boolean)
          : [],
        hardRejected: item?.hardRejected === true,
        blockingRules: Array.isArray(item?.blockingRules) ? item.blockingRules.filter(Boolean) : [],
        reasonCodes: Array.isArray(item?.reasonCodes) ? item.reasonCodes.filter(Boolean) : [],
      })),
    };

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
        fallbackUsed: true,
        fallbackReason: "NO_ELIGIBLE_FROM_CANDIDATE_BUILDER",
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
        fallbackUsed: true,
        fallbackReason: "CANDIDATE_BUILDER_ERROR",
        error: error?.message || "Unknown candidate builder error",
      },
      shadowObservations: shadowResult.observations,
      shadowError: shadowResult.error,
    };
  }
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
    return "SCHEDULER_SCORE_BEST";
  }

  const firstPolicyScore = Number(first?.policyScore || 0);
  const secondPolicyScore = Number(second?.policyScore || 0);
  if (firstPolicyScore !== secondPolicyScore) {
    return "POLICY_TIE_BREAK";
  }

  return "SCHEDULER_SCORE_BEST";
}

function buildTopCandidateSummary(scoredCandidates = [], selectedId = null) {
  return (Array.isArray(scoredCandidates) ? scoredCandidates : [])
    .slice(0, 3)
    .map((candidate) => ({
      personId: normalizePersonId(candidate?.id),
      schedulerScore: Number(candidate?.schedulerScore || 0),
      policyScore: Number(candidate?.policyScore || 0),
      selected: normalizePersonId(candidate?.id) === normalizePersonId(selectedId),
    }));
}

function clonePolicyResult(policyResult) {
  return {
    policy: policyResult?.policy || "UNKNOWN_POLICY",
    score: Number(policyResult?.score || 0),
    reason: policyResult?.reason ?? null,
    meta:
      policyResult?.meta && typeof policyResult.meta === "object" && !Array.isArray(policyResult.meta)
        ? { ...policyResult.meta }
        : {},
  };
}

module.exports = { runScheduler, assign };
