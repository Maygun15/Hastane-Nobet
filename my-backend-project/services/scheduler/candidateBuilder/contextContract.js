"use strict";

// CandidateBuilder context contract fields expected by rules and orchestration helpers.
const CANDIDATE_CONTEXT_FIELDS = Object.freeze([
  "person",
  "personId",
  "date",
  "shift",
  "section",
  "serviceId",
  "existingAssignments",
  "leavesForPerson",
  "rules",
  "options",
]);

// Source precedence for role-based rules. Highest priority first.
const ROLE_REQUIRED_ROLE_PRECEDENCE = Object.freeze([
  "shift.requiredRoles",
  "shift.requiredRole",
  "shift.allowedRoles",
  "shift.allowedRole",
  "shift.role",
  "rules.requiredRoles",
  "rules.requiredRole",
  "rules.ROLE_ELIGIBILITY.requiredRoles",
  "rules.ROLE_ELIGIBILITY.requiredRole",
  "options.requiredRoles",
  "options.requiredRole",
  "options.roleEligibility.requiredRoles",
  "options.roleEligibility.requiredRole",
]);

// Source precedence for section-based rules. Highest priority first.
const SECTION_TARGET_PRECEDENCE = Object.freeze([
  "context.section",
  "shift.section",
  "shift.area",
  "day.section",
  "schedulerContext.section",
  "schedulerContext.targetSection",
]);

const SERVICE_ID_PRECEDENCE = Object.freeze([
  "context.serviceId",
  "shift.serviceId",
  "day.serviceId",
  "schedulerContext.serviceId",
  "schedulerContext.targetServiceId",
]);

module.exports = Object.freeze({
  CANDIDATE_CONTEXT_FIELDS,
  ROLE_REQUIRED_ROLE_PRECEDENCE,
  SECTION_TARGET_PRECEDENCE,
  SERVICE_ID_PRECEDENCE,
});
