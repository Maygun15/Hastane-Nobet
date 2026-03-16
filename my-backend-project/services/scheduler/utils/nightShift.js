"use strict";

// Canonical true-night codes used by candidateBuilder hard authority.
const NIGHT_CODES = Object.freeze(["N", "NIGHT"]);
// Night-equivalent codes still require next-day cleanup/rest, but are not
// treated as canonical "true night" for candidate selection authority.
const NIGHT_EQUIVALENT_CODES = Object.freeze(["V2"]);

function normalizeNightCode(value) {
  if (value == null) return null;
  const normalized = String(value).trim().toUpperCase();
  return normalized || null;
}

function isNightShiftCode(code) {
  const normalized = normalizeNightCode(code);
  return normalized ? NIGHT_CODES.includes(normalized) : false;
}

function isNightEquivalentShiftCode(code) {
  const normalized = normalizeNightCode(code);
  return normalized ? NIGHT_EQUIVALENT_CODES.includes(normalized) : false;
}

function isNightCleanupCode(code) {
  return isNightShiftCode(code) || isNightEquivalentShiftCode(code);
}

function isNightShift(shift) {
  if (!shift || typeof shift !== "object") return false;
  if (shift.isNight === true) return true;
  return isNightShiftCode(shift.code || shift.id || null);
}

module.exports = {
  NIGHT_CODES,
  NIGHT_EQUIVALENT_CODES,
  normalizeNightCode,
  isNightShiftCode,
  isNightEquivalentShiftCode,
  isNightCleanupCode,
  isNightShift,
};
