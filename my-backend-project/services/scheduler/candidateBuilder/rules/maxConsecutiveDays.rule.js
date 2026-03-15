"use strict";

const RULE_CODES = require("../ruleCodes");
const REASON_CODES = require("../reasonCodes");
const { makeRulePass, makeRuleFail } = require("../utils/candidateResult");

function maxConsecutiveDaysRule(context = {}) {
  const rules = context?.rules && typeof context.rules === "object" ? context.rules : {};
  const max = Number(rules.MAX_CONSECUTIVE_DAYS || 0);

  if (!Number.isFinite(max) || max <= 0) {
    return makeRulePass({
      code: RULE_CODES.MAX_CONSECUTIVE_DAYS,
      message: "Consecutive-day cap is not configured. Rule skipped.",
      meta: {
        skipped: true,
      },
    });
  }

  const targetDate = normalizeDate(context?.date || context?.day?.date || context?.day?.day);
  if (!targetDate) {
    return makeRulePass({
      code: RULE_CODES.MAX_CONSECUTIVE_DAYS,
      message: "Date is missing; consecutive-day check skipped.",
      meta: {
        skipped: true,
        reason: REASON_CODES.DATE_MISSING,
      },
    });
  }

  const lastAssignedDate = normalizeDate(context?.person?.lastAssignedDate);
  const currentConsecutive = Number(context?.person?.consecutiveDays || 0);
  const dayDiff = daysBetween(lastAssignedDate, targetDate);
  const nextConsecutive = dayDiff === 1 ? currentConsecutive + 1 : 1;

  if (nextConsecutive > max) {
    return makeRuleFail({
      code: RULE_CODES.MAX_CONSECUTIVE_DAYS,
      message: "Consecutive-day cap would be exceeded.",
      meta: {
        reason: REASON_CODES.MAX_CONSECUTIVE_DAYS_EXCEEDED,
        lastAssignedDate,
        currentConsecutive,
        attemptedConsecutive: nextConsecutive,
        maxAllowed: max,
      },
    });
  }

  return makeRulePass({
    code: RULE_CODES.MAX_CONSECUTIVE_DAYS,
    message: "Consecutive-day cap allows this assignment.",
    meta: {
      lastAssignedDate,
      currentConsecutive,
      attemptedConsecutive: nextConsecutive,
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

function daysBetween(a, b) {
  if (!a || !b) return null;
  const da = new Date(`${a}T00:00:00Z`);
  const db = new Date(`${b}T00:00:00Z`);
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return null;
  return Math.round((db - da) / 86400000);
}

module.exports = maxConsecutiveDaysRule;
