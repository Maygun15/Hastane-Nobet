// services/scheduler/constraints.js

const parseTime = (s) => {
  if (!s) return null;
  const m = String(s).match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return hh * 60 + mm;
};

const daysBetween = (a, b) => {
  if (!a || !b) return null;
  const da = new Date(`${a}T00:00:00Z`);
  const db = new Date(`${b}T00:00:00Z`);
  return Math.round((db - da) / (24 * 60 * 60 * 1000));
};

const shiftIsNight = (shift) => {
  if (!shift) return false;
  if (shift.isNight) return true;
  const code = String(shift.code || shift.id || "").toUpperCase();
  return code.includes("N");
};

const normalizeCode = (s) =>
  (s || "")
    .toString()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase()
    .trim();

const normalizeArea = (s) =>
  (s || "")
    .toString()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();

const getPersonAreas = (person) => {
  const raw = person?.meta?.areas || person?.meta?.duties || person?.areas || [];
  if (Array.isArray(raw)) return raw.map(normalizeArea).filter(Boolean);
  if (typeof raw === "string") return raw.split(",").map(normalizeArea).filter(Boolean);
  return [];
};

const getPersonShiftCodes = (person) => {
  const raw =
    person?.meta?.shiftCodes ||
    person?.shiftCodes ||
    person?.meta?.shifts ||
    person?.shifts ||
    [];
  if (Array.isArray(raw)) return raw.map(normalizeCode).filter(Boolean);
  if (typeof raw === "string") return raw.split(/[,;/-]/).map(normalizeCode).filter(Boolean);
  return [];
};

const getShiftArea = (shift) => {
  if (!shift) return "";
  return normalizeArea(shift.area || shift.label || shift.name || "");
};

function isAvailable(person, day, context, shift) {
  if (!person || !day) return false;
  const rules = context?.rules || {};
  const leaves = context?.leavesByPerson || {};
  const dayKey = day.date;
  if (!dayKey) return false;
  const debug = context?.debug || {};
  const logBlock = debug?.logBlocks
    ? (reason) => {
        try {
          console.log("[SCHED-BLOCK]", reason, { pid: person?.id, date: dayKey, shift: shift?.code || shift?.id || "" });
        } catch {}
      }
    : null;

  // AREA ELIGIBILITY (çalışma alanı)
  if (shift) {
    const areas = getPersonAreas(person);
    const shiftArea = getShiftArea(shift);
    // Alan tanımlı değilse görev verilmeyecek
    if (areas.length === 0) {
      if (logBlock) logBlock("NO_AREAS");
      return false;
    }
    // Shift alanı boşsa filtre uygulamayız
    if (shiftArea && !areas.includes(shiftArea)) {
      if (logBlock) logBlock("AREA_NOT_ALLOWED");
      return false;
    }
  }

  // SHIFT CODE ELIGIBILITY (vardiya kodu)
  if (shift) {
    const codes = getPersonShiftCodes(person);
    const shiftCode = normalizeCode(shift.code || shift.id || "");
    if (shiftCode && codes.length && !codes.includes(shiftCode)) {
      if (logBlock) logBlock("SHIFT_CODE_NOT_ALLOWED");
      return false;
    }
  }

  // ONE_SHIFT_PER_DAY
  if (rules.ONE_SHIFT_PER_DAY && Array.isArray(person.assignedDays) && person.assignedDays.includes(dayKey)) {
    if (logBlock) logBlock("ONE_SHIFT_PER_DAY");
    return false;
  }

  // LEAVE_BLOCK
  if (rules.LEAVE_BLOCK) {
    const lv = leaves[person.id];
    if (lv && (lv instanceof Set ? lv.has(dayKey) : Array.isArray(lv) && lv.includes(dayKey))) {
      if (logBlock) logBlock("LEAVE_BLOCK");
      return false;
    }
  }

  // MAX_CONSECUTIVE_DAYS
  if (rules.MAX_CONSECUTIVE_DAYS) {
    const max = Number(rules.MAX_CONSECUTIVE_DAYS);
    if (Number.isFinite(max) && max > 0) {
      const diff = daysBetween(person.lastAssignedDate, dayKey);
      const nextCons = diff === 1 ? (Number(person.consecutiveDays || 0) + 1) : 1;
      if (nextCons > max) {
        if (logBlock) logBlock("MAX_CONSECUTIVE_DAYS");
        return false;
      }
    }
  }

  // NIGHT_NEXT_DAY_OFF
  if (rules.NIGHT_NEXT_DAY_OFF && person.lastShift && shiftIsNight(person.lastShift)) {
    const diff = daysBetween(person.lastShift.date, dayKey);
    if (diff === 1) {
      if (logBlock) logBlock("NIGHT_NEXT_DAY_OFF");
      return false;
    }
  }

  // MIN_REST_HOURS
  if (rules.MIN_REST_HOURS && person.lastShift) {
    const minRest = Number(rules.MIN_REST_HOURS);
    if (Number.isFinite(minRest) && minRest > 0) {
      const prev = person.lastShift;
      const prevStart = parseTime(prev.start);
      const prevEndRaw = parseTime(prev.end);
      const currStart = parseTime(shift?.start);
      let prevEnd = prevEndRaw;
      if (prevStart != null && prevEnd != null && prevEnd <= prevStart) prevEnd += 24 * 60;

      if (prevEnd != null && currStart != null) {
        const prevBase = new Date(`${prev.date}T00:00:00Z`).getTime();
        const currBase = new Date(`${dayKey}T00:00:00Z`).getTime();
        const prevAbs = prevBase + prevEnd * 60 * 1000;
        const currAbs = currBase + currStart * 60 * 1000;
        const restHours = (currAbs - prevAbs) / (1000 * 60 * 60);
        if (restHours < minRest) {
          if (logBlock) logBlock("MIN_REST_HOURS");
          return false;
        }
      } else {
        const diff = daysBetween(prev.date, dayKey);
        if (diff === 0 && minRest > 0) {
          if (logBlock) logBlock("MIN_REST_HOURS");
          return false;
        }
        if (diff === 1 && minRest > 24) {
          if (logBlock) logBlock("MIN_REST_HOURS");
          return false;
        }
      }
    }
  }

  return true;
}

module.exports = { isAvailable };
