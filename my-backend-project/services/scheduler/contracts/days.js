"use strict";

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

function normalizeShift(shift = {}) {
  const normalizedCode = String(shift?.code || shift?.id || "").trim();
  const normalizedId = String(shift?.id || normalizedCode).trim();

  return {
    ...shift,
    id: normalizedId || normalizedCode,
    code: normalizedCode || normalizedId,
    requiredCount: Math.max(0, Number(shift?.requiredCount || 0) || 0),
    hours: Number.isFinite(Number(shift?.hours)) ? Number(shift.hours) : shift?.hours,
    start: shift?.start || null,
    end: shift?.end || null,
    isNight: shift?.isNight === true,
  };
}

function normalizeDay(day = {}) {
  const date = normalizeDate(day?.date || day?.day);
  const weekday =
    Number.isFinite(Number(day?.weekday)) ? Number(day.weekday) : new Date(`${date}T00:00:00Z`).getUTCDay();
  const shifts = Array.isArray(day?.shifts) ? day.shifts.map((shift) => normalizeShift(shift)) : [];

  return {
    ...day,
    date,
    day: day?.day ?? date,
    weekday: Number.isFinite(weekday) ? weekday : null,
    shifts,
  };
}

function normalizeDays(days = []) {
  if (!Array.isArray(days)) return [];
  return days
    .map((day) => normalizeDay(day))
    .filter((day) => day?.date && Array.isArray(day.shifts));
}

module.exports = {
  normalizeDate,
  normalizeShift,
  normalizeDay,
  normalizeDays,
};
