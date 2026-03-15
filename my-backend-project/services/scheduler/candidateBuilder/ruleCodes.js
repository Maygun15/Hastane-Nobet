"use strict";

/**
 * Central rule code definitions for candidate evaluation.
 * Keep this list stable to avoid integration drift between modules.
 */
const RULE_CODES = Object.freeze({
  ACTIVE_REQUIRED: "ACTIVE_REQUIRED",
  SERVICE_MATCH: "SERVICE_MATCH",
  LEAVE_BLOCK: "LEAVE_BLOCK",
  REST_AFTER_NIGHT: "REST_AFTER_NIGHT",
  ONE_SHIFT_PER_DAY: "ONE_SHIFT_PER_DAY",
  ROLE_ELIGIBILITY: "ROLE_ELIGIBILITY",
  SECTION_ELIGIBILITY: "SECTION_ELIGIBILITY",
  MAX_WEEKLY_SHIFTS: "MAX_WEEKLY_SHIFTS",
  MAX_CONSECUTIVE_DAYS: "MAX_CONSECUTIVE_DAYS",
});

const RULE_CODE_LIST = Object.freeze(Object.values(RULE_CODES));

function isKnownRuleCode(code) {
  if (!code) return false;
  return RULE_CODE_LIST.includes(code);
}

module.exports = Object.freeze({
  ...RULE_CODES,
  RULE_CODE_LIST,
  isKnownRuleCode,
});
