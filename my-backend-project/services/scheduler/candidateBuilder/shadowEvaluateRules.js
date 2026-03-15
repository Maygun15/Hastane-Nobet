"use strict";

const ruleCatalog = require("./ruleCatalog");
const { evaluateCandidate } = require("./evaluateCandidate");
const { buildCandidateContext } = require("./utils/buildCandidateContext");

/**
 * Evaluates explicitly selected rules in shadow mode without changing active rollout.
 * The caller decides which rules to simulate.
 */
function evaluateCandidateShadow({
  person = null,
  day = null,
  shift = null,
  section = null,
  serviceId = null,
  schedulerContext = null,
  assignmentState = null,
  ruleCodes = null,
  registry = null,
  options = null,
} = {}) {
  const selectedRuleCodes = normalizeRuleCodes(ruleCodes);
  const context = buildCandidateContext({
    person,
    day,
    shift,
    section,
    serviceId,
    rules: selectedRuleCodes,
    schedulerContext,
    assignmentState,
    options,
  });

  const evaluation = evaluateCandidate({
    person,
    context,
    activeRuleCodes: selectedRuleCodes,
    registry,
    options,
  });

  const observations = selectedRuleCodes.map((ruleCode) => {
    const meta = ruleCatalog.getRuleMetaByCode(ruleCode);
    const readiness = ruleCatalog.getRuleReadiness(ruleCode);
    const ruleResult = evaluation.ruleResults.find((item) => item?.code === ruleCode) || null;
    const severity = normalizeSeverity(meta?.severity);
    const triggered = Boolean(ruleResult && ruleResult.passed === false);
    const wouldReject = triggered && severity === "hard";

    return {
      ruleCode,
      personId: evaluation.personId,
      triggered,
      wouldReject,
      message: ruleResult?.message || "Rule was not evaluated.",
      reason: ruleResult?.meta?.reason || null,
      severity,
      phase: meta?.phase || null,
      enabled: Boolean(meta?.enabled),
      rolloutStage: readiness?.rolloutStage || null,
      shadowMode: Boolean(readiness?.shadowMode),
      targetSummary: buildTargetSummary(ruleCode, context),
      readiness,
    };
  });

  return {
    personId: evaluation.personId,
    status: evaluation.status,
    wouldReject: observations.some((item) => item.wouldReject),
    triggeredRuleCodes: observations.filter((item) => item.triggered).map((item) => item.ruleCode),
    observations,
  };
}

function buildTargetSummary(ruleCode, context) {
  const summary = {
    date: context?.date || null,
    shiftCode: context?.shift?.code || context?.shift?.id || null,
    serviceId: context?.serviceId || null,
    section: context?.section || null,
  };

  if (ruleCode === "ROLE_ELIGIBILITY") {
    summary.requiredRoles = extractNormalizedList(
      context?.shift?.requiredRoles ??
        context?.shift?.requiredRole ??
        context?.rules?.requiredRoles ??
        context?.rules?.requiredRole ??
        context?.options?.requiredRoles ??
        context?.options?.requiredRole
    );
  }

  if (ruleCode === "SECTION_ELIGIBILITY") {
    summary.targetSection = normalizeValue(
      context?.section ??
        context?.shift?.section ??
        context?.shift?.area ??
        context?.day?.section
    );
  }

  return summary;
}

function extractNormalizedList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeValue(item)).filter(Boolean);
  }

  if (typeof value === "string" && value.includes(",")) {
    return value
      .split(",")
      .map((item) => normalizeValue(item))
      .filter(Boolean);
  }

  const one = normalizeValue(value);
  return one ? [one] : [];
}

function normalizeValue(value) {
  if (value == null) return null;
  const normalized = String(value).trim().toLowerCase();
  return normalized || null;
}

function normalizeRuleCodes(ruleCodes) {
  if (!Array.isArray(ruleCodes)) return [];

  const out = [];
  const seen = new Set();
  for (const item of ruleCodes) {
    if (item == null) continue;
    const code = String(item).trim();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    out.push(code);
  }
  return out;
}

function normalizeSeverity(severity) {
  const raw = String(severity || "").trim().toLowerCase();
  if (!raw) return "hard";
  if (raw === "error") return "hard";
  if (raw === "warning") return "soft";
  return raw;
}

module.exports = {
  evaluateCandidateShadow,
};
