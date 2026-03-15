"use strict";

const RULE_CODES = require("../ruleCodes");
const REASON_CODES = require("../reasonCodes");
const { makeRulePass, makeRuleFail } = require("../utils/candidateResult");

/**
 * Hard rule: checks whether person role matches slot role requirements.
 * Policy: fail-closed when requirement exists but person role data is missing.
 */
function roleEligibilityRule(context = {}) {
  const requiredRoles = extractRequiredRoles(context);
  if (!requiredRoles.length) {
    return makeRulePass({
      code: RULE_CODES.ROLE_ELIGIBILITY,
      message: "Role requirement is not defined. Rule skipped.",
      meta: {
        skipped: true,
        reason: REASON_CODES.ROLE_REQUIREMENT_MISSING,
      },
    });
  }

  const personRoles = extractPersonRoles(context?.person || context?.candidate);
  if (!personRoles.length) {
    return makeRuleFail({
      code: RULE_CODES.ROLE_ELIGIBILITY,
      message: "Person role data is missing while role requirement is defined.",
      meta: {
        reason: REASON_CODES.PERSON_ROLE_MISSING_FAIL_CLOSED,
        requiredRoles,
      },
    });
  }

  const hasMatch = requiredRoles.some((required) => personRoles.includes(required));
  if (hasMatch) {
    return makeRulePass({
      code: RULE_CODES.ROLE_ELIGIBILITY,
      message: "Person role is eligible for this slot.",
      meta: {
        requiredRoles,
        personRoles,
      },
    });
  }

  return makeRuleFail({
    code: RULE_CODES.ROLE_ELIGIBILITY,
    message: "Person role is not eligible for this slot.",
    meta: {
      requiredRoles,
      personRoles,
    },
  });
}

function extractRequiredRoles(context) {
  // Source precedence is documented in contextContract.ROLE_REQUIRED_ROLE_PRECEDENCE.
  const fromShift =
    context?.shift?.requiredRoles ??
    context?.shift?.requiredRole ??
    context?.shift?.allowedRoles ??
    context?.shift?.allowedRole ??
    context?.shift?.role;
  const fromRules =
    context?.rules?.requiredRoles ??
    context?.rules?.requiredRole ??
    context?.rules?.ROLE_ELIGIBILITY?.requiredRoles ??
    context?.rules?.ROLE_ELIGIBILITY?.requiredRole;
  const fromOptions =
    context?.options?.requiredRoles ??
    context?.options?.requiredRole ??
    context?.options?.roleEligibility?.requiredRoles ??
    context?.options?.roleEligibility?.requiredRole;

  return normalizeUniqueList(fromShift ?? fromRules ?? fromOptions);
}

function extractPersonRoles(person) {
  if (!person || typeof person !== "object") return [];
  return normalizeUniqueList(
    person?.roles ??
      person?.role ??
      person?.title ??
      person?.meta?.roles ??
      person?.meta?.role
  );
}

function normalizeUniqueList(value) {
  if (Array.isArray(value)) {
    const list = value
      .map((item) => normalizeValue(item))
      .filter(Boolean);
    return Array.from(new Set(list));
  }

  if (typeof value === "string" && value.includes(",")) {
    const list = value
      .split(",")
      .map((item) => normalizeValue(item))
      .filter(Boolean);
    return Array.from(new Set(list));
  }

  const one = normalizeValue(value);
  return one ? [one] : [];
}

function normalizeValue(value) {
  if (value == null) return null;
  const normalized = String(value).trim().toLowerCase();
  return normalized || null;
}

module.exports = roleEligibilityRule;
