"use strict";

const { makeRulePass, makeRuleFail } = require("../utils/candidateResult");

/**
 * Rule: block candidate if candidate is on leave for the day.
 */
function leaveBlockRule(context = {}) {
  const date = normalizeDate(context?.date || context?.day?.date || context?.day?.day);
  const leaves = normalizeLeaves(context?.leavesForPerson);

  if (!date) {
    return makeRulePass({
      code: "LEAVE_BLOCK",
      message: "Target date is missing. Rule skipped.",
      meta: { skipped: true, reason: "TARGET_DATE_MISSING" },
    });
  }

  if (!leaves.length) {
    return makeRulePass({
      code: "LEAVE_BLOCK",
      message: "No leave record found for person.",
      meta: { date, checkedLeaves: 0 },
    });
  }

  for (let i = 0; i < leaves.length; i += 1) {
    const leave = leaves[i];
    const window = extractLeaveWindow(leave);
    if (!window) continue;

    if (isDateInWindow(date, window.start, window.end)) {
      return makeRuleFail({
        code: "LEAVE_BLOCK",
        message: "Person is on leave for the selected date.",
        meta: {
          date,
          matchedLeaveIndex: i,
          leaveStart: window.start,
          leaveEnd: window.end,
        },
      });
    }
  }

  return makeRulePass({
    code: "LEAVE_BLOCK",
    message: "Person is available on selected date.",
    meta: {
      date,
      checkedLeaves: leaves.length,
    },
  });
}

function normalizeLeaves(leavesForPerson) {
  if (Array.isArray(leavesForPerson)) {
    return leavesForPerson
      .map((item) => {
        if (item && typeof item === "object") return item;
        const date = normalizeDate(item);
        return date ? { date } : null;
      })
      .filter(Boolean);
  }
  if (!leavesForPerson || typeof leavesForPerson !== "object") return [];

  const output = [];
  for (const [key, value] of Object.entries(leavesForPerson)) {
    const keyDate = normalizeDate(key);

    if (value && typeof value === "object" && !Array.isArray(value)) {
      if (keyDate && !value.date && !value.day && !value.startDate && !value.endDate) {
        output.push({ ...value, date: keyDate });
      } else {
        output.push(value);
      }
      continue;
    }

    if (keyDate && Boolean(value)) {
      output.push({ date: keyDate });
    }
  }
  return output;
}

function extractLeaveWindow(leave) {
  if (!leave || typeof leave !== "object") return null;

  const singleDate = normalizeDate(leave.date || leave.day);
  if (singleDate) {
    return { start: singleDate, end: singleDate };
  }

  const start = normalizeDate(leave.startDate || leave.start || leave.from);
  const end = normalizeDate(leave.endDate || leave.end || leave.to);

  if (start && end) return start <= end ? { start, end } : { start: end, end: start };
  if (start) return { start, end: start };
  if (end) return { start: end, end };

  return null;
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

function isDateInWindow(date, start, end) {
  if (!date || !start || !end) return false;
  return date >= start && date <= end;
}

module.exports = leaveBlockRule;
