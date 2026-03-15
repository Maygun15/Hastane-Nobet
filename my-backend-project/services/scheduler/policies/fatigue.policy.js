"use strict";

/**
 * Applies a small ordering penalty for candidates with recent fatigue signals.
 * This policy is intentionally conservative and never filters candidates.
 */
function fatiguePolicy(candidate = {}, _context = {}) {
  const person = candidate?.person || {};
  const lastShift = person?.lastShift && typeof person.lastShift === "object" ? person.lastShift : null;
  const consecutiveDays = normalizeNumber(person?.consecutiveDays);
  const lastShiftIsNight = Boolean(lastShift?.isNight);

  const nightPenalty = lastShiftIsNight ? -0.3 : 0;
  const consecutivePenalty = consecutiveDays > 1
    ? -Math.min((consecutiveDays - 1) * 0.1, 0.4)
    : 0;
  const score = round(nightPenalty + consecutivePenalty, 3);

  let reason = null;
  if (lastShiftIsNight) {
    reason = "RECENT_NIGHT_SHIFT";
  } else if (consecutiveDays > 1) {
    reason = "CONSECUTIVE_DAYS_LOAD";
  } else if (!lastShift && consecutiveDays === 0) {
    reason = "FATIGUE_DATA_MINIMAL";
  }

  return {
    policy: "FATIGUE",
    score,
    reason,
    meta: {
      lastShiftDate: lastShift?.date || null,
      lastShiftCode: lastShift?.code || null,
      lastShiftIsNight,
      consecutiveDays,
      neutral: score === 0,
      fatigueSignalsPresent: lastShiftIsNight || consecutiveDays > 1,
    },
  };
}

function normalizeNumber(value) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function round(value, precision = 3) {
  const factor = 10 ** precision;
  return Math.round(Number(value || 0) * factor) / factor;
}

module.exports = fatiguePolicy;
