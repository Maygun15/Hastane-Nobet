"use strict";

// Gece ve hafta sonu adalet dengesi (ROADMAP pilot #3).
//
// - Gece: gece vardiyası veya geceyi kapsayan vardiya (ör. V2 / 24 saat).
// - Hafta sonu: Cumartesi, Pazar veya tam gün resmi tatil (holidayKind = 'full').
//
// Motor her atamada kişinin nightCount / weekendCount sayacını artırır;
// hedef = aydaki toplam gece (hafta sonu) slotu / personel sayısı.
// Puanlama, hedefin üstüne çıkan kişiyi geri iter (scoring.js).

const { isNightShift, isNightEquivalentShiftCode } = require("./utils/nightShift");

function isNightLikeShift(shift) {
  if (!shift) return false;
  return isNightShift(shift) || isNightEquivalentShiftCode(shift.code || shift.id || shift.shiftCode || "");
}

function isWeekendLikeDay(day) {
  if (!day) return false;
  const weekday = Number(day.weekday);
  if (weekday === 0 || weekday === 6) return true;
  return String(day.holidayKind || "").toLowerCase() === "full";
}

/** Motorun gerçekte doldurduğu slot sayısıyla aynı hesap: her vardiya en az 1 kişi. */
function slotCount(shift) {
  return Math.max(1, Number(shift?.requiredCount || 1));
}

function computeFairnessTargets(days = [], staffCount = 0) {
  let nightSlots = 0;
  let weekendSlots = 0;
  for (const day of Array.isArray(days) ? days : []) {
    const weekend = isWeekendLikeDay(day);
    for (const shift of Array.isArray(day?.shifts) ? day.shifts : []) {
      const n = slotCount(shift);
      if (isNightLikeShift(shift)) nightSlots += n;
      if (weekend) weekendSlots += n;
    }
  }
  const count = Number(staffCount) > 0 ? Number(staffCount) : 0;
  return {
    nightSlots,
    weekendSlots,
    targetNights: count ? nightSlots / count : 0,
    targetWeekendShifts: count ? weekendSlots / count : 0,
  };
}

/** Atama sonrası kişinin sayaçlarını günceller. */
function recordFairnessCounters(person, day, shift) {
  if (!person) return;
  if (isNightLikeShift(shift)) person.nightCount = Number(person.nightCount || 0) + 1;
  if (isWeekendLikeDay(day)) person.weekendCount = Number(person.weekendCount || 0) + 1;
}

/**
 * Hedefi aşan kişiye ceza: (sayaç - hedef) * ağırlık, sadece ilgili slotta.
 * Hedefin altındaki kişi negatif puan (avantaj) alır.
 */
function fairnessBalancePenalty(person, day, shift, context, weights = {}) {
  let score = 0;
  if (isNightLikeShift(shift)) {
    const target = Number(context?.targetNights || 0);
    const w = Number(weights.nightBalance ?? 10);
    score += (Number(person?.nightCount || 0) - target) * w;
  }
  if (isWeekendLikeDay(day)) {
    const target = Number(context?.targetWeekendShifts || 0);
    const w = Number(weights.weekendBalance ?? 8);
    score += (Number(person?.weekendCount || 0) - target) * w;
  }
  return score;
}

module.exports = {
  computeFairnessTargets,
  fairnessBalancePenalty,
  isNightLikeShift,
  isWeekendLikeDay,
  recordFairnessCounters,
};
