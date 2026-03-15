"use strict";

const ruleCatalog = require("./ruleCatalog");
const { createRuleRegistry } = require("./ruleRegistry");
const { makeRuleFail, makeRulePass, makeCandidateResult } = require("./utils/candidateResult");
const { buildCandidateContext } = require("./utils/buildCandidateContext");
const { DEFAULT_RULE_EXECUTION_ORDER } = require("./ruleExecutionOrder");
const REASON_CODES = require("./reasonCodes");

const DEFAULT_HARD_SEVERITIES = Object.freeze(["hard", "error"]);
const DEFAULT_RULE_ORDER = Object.freeze(
  DEFAULT_RULE_EXECUTION_ORDER.filter((code) => ruleCatalog.getRuleMetaByCode(code)?.enabled)
);

/**
 * Evaluates one candidate against active rule set.
 * Hard-severity failures stop execution immediately (fail-fast).
 */
function evaluateCandidate({
  person = null,
  candidate = null,
  context = null,
  day = null,
  shift = null,
  section = null,
  serviceId = null,
  schedulerContext = null,
  assignmentState = null,
  activeRuleCodes = null,
  registry = null,
  options = null,
} = {}) {
  const resolvedPerson = person || candidate || null;
  const ruleRegistry = registry || createRuleRegistry();
  const codes = normalizeRuleCodes(activeRuleCodes);
  const hardSeverities = normalizeHardSeverities(options?.hardSeverities);

  const ruleContext = context || buildCandidateContext({
    person: resolvedPerson,
    day,
    shift,
    section,
    serviceId,
    rules: codes,
    schedulerContext,
    assignmentState,
    options,
  });

  const passedRules = [];
  const failedRules = [];
  const ruleResults = [];
  let stoppedByHardFail = false;
  let stoppedAtRuleCode = null;

  for (const code of codes) {
    const meta = ruleCatalog.getRuleMetaByCode(code);
    const severity = normalizeSeverity(meta?.severity);
    const evaluator =
      ruleRegistry.getRuleFunction?.(code) ||
      ruleRegistry.getRuleByCode?.(code)?.evaluator ||
      null;

    if (typeof evaluator !== "function") {
      const missingRuleResult = makeRuleFail({
        code,
        message: "Rule function is not registered.",
        meta: {
          reason: REASON_CODES.RULE_NOT_REGISTERED,
          severity,
          phase: meta?.phase || null,
        },
      });

      ruleResults.push(missingRuleResult);
      failedRules.push({ code, severity, phase: meta?.phase || null });

      if (isHardSeverity(severity, hardSeverities)) {
        stoppedByHardFail = true;
        stoppedAtRuleCode = code;
        break;
      }

      continue;
    }

    let normalizedRuleResult;
    try {
      const rawResult = evaluator(ruleContext);
      normalizedRuleResult = normalizeRuleResult(rawResult, code, severity, meta?.phase || null);
    } catch (error) {
      normalizedRuleResult = makeRuleFail({
        code,
        message: "Rule execution error.",
        meta: {
          reason: REASON_CODES.RULE_EXECUTION_ERROR,
          severity,
          phase: meta?.phase || null,
          error: error?.message || "Unknown rule error",
        },
      });
    }

    ruleResults.push(normalizedRuleResult);

    if (normalizedRuleResult.passed) {
      passedRules.push({ code, severity, phase: meta?.phase || null });
      continue;
    }

    failedRules.push({ code, severity, phase: meta?.phase || null });
    if (isHardSeverity(severity, hardSeverities)) {
      stoppedByHardFail = true;
      stoppedAtRuleCode = code;
      break;
    }
  }

  const hardFailedRules = failedRules.filter((item) => isHardSeverity(item?.severity, hardSeverities));
  const softFailedRules = failedRules.filter((item) => !isHardSeverity(item?.severity, hardSeverities));
  const blockingRules = dedupeCodes(hardFailedRules.map((item) => item?.code).filter(Boolean));
  const reasonCodes = collectReasonCodes(ruleResults);

  const baseCandidate = makeCandidateResult({
    personId: ruleContext.personId,
    date: ruleContext.date,
    shift: ruleContext.shift,
    ruleResults,
    meta: {
      section: ruleContext.section,
      serviceId: ruleContext.serviceId,
      evaluatedRuleCount: ruleResults.length,
      requestedRuleCount: codes.length,
      hardFailureCount: hardFailedRules.length,
      softFailureCount: softFailedRules.length,
      blockingRuleCount: blockingRules.length,
      stoppedByHardFail,
      stoppedAtRuleCode,
    },
  });

  const status = hardFailedRules.length ? "rejected" : "eligible";

  return {
    personId: baseCandidate.personId,
    person: ruleContext.person,
    passedRules,
    failedRules,
    hardRejected: hardFailedRules.length > 0,
    blockingRules,
    reasonCodes,
    ruleResults: baseCandidate.ruleResults,
    status,
    meta: {
      ...baseCandidate.meta,
      hardRejected: hardFailedRules.length > 0,
      blockingRules,
      reasonCodes,
    },
  };
}

function normalizeRuleCodes(activeRuleCodes) {
  if (Array.isArray(activeRuleCodes) && activeRuleCodes.length) {
    return dedupeCodes(activeRuleCodes);
  }
  return dedupeCodes(DEFAULT_RULE_ORDER);
}

function dedupeCodes(codes) {
  const out = [];
  const seen = new Set();
  for (const item of codes || []) {
    if (item == null) continue;
    const code = String(item).trim();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    out.push(code);
  }
  return out;
}

function normalizeHardSeverities(hardSeverities) {
  const source = Array.isArray(hardSeverities) && hardSeverities.length
    ? hardSeverities
    : DEFAULT_HARD_SEVERITIES;

  return new Set(
    source
      .map((item) => normalizeSeverity(item))
      .filter(Boolean)
  );
}

function isHardSeverity(severity, hardSeveritiesSet) {
  const normalized = normalizeSeverity(severity);
  return hardSeveritiesSet.has(normalized);
}

function normalizeSeverity(severity) {
  const raw = String(severity || "").trim().toLowerCase();
  if (!raw) return "hard";
  if (raw === "error") return "hard";
  if (raw === "warning") return "soft";
  if (raw === "hard" || raw === "soft") return raw;
  return raw;
}

function normalizeRuleResult(rawResult, code, severity, phase) {
  if (rawResult?.passed) {
    return makeRulePass({
      code,
      message: rawResult?.message || "Rule passed.",
      meta: {
        severity,
        phase,
        ...(rawResult?.meta && typeof rawResult.meta === "object" ? rawResult.meta : {}),
      },
    });
  }

  return makeRuleFail({
    code,
    message: rawResult?.message || rawResult?.reason || "Rule failed.",
    meta: {
      severity,
      phase,
      ...(rawResult?.meta && typeof rawResult.meta === "object" ? rawResult.meta : {}),
    },
  });
}

function collectReasonCodes(ruleResults) {
  const out = [];
  const seen = new Set();

  for (const item of ruleResults || []) {
    const reasonCode = normalizeReasonCode(item?.meta?.reason);
    if (!reasonCode || seen.has(reasonCode)) continue;
    seen.add(reasonCode);
    out.push(reasonCode);
  }

  return out;
}

function normalizeReasonCode(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

module.exports = {
  evaluateCandidate,
  DEFAULT_RULE_ORDER,
};
