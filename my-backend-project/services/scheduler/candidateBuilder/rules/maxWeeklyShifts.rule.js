"use strict";

const RULE_CODES = require("../ruleCodes");
const REASON_CODES = require("../reasonCodes");
const { makeRulePass, makeRuleFail } = require("../utils/candidateResult");

function maxWeeklyShiftsRule(context = {}) {
  const rules = context?.rules && typeof context.rules === "object" ? context.rules : {};
  const maxRaw =
    rules.MAX_WEEKLY_SHIFTS ??
    rules.MAX_SHIFTS_PER_WEEK ??
    rules.WEEKLY_MAX_SHIFTS ??
    rules.WEEKLY_MAX_DUTIES;
  const max = Number(maxRaw || 0);

  if (!Number.isFinite(max) || max <= 0) {
    return makeRulePass({
      code: RULE_CODES.MAX_WEEKLY_SHIFTS,
      message: "Weekly shift cap is not configured. Rule skipped.",
      meta: {
        skipped: true,
      },
    });
  }

  const date = normalizeDate(context?.date || context?.day?.date || context?.day?.day);
  const weekKey = getISOWeekKey(date);
  if (!weekKey) {
    return makeRulePass({
      code: RULE_CODES.MAX_WEEKLY_SHIFTS,
      message: "Date is missing; weekly cap check skipped.",
      meta: {
        skipped: true,
        reason: REASON_CODES.DATE_MISSING,
      },
    });
  }

  const currentCount = Number(context?.person?.weeklyCounts?.[weekKey] || 0);
  if (currentCount + 1 > max) {
    return makeRuleFail({
      code: RULE_CODES.MAX_WEEKLY_SHIFTS,
      message: "Weekly shift cap would be exceeded.",
      meta: {
        reason: REASON_CODES.MAX_WEEKLY_SHIFTS_EXCEEDED,
        weekKey,
        currentCount,
        attemptedCount: currentCount + 1,
        maxAllowed: max,
      },
    });
  }

  return makeRulePass({
    code: RULE_CODES.MAX_WEEKLY_SHIFTS,
    message: "Weekly shift cap allows this assignment.",
    meta: {
      weekKey,
      currentCount,
      attemptedCount: currentCount + 1,
      maxAllowed: max,
    },
  });
}

function normalizeDate(input) {
  if (!input) return null;
  const raw = String(input).trim();
  if (!raw) return null;
  const isoCandidate = raw.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoCandidate)) return isoCandidate;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function getISOWeekKey(dateStr) {
  if (!dateStr) return null;
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

module.exports = maxWeeklyShiftsRule;
