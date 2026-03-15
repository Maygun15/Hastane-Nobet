"use strict";

const RULE_CODES = require("./ruleCodes");

const RULE_ACTIVATION_STRATEGIES = Object.freeze({
  [RULE_CODES.ONE_SHIFT_PER_DAY]: Object.freeze({
    ruleCode: RULE_CODES.ONE_SHIFT_PER_DAY,
    recommendedActivationStage: "after-shadow-audit",
    recommendedScope: "institution",
    blockingDataRequirements: ["cleanAssignmentPersonId", "cleanAssignmentDate"],
    activationNotes:
      "Activate first at institution level after same-day assignment data quality is verified.",
    futureOverrideScopes: Object.freeze(["institution", "service", "section", "shiftType"]),
  }),
  [RULE_CODES.ROLE_ELIGIBILITY]: Object.freeze({
    ruleCode: RULE_CODES.ROLE_ELIGIBILITY,
    recommendedActivationStage: "after-role-data-cleanup",
    recommendedScope: "service",
    blockingDataRequirements: ["cleanPersonRole", "cleanShiftRequiredRole"],
    activationNotes:
      "Start in services with reliable role taxonomy before widening to institution scope.",
    futureOverrideScopes: Object.freeze(["institution", "service", "section", "shiftType"]),
  }),
  [RULE_CODES.SECTION_ELIGIBILITY]: Object.freeze({
    ruleCode: RULE_CODES.SECTION_ELIGIBILITY,
    recommendedActivationStage: "after-section-mapping-validation",
    recommendedScope: "section",
    blockingDataRequirements: ["cleanPersonSection", "cleanShiftSection"],
    activationNotes:
      "Enable first in sections with stable area/section mapping and consistent staff metadata.",
    futureOverrideScopes: Object.freeze(["institution", "service", "section", "shiftType"]),
  }),
});

function getRuleActivationStrategy(ruleCode) {
  if (!ruleCode) return null;
  return RULE_ACTIVATION_STRATEGIES[ruleCode] || null;
}

function listRuleActivationStrategies() {
  return Object.values(RULE_ACTIVATION_STRATEGIES);
}

module.exports = Object.freeze({
  RULE_ACTIVATION_STRATEGIES,
  getRuleActivationStrategy,
  listRuleActivationStrategies,
});
