"use strict";

const RULE_CODES = require("../ruleCodes");
const REASON_CODES = require("../reasonCodes");
const { makeRulePass, makeRuleFail } = require("../utils/candidateResult");

/**
 * Hard rule: blocks assigning the same person more than once on the same date.
 */
function oneShiftPerDayRule(context = {}) {
  const personId = normalizeId(
    context?.personId ||
      context?.person?.id ||
      context?.person?._id ||
      context?.candidate?.id ||
      context?.candidate?._id
  );
  const date = normalizeDate(context?.date || context?.day?.date || context?.day?.day);
  const assignments = Array.isArray(context?.existingAssignments) ? context.existingAssignments : [];

  if (!personId || !date) {
    return makeRulePass({
      code: RULE_CODES.ONE_SHIFT_PER_DAY,
      message: "Insufficient context for one-shift-per-day check. Rule skipped.",
      meta: {
        skipped: true,
        reason: !personId ? REASON_CODES.PERSON_ID_MISSING : REASON_CODES.DATE_MISSING,
      },
    });
  }

  for (let i = 0; i < assignments.length; i += 1) {
    const assignment = assignments[i];
    const assignedPersonId = normalizeId(
      assignment?.personId ||
        assignment?.staffId ||
        assignment?.person?.id ||
        assignment?.person?._id
    );
    const assignmentDate = normalizeDate(
      assignment?.date || assignment?.day || assignment?.assignmentDate
    );
    if (assignedPersonId !== personId || assignmentDate !== date) continue;

    return makeRuleFail({
      code: RULE_CODES.ONE_SHIFT_PER_DAY,
      message: "Person already has an assignment on this date.",
      meta: {
        reason: REASON_CODES.SAME_DAY_ASSIGNMENT_FOUND,
        date,
        assignmentIndex: i,
        matchedAssignmentDate: assignmentDate,
        matchedShift:
          assignment?.shiftId ||
          assignment?.shiftType ||
          assignment?.shift?.id ||
          assignment?.shift?.code ||
          null,
      },
    });
  }

  return makeRulePass({
    code: RULE_CODES.ONE_SHIFT_PER_DAY,
    message: "No same-day assignment conflict detected.",
    meta: {
      date,
      checkedAssignments: assignments.length,
    },
  });
}

function normalizeId(value) {
  if (value == null) return null;
  const normalized = String(value).trim().toLowerCase();
  return normalized || null;
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

module.exports = oneShiftPerDayRule;
