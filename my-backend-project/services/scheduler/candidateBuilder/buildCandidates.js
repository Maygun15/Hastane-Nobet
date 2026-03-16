"use strict";

const { evaluateCandidate, DEFAULT_RULE_ORDER } = require("./evaluateCandidate");
const { buildCandidateContext } = require("./utils/buildCandidateContext");
const RULE_CODES = require("./ruleCodes");

/**
 * Builds candidate evaluation list for a day/shift pair.
 * Orchestrates context + candidate evaluation only.
 * Ownership note:
 * - rejected + hardRejected candidates come from candidateBuilder primary authority
 * - eligible candidates may still be filtered later by runtime guards in constraints.js
 */
function buildCandidates({
  staff = [],
  personList = null,
  day = null,
  shift = null,
  section = null,
  serviceId = null,
  schedulerContext = null,
  assignmentState = null,
  ruleCodes = null,
  activeRuleCodes = null, // backward-compatible alias
  registry = null,
  options = null,
} = {}) {
  const safeStaff = Array.isArray(staff)
    ? staff
    : Array.isArray(personList)
      ? personList
      : [];
  const selectedRuleCodes = resolveRuleCodes(ruleCodes, activeRuleCodes, options);
  const orchestrationContext = buildCandidateContext({
    day,
    shift,
    section,
    serviceId,
    rules: selectedRuleCodes,
    schedulerContext,
    assignmentState,
    options,
  });

  const eligible = [];
  const rejected = [];

  for (const person of safeStaff) {
    const candidateContext = buildCandidateContext({
      person,
      day,
      shift,
      section: orchestrationContext.section,
      serviceId: orchestrationContext.serviceId,
      rules: selectedRuleCodes,
      schedulerContext,
      assignmentState,
      options,
    });

    const candidateResult = evaluateCandidate({
      person,
      context: candidateContext,
      activeRuleCodes: selectedRuleCodes,
      registry,
      options,
    });

    if (candidateResult.status === "eligible") {
      eligible.push(candidateResult);
      continue;
    }

    rejected.push(candidateResult);
  }

  const stats = {
    totalStaff: safeStaff.length,
    eligibleCount: eligible.length,
    rejectedCount: rejected.length,
    hardBlockedCount: rejected.filter((item) => item?.hardRejected).length,
    blockingRules: summarizeBlockingRules(rejected),
    date: orchestrationContext.date,
    shift: orchestrationContext.shift,
    section: orchestrationContext.section,
    serviceId: orchestrationContext.serviceId,
  };

  return {
    date: orchestrationContext.date,
    shift: orchestrationContext.shift,
    section: orchestrationContext.section,
    serviceId: orchestrationContext.serviceId,
    eligible,
    rejected,
    stats,
    hardBlockedCandidates: rejected.filter((item) => item?.hardRejected),
    // Backward-compatible aliases for existing scaffolding callers.
    candidates: eligible.map((item) => item.person).filter(Boolean),
    evaluations: [...eligible, ...rejected],
    ruleCodes: selectedRuleCodes,
  };
}

function summarizeBlockingRules(rejected = []) {
  const counts = {};

  for (const item of rejected) {
    if (!item?.hardRejected || !Array.isArray(item?.blockingRules)) continue;
    for (const code of item.blockingRules) {
      if (!code) continue;
      counts[code] = Number(counts[code] || 0) + 1;
    }
  }

  return counts;
}

function resolveRuleCodes(ruleCodes, activeRuleCodes, options) {
  const source = Array.isArray(ruleCodes) && ruleCodes.length
    ? ruleCodes
    : Array.isArray(activeRuleCodes) && activeRuleCodes.length
      ? activeRuleCodes
      : DEFAULT_RULE_ORDER;

  const out = [];
  const seen = new Set();
  for (const item of source || []) {
    if (item == null) continue;
    const code = String(item).trim();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    out.push(code);
  }

  if (shouldForceStrictRoleEligibility(options) && !seen.has(RULE_CODES.ROLE_ELIGIBILITY)) {
    seen.add(RULE_CODES.ROLE_ELIGIBILITY);
    out.push(RULE_CODES.ROLE_ELIGIBILITY);
  }

  if (shouldForceStrictSectionEligibility(options) && !seen.has(RULE_CODES.SECTION_ELIGIBILITY)) {
    seen.add(RULE_CODES.SECTION_ELIGIBILITY);
    out.push(RULE_CODES.SECTION_ELIGIBILITY);
  }

  return out;
}

function shouldForceStrictRoleEligibility(options) {
  if (options?.strictRoleEligibility === true) return true;

  if (Array.isArray(options?.strictCandidateHardRules)) {
    return options.strictCandidateHardRules.some(
      (item) => String(item || "").trim() === RULE_CODES.ROLE_ELIGIBILITY
    );
  }

  return false;
}

function shouldForceStrictSectionEligibility(options) {
  if (options?.strictSectionEligibility === true) return true;

  if (Array.isArray(options?.strictCandidateHardRules)) {
    return options.strictCandidateHardRules.some(
      (item) => String(item || "").trim() === RULE_CODES.SECTION_ELIGIBILITY
    );
  }

  return false;
}

module.exports = {
  buildCandidates,
};
