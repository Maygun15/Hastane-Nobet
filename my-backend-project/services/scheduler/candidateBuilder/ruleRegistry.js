"use strict";

const RULE_CODES = require("./ruleCodes");
const { makeRulePass } = require("./utils/candidateResult");
const activeRequiredRule = require("./rules/activeRequired.rule");
const serviceMatchRule = require("./rules/serviceMatch.rule");
const leaveBlockRule = require("./rules/leaveBlock.rule");
const restAfterNightRule = require("./rules/restAfterNight.rule");
const oneShiftPerDayRule = require("./rules/oneShiftPerDay.rule");
const roleEligibilityRule = require("./rules/roleEligibility.rule");
const sectionEligibilityRule = require("./rules/sectionEligibility.rule");

function makeTodoRule(ruleCode) {
  return function todoRule() {
    return makeRulePass({
      code: ruleCode,
      message: "Rule skeleton is registered; business logic is pending.",
      meta: { todo: true },
    });
  };
}

const DEFAULT_RULE_FUNCTIONS = Object.freeze({
  [RULE_CODES.ACTIVE_REQUIRED]: activeRequiredRule,
  [RULE_CODES.SERVICE_MATCH]: serviceMatchRule,
  [RULE_CODES.LEAVE_BLOCK]: leaveBlockRule,
  [RULE_CODES.REST_AFTER_NIGHT]: restAfterNightRule,
  [RULE_CODES.ONE_SHIFT_PER_DAY]: oneShiftPerDayRule,
  [RULE_CODES.ROLE_ELIGIBILITY]: roleEligibilityRule,
  [RULE_CODES.SECTION_ELIGIBILITY]: sectionEligibilityRule,
  [RULE_CODES.MAX_WEEKLY_SHIFTS]: makeTodoRule(RULE_CODES.MAX_WEEKLY_SHIFTS),
  [RULE_CODES.MAX_CONSECUTIVE_DAYS]: makeTodoRule(RULE_CODES.MAX_CONSECUTIVE_DAYS),
});

/**
 * Rule registry keeps only code -> evaluator mapping.
 * Metadata lookup belongs to ruleCatalog.
 */
function createRuleRegistry({ customRuleFunctions = null } = {}) {
  const byCode = new Map(Object.entries(DEFAULT_RULE_FUNCTIONS));
  const overrides = customRuleFunctions && typeof customRuleFunctions === "object"
    ? customRuleFunctions
    : {};

  for (const [code, fn] of Object.entries(overrides)) {
    if (!code || typeof fn !== "function") continue;
    byCode.set(code, fn);
  }

  function hasRule(code) {
    if (!code) return false;
    return byCode.has(code);
  }

  function getRuleFunction(code) {
    if (!code) return null;
    return byCode.get(code) || null;
  }

  // Backward-compatible helper for current evaluateCandidate skeleton.
  function getRuleByCode(code) {
    const evaluator = getRuleFunction(code);
    if (!evaluator) return null;
    return { code, evaluator };
  }

  function listRules() {
    return Array.from(byCode.entries()).map(([code, evaluator]) => ({
      code,
      evaluator,
    }));
  }

  function listRuleCodes() {
    return Array.from(byCode.keys());
  }

  return {
    hasRule,
    getRuleFunction,
    getRuleByCode,
    listRules,
    listRuleCodes,
  };
}

module.exports = {
  createRuleRegistry,
  DEFAULT_RULE_FUNCTIONS,
};
