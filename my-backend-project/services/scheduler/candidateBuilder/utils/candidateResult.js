"use strict";

/**
 * Shared result object helpers for rule and candidate evaluations.
 */
function toRuleCode(code) {
  if (code == null) return "";
  return String(code).trim();
}

function toMessage(message, fallback) {
  if (typeof message === "string" && message.trim()) return message.trim();
  if (typeof fallback === "string" && fallback.trim()) return fallback.trim();
  return "";
}

function toMeta(meta) {
  return meta && typeof meta === "object" && !Array.isArray(meta) ? meta : {};
}

function makeRuleResult({ passed = true, code = "", message = "", meta = null } = {}) {
  return {
    passed: Boolean(passed),
    code: toRuleCode(code),
    message: toMessage(message),
    meta: toMeta(meta),
  };
}

function makeRulePass({ code = "", message = "Rule passed.", meta = null } = {}) {
  return makeRuleResult({
    code,
    passed: true,
    message,
    meta,
  });
}

function makeRuleFail({ code = "", message = "Rule failed.", meta = null } = {}) {
  return makeRuleResult({
    code,
    passed: false,
    message,
    meta,
  });
}

function makeCandidateResult({
  personId = null,
  date = null,
  shift = null,
  ruleResults = null,
  meta = null,
} = {}) {
  const normalizedRuleResults = Array.isArray(ruleResults)
    ? ruleResults.map((item) =>
        makeRuleResult({
          passed: item?.passed,
          code: item?.code,
          message: item?.message,
          meta: item?.meta,
        })
      )
    : [];

  const passed = normalizedRuleResults.every((item) => item.passed);

  return {
    passed,
    personId: personId != null ? String(personId) : null,
    date: date || null,
    shift: shift || null,
    ruleResults: normalizedRuleResults,
    meta: toMeta(meta),
  };
}

// Backward-compatible aliases used by existing skeleton rules.
function createRuleResult({ code = null, passed = true, reason = null, message = null, meta = null } = {}) {
  return makeRuleResult({
    passed,
    code,
    message: toMessage(message, reason),
    meta,
  });
}

function passRule({ code = null, reason = null, message = null, meta = null } = {}) {
  return makeRulePass({
    code,
    message: toMessage(message, reason) || "Rule passed.",
    meta,
  });
}

function failRule({ code = null, reason = null, message = null, meta = null } = {}) {
  return makeRuleFail({
    code,
    message: toMessage(message, reason) || "Rule failed.",
    meta,
  });
}

module.exports = {
  makeRulePass,
  makeRuleFail,
  makeCandidateResult,
  createRuleResult,
  passRule,
  failRule,
};
