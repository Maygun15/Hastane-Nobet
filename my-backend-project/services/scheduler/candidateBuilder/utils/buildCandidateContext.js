"use strict";

const contextContract = require("../contextContract");

/**
 * Builds normalized evaluation context for one candidate.
 * Keep this payload stable so rules can evolve independently.
 */
function buildCandidateContext({
  person = null,
  personId = null,
  candidate = null,
  day = null,
  date = null,
  shift = null,
  section = null,
  serviceId = null,
  rules = null,
  leavesForPerson = null,
  existingAssignments = null,
  schedulerContext = null,
  assignmentState = null,
  options = null,
} = {}) {
  const resolvedPerson = person || candidate || null;
  const resolvedPersonId = normalizePersonId(personId, resolvedPerson);
  const resolvedDate = normalizeDate(date || day?.date || day?.day);
  const resolvedShift = normalizeShift(shift);
  const resolvedSection = resolveSection(section, resolvedShift, day, schedulerContext);
  const resolvedServiceId = resolveServiceId(serviceId, resolvedShift, day, schedulerContext);
  const resolvedRules = resolveRules(rules, schedulerContext);
  const resolvedLeaves = resolveLeavesForPerson(leavesForPerson, schedulerContext, resolvedPersonId);
  const resolvedAssignments = resolveExistingAssignments(
    existingAssignments,
    assignmentState,
    schedulerContext
  );

  return {
    person: resolvedPerson,
    candidate: resolvedPerson, // backward-compat alias
    personId: resolvedPersonId,
    date: resolvedDate,
    day: day || null,
    shift: resolvedShift,
    section: resolvedSection,
    serviceId: resolvedServiceId,
    rules: resolvedRules,
    leavesForPerson: resolvedLeaves,
    existingAssignments: resolvedAssignments,
    schedulerContext,
    assignmentState,
    options: options || {},
  };
}

function normalizePersonId(explicitPersonId, person) {
  const raw = explicitPersonId ?? person?.id ?? person?._id ?? person?.personId ?? null;
  if (raw == null) return null;
  const value = String(raw).trim();
  return value || null;
}

function normalizeDate(input) {
  if (!input) return null;
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return null;
    return input.toISOString().slice(0, 10);
  }

  const raw = String(input).trim();
  if (!raw) return null;
  const isoCandidate = raw.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoCandidate)) return isoCandidate;

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function normalizeShift(shift) {
  if (!shift || typeof shift !== "object") return null;
  return {
    ...shift,
    id: shift.id ?? shift.code ?? null,
    code: shift.code ?? shift.id ?? null,
  };
}

function resolveSection(section, shift, day, schedulerContext) {
  // Source precedence is documented in contextContract.SECTION_TARGET_PRECEDENCE.
  const value =
    section ??
    shift?.section ??
    day?.section ??
    schedulerContext?.section ??
    schedulerContext?.targetSection ??
    null;
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function resolveServiceId(serviceId, shift, day, schedulerContext) {
  // Source precedence is documented in contextContract.SERVICE_ID_PRECEDENCE.
  const value =
    serviceId ??
    shift?.serviceId ??
    day?.serviceId ??
    schedulerContext?.serviceId ??
    schedulerContext?.targetServiceId ??
    null;
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function resolveRules(rules, schedulerContext) {
  if (Array.isArray(rules)) return rules;
  if (rules && typeof rules === "object") return rules;
  if (Array.isArray(schedulerContext?.rules)) return schedulerContext.rules;
  if (schedulerContext?.rules && typeof schedulerContext.rules === "object") return schedulerContext.rules;
  return [];
}

function resolveLeavesForPerson(leavesForPerson, schedulerContext, personId) {
  if (Array.isArray(leavesForPerson)) return leavesForPerson;
  if (leavesForPerson && typeof leavesForPerson === "object") return leavesForPerson;
  if (!personId) return [];

  const map = schedulerContext?.leavesByPerson;
  if (!map || typeof map !== "object") return [];

  const personLeaves = map[personId];
  if (Array.isArray(personLeaves)) return personLeaves;
  if (personLeaves && typeof personLeaves === "object") return personLeaves;
  return [];
}

function resolveExistingAssignments(existingAssignments, assignmentState, schedulerContext) {
  if (Array.isArray(existingAssignments)) return existingAssignments;
  if (Array.isArray(assignmentState?.assignments)) return assignmentState.assignments;
  if (Array.isArray(schedulerContext?.assignments)) return schedulerContext.assignments;
  return [];
}

module.exports = {
  buildCandidateContext,
  normalizeDate,
  CANDIDATE_CONTEXT_FIELDS: contextContract.CANDIDATE_CONTEXT_FIELDS,
};
