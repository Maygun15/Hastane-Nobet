"use strict";

/**
 * Prefers candidates who are still below expected hour/shift targets.
 * This is ordering-only and intentionally capped so it stays a soft tie-break.
 */
function workloadBalancePolicy(candidate = {}, context = {}) {
  const person = candidate?.person || {};
  const totalHours = normalizeNumber(person?.totalHours);
  const totalShifts = normalizeNumber(person?.totalShifts);
  const targetHours = normalizeNumber(context?.targetHours);
  const targetShifts = normalizeNumber(context?.targetShifts);

  const hasHourTarget = targetHours > 0;
  const hasShiftTarget = targetShifts > 0;
  if (!hasHourTarget && !hasShiftTarget) {
    return {
      policy: "WORKLOAD_BALANCE",
      score: 0,
      reason: "WORKLOAD_TARGETS_MISSING",
      meta: {
        totalHours,
        totalShifts,
        targetHours,
        targetShifts,
        neutral: true,
        missingTargets: true,
      },
    };
  }

  const hourBalanceScore = hasHourTarget
    ? clamp((targetHours - totalHours) / Math.max(targetHours, 1), -1, 1)
    : 0;
  const shiftBalanceScore = hasShiftTarget
    ? clamp((targetShifts - totalShifts) / Math.max(targetShifts, 1), -1, 1)
    : 0;

  const activeSignals = Number(hasHourTarget) + Number(hasShiftTarget);
  const score = activeSignals > 0
    ? round((hourBalanceScore + shiftBalanceScore) / activeSignals, 3)
    : 0;

  return {
    policy: "WORKLOAD_BALANCE",
    score,
    reason: score === 0 ? "WORKLOAD_ALREADY_BALANCED" : null,
    meta: {
      totalHours,
      totalShifts,
      targetHours,
      targetShifts,
      hourBalanceScore: round(hourBalanceScore, 3),
      shiftBalanceScore: round(shiftBalanceScore, 3),
      neutral: score === 0,
      missingTargets: false,
    },
  };
}

function normalizeNumber(value) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function round(value, precision = 3) {
  const factor = 10 ** precision;
  return Math.round(Number(value || 0) * factor) / factor;
}

module.exports = workloadBalancePolicy;
