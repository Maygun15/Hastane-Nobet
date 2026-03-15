"use strict";

const { evaluateCandidate, DEFAULT_RULE_ORDER } = require("./evaluateCandidate");
const { buildCandidateContext } = require("./utils/buildCandidateContext");

/**
 * Builds candidate evaluation list for a day/shift pair.
 * Orchestrates context + candidate evaluation only.
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
  const selectedRuleCodes = resolveRuleCodes(ruleCodes, activeRuleCodes);
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
    // Backward-compatible aliases for existing scaffolding callers.
    candidates: eligible.map((item) => item.person).filter(Boolean),
    evaluations: [...eligible, ...rejected],
    ruleCodes: selectedRuleCodes,
  };
}

function resolveRuleCodes(ruleCodes, activeRuleCodes) {
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
  return out;
}

module.exports = {
  buildCandidates,
};
