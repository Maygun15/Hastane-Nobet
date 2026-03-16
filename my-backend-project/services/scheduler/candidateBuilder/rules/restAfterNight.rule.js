"use strict";

const REASON_CODES = require("../reasonCodes");
const { makeRulePass, makeRuleFail } = require("../utils/candidateResult");
const { isNightShiftCode } = require("../../utils/nightShift");

/**
 * Rule: enforce rest window after canonical true-night shifts only.
 * Night-equivalent cleanup codes such as V2 remain outside this authority and
 * are handled by runtime/validator safety layers.
 */
function restAfterNightRule(context = {}) {
  const personId = normalizeId(
    context?.personId ||
      context?.person?.id ||
      context?.person?._id ||
      context?.candidate?.id ||
      context?.candidate?._id
  );
  const date = normalizeDate(context?.date || context?.day?.date || context?.day?.day);
  const assignments = Array.isArray(context?.existingAssignments) ? context.existingAssignments : [];

  if (!personId) {
    return makeRulePass({
      code: "REST_AFTER_NIGHT",
      message: "Person id is missing. Rule skipped.",
      meta: { skipped: true, reason: REASON_CODES.PERSON_ID_MISSING },
    });
  }

  if (!date) {
    return makeRulePass({
      code: "REST_AFTER_NIGHT",
      message: "Target date is missing. Rule skipped.",
      meta: { skipped: true, reason: REASON_CODES.DATE_MISSING },
    });
  }

  const previousDate = getPreviousDate(date);
  if (!previousDate) {
    return makeRulePass({
      code: "REST_AFTER_NIGHT",
      message: "Previous date cannot be calculated. Rule skipped.",
      meta: { skipped: true, reason: REASON_CODES.PREVIOUS_DATE_CALCULATION_FAILED, date },
    });
  }

  for (let i = 0; i < assignments.length; i += 1) {
    const assignment = assignments[i];
    const assignmentPersonId = extractAssignmentPersonId(assignment);
    if (!assignmentPersonId || assignmentPersonId !== personId) continue;

    const assignmentDate = normalizeDate(assignment?.date || assignment?.day);
    if (assignmentDate !== previousDate) continue;

    const shiftCode = extractShiftCode(assignment);
    if (!isNightShiftCode(shiftCode)) continue;

    return makeRuleFail({
      code: "REST_AFTER_NIGHT",
      message: "Night shift was assigned on previous day. Rest rule violated.",
      meta: {
        reason: REASON_CODES.REST_AFTER_NIGHT_VIOLATION,
        date,
        previousDate,
        shiftCode,
        assignmentIndex: i,
      },
    });
  }

  return makeRulePass({
    code: "REST_AFTER_NIGHT",
    message: "No previous-night assignment conflict detected.",
    meta: {
      date,
      previousDate,
      checkedAssignments: assignments.length,
    },
  });
}

function extractAssignmentPersonId(assignment) {
  if (!assignment || typeof assignment !== "object") return null;
  return normalizeId(
    assignment?.personId ??
      assignment?.staffId ??
      assignment?.person?.id ??
      assignment?.person?._id ??
      assignment?.person?.personId
  );
}

function extractShiftCode(assignment) {
  if (!assignment || typeof assignment !== "object") return null;

  const shift = assignment.shift;
  if (typeof shift === "string") {
    return normalizeShiftCode(shift);
  }

  return normalizeShiftCode(
    assignment?.shiftType ??
      assignment?.shiftCode ??
      assignment?.shiftId ??
      assignment?.code ??
      assignment?.shift?.code ??
      assignment?.shift?.id
  );
}

function normalizeShiftCode(value) {
  if (value == null) return null;
  const normalized = String(value).trim().toUpperCase();
  return normalized || null;
}

function getPreviousDate(date) {
  if (!date) return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setUTCDate(parsed.getUTCDate() - 1);
  return parsed.toISOString().slice(0, 10);
}

function normalizeDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }

  const raw = String(value).trim();
  if (!raw) return null;
  const candidate = raw.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return candidate;

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function normalizeId(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

module.exports = restAfterNightRule;
