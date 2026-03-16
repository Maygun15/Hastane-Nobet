"use strict";

const RULE_CODES = require("./ruleCodes");
const { DEFAULT_RULE_EXECUTION_ORDER } = require("./ruleExecutionOrder");

/**
 * Metadata-only rule catalog.
 * Keep evaluator mapping out of this file.
 * V4 hard authority intent:
 * - enabled + severity=hard rules are the primary candidate-level hard authority
 * - enabled + severity=soft rules remain capacity signals only
 * - shadow rules are not yet authoritative
 */
const RULE_CATALOG = Object.freeze([
  {
    code: RULE_CODES.ACTIVE_REQUIRED,
    title: "Active Required",
    severity: "hard",
    phase: "eligibility",
    enabled: true,
  },
  {
    code: RULE_CODES.SERVICE_MATCH,
    title: "Service Match",
    severity: "hard",
    phase: "eligibility",
    enabled: true,
  },
  {
    code: RULE_CODES.LEAVE_BLOCK,
    title: "Leave Block",
    severity: "hard",
    phase: "eligibility",
    enabled: true,
  },
  {
    code: RULE_CODES.REST_AFTER_NIGHT,
    title: "Rest After Night",
    severity: "hard",
    phase: "eligibility",
    enabled: true,
  },
  {
    code: RULE_CODES.ONE_SHIFT_PER_DAY,
    title: "One Shift Per Day",
    severity: "hard",
    phase: "eligibility",
    enabled: false,
    rolloutStage: "shadow",
    shadowMode: true,
    requiresCleanAssignmentData: true,
    overrideScopeHints: ["institution", "service", "section", "shiftType"],
  },
  {
    code: RULE_CODES.ROLE_ELIGIBILITY,
    title: "Role Eligibility",
    severity: "hard",
    phase: "eligibility",
    enabled: false,
    rolloutStage: "shadow",
    shadowMode: true,
    requiresCleanRoleData: true,
    overrideScopeHints: ["institution", "service", "section", "shiftType"],
  },
  {
    code: RULE_CODES.SECTION_ELIGIBILITY,
    title: "Section Eligibility",
    severity: "hard",
    phase: "eligibility",
    enabled: false,
    rolloutStage: "shadow",
    shadowMode: true,
    requiresCleanSectionData: true,
    overrideScopeHints: ["institution", "service", "section", "shiftType"],
  },
  {
    code: RULE_CODES.MAX_WEEKLY_SHIFTS,
    title: "Max Weekly Shifts",
    severity: "soft",
    phase: "capacity",
    enabled: true,
  },
  {
    code: RULE_CODES.MAX_CONSECUTIVE_DAYS,
    title: "Max Consecutive Days",
    severity: "soft",
    phase: "capacity",
    enabled: true,
  },
]);

function getRuleMetaByCode(code) {
  if (!code) return null;
  return RULE_CATALOG.find((item) => item.code === code) || null;
}

function listEnabledRuleCodes() {
  return DEFAULT_RULE_EXECUTION_ORDER.filter((code) => getRuleMetaByCode(code)?.enabled);
}

function listShadowRuleCodes() {
  return RULE_CATALOG.filter((item) => item.shadowMode).map((item) => item.code);
}

function getRuleReadiness(code) {
  const meta = getRuleMetaByCode(code);
  if (!meta) return null;

  return {
    code: meta.code,
    enabled: Boolean(meta.enabled),
    rolloutStage: meta.rolloutStage || (meta.enabled ? "active" : "planned"),
    shadowMode: Boolean(meta.shadowMode),
    requiresCleanAssignmentData: Boolean(meta.requiresCleanAssignmentData),
    requiresCleanRoleData: Boolean(meta.requiresCleanRoleData),
    requiresCleanSectionData: Boolean(meta.requiresCleanSectionData),
    overrideScopeHints: Array.isArray(meta.overrideScopeHints) ? meta.overrideScopeHints : [],
  };
}

function listRuleStates() {
  return DEFAULT_RULE_EXECUTION_ORDER
    .map((code) => getRuleMetaByCode(code))
    .filter(Boolean)
    .map((meta) => ({
      code: meta.code,
      severity: meta.severity,
      enabled: Boolean(meta.enabled),
      rolloutStage: meta.rolloutStage || (meta.enabled ? "active" : "planned"),
      shadowMode: Boolean(meta.shadowMode),
    }));
}

module.exports = Object.freeze({
  RULE_CATALOG,
  getRuleMetaByCode,
  listEnabledRuleCodes,
  listShadowRuleCodes,
  getRuleReadiness,
  listRuleStates,
});
