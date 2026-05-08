// services/scheduler/constraints.js

const {
  isNightEquivalentShiftCode,
  isNightShift,
  normalizeNightCode,
} = require("./utils/nightShift");

// Runtime guard layer for optimized scheduler:
// - keeps imperative/live-state checks close to assignment-time availability
// - may temporarily carry transitional hard authority where candidateBuilder
//   ownership is not fully aligned yet
// - does not replace validator safety-net cleanup

const parseTime = (s) => {
  if (!s) return null;
  const m = String(s).match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
};

const getISOWeekKey = (dateStr) => {
  if (!dateStr) return null;
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
};

const daysBetween = (a, b) => {
  if (!a || !b) return null;
  return Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);
};

const shiftIsNight = (shift) => {
  if (!shift) return false;
  return isNightShift(shift);
};

const normalizeCode = (s) =>
  (s || "").toString().normalize("NFD").replace(/\p{Diacritic}/gu, "").toUpperCase().trim();

const normalizeArea = (s) =>
  (s || "")
    .toString()
    .replace(/İ/g, "i").replace(/I/g, "i").replace(/ı/g, "i")
    .replace(/Ğ/g, "g").replace(/ğ/g, "g")
    .replace(/Ü/g, "u").replace(/ü/g, "u")
    .replace(/Ş/g, "s").replace(/ş/g, "s")
    .replace(/Ö/g, "o").replace(/ö/g, "o")
    .replace(/Ç/g, "c").replace(/ç/g, "c")
    .toLowerCase()
    .trim();

const NOISE_WORDS = new Set(["alan", "alani", "gorev", "gorevi", "gorevlendirme", "birim", "birimi", "unit", "ve", "veya", "yada", "ile"]);

const splitAreaTokens = (s) => {
  const base = normalizeArea(s);
  if (!base) return [];
  return base
    .replace(/[\(\)\[\]\{\}]/g, " ")
    .replace(/&|\+|\/|\\|,|;|-|_/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t && t.length > 1 && !NOISE_WORDS.has(t));
};

const getPersonAreas = (person) => {
  const raw = person?.meta?.areas || person?.meta?.duties || person?.areas || [];
  if (Array.isArray(raw)) return raw.map(normalizeArea).filter(Boolean);
  if (typeof raw === "string") return raw.split(",").map(normalizeArea).filter(Boolean);
  return [];
};

const getPersonSupervisorSignals = (person) => {
  const values = [
    ...(Array.isArray(person?.meta?.skills) ? person.meta.skills : []),
    ...(Array.isArray(person?.meta?.tags) ? person.meta.tags : []),
    ...(Array.isArray(person?.meta?.duties) ? person.meta.duties : []),
    ...(Array.isArray(person?.meta?.areas) ? person.meta.areas : []),
    ...(Array.isArray(person?.areas) ? person.areas : []),
    person?.role,
    person?.title,
    person?.meta?.role,
    person?.meta?.title,
    person?.meta?.unvan,
  ];
  return values.map(normalizeArea).filter(Boolean);
};

const hasServiceSupervisorEligibility = (person) => {
  const signals = getPersonSupervisorSignals(person);
  if (!signals.length) return false;
  return signals.some((value) =>
    value.includes("servis sorumlu") ||
    value.includes("supervisor") ||
    value.includes("supervizor") ||
    value === "sorumlu"
  );
};

const getPersonShiftCodes = (person) => {
  const raw = person?.meta?.shiftCodes || person?.shiftCodes || person?.meta?.shifts || person?.shifts || [];
  if (Array.isArray(raw)) return raw.map(normalizeCode).filter(Boolean);
  if (typeof raw === "string") return raw.split(/[,;/-]/).map(normalizeCode).filter(Boolean);
  return [];
};

const getShiftArea = (shift) => normalizeArea(shift?.area || shift?.label || shift?.name || "");
const getShiftKey = (shift) => normalizeCode(shift?.id || shift?.code || shift?.label || shift?.name || "");
const isServiceSupervisorLabel = (label = "") => normalizeArea(label).includes("servis sorumlu");

function areaMatches(personAreas, shiftArea) {
  if (!shiftArea) return true;
  if (personAreas.includes(shiftArea)) return true;
  const shiftTokens = splitAreaTokens(shiftArea);
  if (shiftTokens.length === 0) return true;
  for (const personArea of personAreas) {
    const personTokens = splitAreaTokens(personArea);
    const matchCount = shiftTokens.filter((t) => personTokens.includes(t)).length;
    if (matchCount > 0 && matchCount >= Math.ceil(shiftTokens.length / 2)) return true;
    if (personArea.includes(shiftArea) || shiftArea.includes(personArea)) return true;
  }
  return false;
}

function buildBlockLogger(context, person, day, shift) {
  const collectBlock = typeof context?.debug?.collectBlock === "function" ? context.debug.collectBlock : null;
  const logBlocks = context?.debug?.logBlocks === true;

  if (!collectBlock && !logBlocks) return null;

  return (reason) => {
    const safeReason = reason || "UNAVAILABLE";
    const meta = {
      pid: person?.id,
      name: person?.name,
      date: day?.date,
      shift: shift?.code || shift?.id || "",
      area: shift?.label || shift?.name || "",
    };
    if (collectBlock) collectBlock(safeReason, meta);
    if (logBlocks) console.log("[SCHED-BLOCK]", safeReason, meta);
  };
}

function explainAvailability(person, day, context, shift) {
  if (!person || !day) return { allowed: false, reason: "INVALID_INPUT" };
  const rules = context?.rules || {};
  const leaves = context?.leavesByPerson || {};
  const dayKey = day.date;
  if (!dayKey) return { allowed: false, reason: "INVALID_DAY" };

  if (context?.ruleEngine && shift) {
    const allow = context.ruleEngine.checkPersonEligibility(
      person,
      shift?.code || shift?.id || null,
      {
        date: dayKey,
        isNightShift: shiftIsNight(shift),
        taskType: shift?.taskType || shift?.type || null,
      }
    );
    if (!allow?.eligible) return { allowed: false, reason: allow.reason || "RULE_ENGINE" };
  }

  if (shift) {
    const shiftArea = getShiftArea(shift);
    if (isServiceSupervisorLabel(shiftArea) && !hasServiceSupervisorEligibility(person)) {
      return { allowed: false, reason: "SERVICE_SUPERVISOR_ONLY" };
    }

    const areas = getPersonAreas(person);
    if (shiftArea && areas.length === 0) {
      return { allowed: false, reason: "AREA_PROFILE_MISSING" };
    }
    if (areas.length > 0 && shiftArea && !areaMatches(areas, shiftArea)) {
      return { allowed: false, reason: "AREA_NOT_ALLOWED" };
    }
  }

  if (shift) {
    const codes = getPersonShiftCodes(person);
    const shiftCode = normalizeCode(shift.code || shift.id || "");
    if (shiftCode && codes.length && !codes.includes(shiftCode)) {
      return { allowed: false, reason: "SHIFT_CODE_NOT_ALLOWED" };
    }
  }

  if (rules.ONE_SHIFT_PER_DAY && Array.isArray(person.assignedDays) && person.assignedDays.includes(dayKey)) {
    return { allowed: false, reason: "ONE_SHIFT_PER_DAY" };
  }

  if (rules.LEAVE_BLOCK) {
    const lv = leaves[person.id];
    if (lv && (lv instanceof Set ? lv.has(dayKey) : Array.isArray(lv) && lv.includes(dayKey))) {
      return { allowed: false, reason: "LEAVE_BLOCK" };
    }
  }

  if (rules.MAX_CONSECUTIVE_DAYS) {
    const max = Number(rules.MAX_CONSECUTIVE_DAYS);
    if (Number.isFinite(max) && max > 0) {
      const diff = daysBetween(person.lastAssignedDate, dayKey);
      const nextCons = diff === 1 ? Number(person.consecutiveDays || 0) + 1 : 1;
      if (nextCons > max) return { allowed: false, reason: "MAX_CONSECUTIVE_DAYS" };
    }
  }

  if (rules.NIGHT_NEXT_DAY_OFF && person.lastShift && shiftIsNight(person.lastShift)) {
    if (daysBetween(person.lastShift.date, dayKey) === 1) {
      return { allowed: false, reason: "NIGHT_NEXT_DAY_OFF" };
    }
  }

  const prevShiftCode = person.lastShift
    ? normalizeNightCode(person.lastShift.code || person.lastShift.id || person.lastShift.shiftCode || "")
    : "";

  if (person.lastShift) {
    if ((prevShiftCode === "N" || isNightEquivalentShiftCode(prevShiftCode)) && daysBetween(person.lastShift.date, dayKey) === 1) {
      return { allowed: false, reason: "NIGHT_24H_NEXT_DAY_BLOCK" };
    }
  }

  if (rules.MIN_REST_HOURS && person.lastShift) {
    const minRest = Number(rules.MIN_REST_HOURS);
    if (Number.isFinite(minRest) && minRest > 0) {
      const prev = person.lastShift;
      const prevStart = parseTime(prev.start);
      const prevEndRaw = parseTime(prev.end);
      const currStart = parseTime(shift?.start);
      let prevEnd = prevEndRaw;
      if (prevStart != null && prevEnd != null && prevEnd <= prevStart) prevEnd += 1440;
      if (prevEnd != null && currStart != null) {
        const restHours =
          (new Date(`${dayKey}T00:00:00Z`).getTime() + currStart * 60000 -
            new Date(`${prev.date}T00:00:00Z`).getTime() -
            prevEnd * 60000) /
          3600000;
        if (restHours < minRest) return { allowed: false, reason: "MIN_REST_HOURS" };
      } else {
        const diff = daysBetween(prev.date, dayKey);
        if ((diff === 0 && minRest > 0) || (diff === 1 && minRest > 24)) {
          return { allowed: false, reason: "MIN_REST_HOURS" };
        }
      }
    }
  }

  if (rules.MAX_SHIFTS_PER_WEEK) {
    const max = Number(rules.MAX_SHIFTS_PER_WEEK);
    if (Number.isFinite(max) && max > 0) {
      const wk = getISOWeekKey(dayKey);
      if (wk && Number(person.weeklyCounts?.[wk] || 0) >= max) {
        return { allowed: false, reason: "MAX_SHIFTS_PER_WEEK" };
      }
    }
  }

  if (rules.MAX_TASK_PER_PERSON && shift) {
    const max = Number(rules.MAX_TASK_PER_PERSON);
    if (Number.isFinite(max) && max > 0) {
      const key = getShiftKey(shift);
      if (key && Number(person.taskCounts?.[key] || 0) >= max) {
        return { allowed: false, reason: "MAX_TASK_PER_PERSON" };
      }
    }
  }

  return { allowed: true, reason: null };
}

function isAvailable(person, day, context, shift) {
  const result = explainAvailability(person, day, context, shift);
  if (!result.allowed) {
    const logBlock = buildBlockLogger(context, person, day, shift);
    if (logBlock) logBlock(result.reason || "UNAVAILABLE");
  }
  return result.allowed;
}

module.exports = { isAvailable, explainAvailability, areaMatches, normalizeArea, splitAreaTokens };
