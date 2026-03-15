"use strict";

/**
 * V3 policy starter: reward candidates with lighter monthly load.
 * This policy does not filter candidates; it only contributes ordering score.
 */
function fairnessPolicy(candidate = {}, _context = {}) {
  const assignmentsThisMonthRaw = candidate?.person?.stats?.assignmentsThisMonth;
  const assignmentsThisMonth = Number(assignmentsThisMonthRaw || 0);
  const score = Number.isFinite(assignmentsThisMonth) ? -assignmentsThisMonth : 0;
  const statsMissing = assignmentsThisMonthRaw == null;

  return {
    policy: "FAIRNESS",
    score,
    reason: statsMissing ? "ASSIGNMENTS_THIS_MONTH_MISSING" : null,
    meta: {
      assignmentsThisMonth: Number.isFinite(assignmentsThisMonth) ? assignmentsThisMonth : 0,
      neutral: score === 0,
      statsMissing,
    },
  };
}

module.exports = fairnessPolicy;
