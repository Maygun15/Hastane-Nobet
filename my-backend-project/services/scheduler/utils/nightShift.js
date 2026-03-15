"use strict";

const NIGHT_CODES = Object.freeze(["N", "NIGHT"]);
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

function isNightShift(shift) {
  if (!shift || typeof shift !== "object") return false;
  if (shift.isNight === true) return true;
  return isNightShiftCode(shift.code || shift.id || null);
}

module.exports = {
  NIGHT_CODES,
  NIGHT_EQUIVALENT_CODES,
  isNightShiftCode,
  isNightShift,
};
