import {
  buildPersonIdentityIndex,
  canonName,
  resolvePersonRef,
} from "./personIdentity.js";
import { shiftDurationHours } from "./date.js";

const NIGHT_CODE_MARKERS = ["N", "GECE", "V2", "SV", "24"];
const ZERO_HOUR_CODES = ["Y", "YILLIK", "E", "R", "I", "İ", "B", "RAPOR", "AN"];

function roundHours(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function shiftKeyCandidates(raw = "") {
  const base = String(raw || "").trim().toUpperCase();
  if (!base) return [];
  const out = new Set([base]);
  const compact = base.replace(/\s+/g, " ").trim();
  if (compact) out.add(compact);
  const firstToken = compact.split(/[()\s/-]+/).find(Boolean);
  if (firstToken) out.add(firstToken);
  return Array.from(out.values());
}

function extractShiftMeta(item) {
  if (!item || typeof item !== "object") return null;
  const code = String(
    item.code ??
    item.id ??
    item.shiftCode ??
    item.vardiyaKodu ??
    item.vardiya ??
    item.name ??
    ""
  ).trim();
  const label = String(
    item.label ??
    item.name ??
    item.area ??
    item.title ??
    ""
  ).trim();
  const start = String(
    item.start ??
    item.from ??
    item.begin ??
    item.startTime ??
    ""
  ).trim();
  const end = String(
    item.end ??
    item.to ??
    item.finish ??
    item.endTime ??
    ""
  ).trim();
  const rawHours = item.hours ?? item.duration ?? item.totalHours ?? null;
  return { code, label, start, end, rawHours };
}

function fallbackShiftHours(code = "", label = "") {
  const c = String(code || "").trim().toUpperCase();
  const lbl = String(label || "").trim().toUpperCase();

  if (ZERO_HOUR_CODES.includes(c) || c.includes("IZIN") || c.includes("İZİN") || lbl.includes("IZIN") || lbl.includes("İZİN")) {
    return 0;
  }
  if (c === "A" || /^A[\s/_-]/.test(c) || c.includes("4")) return 4;
  if (c === "V1" || /^V1[\s/_-]/.test(c)) return 16;
  if (c.includes("8") || c === "M" || c === "GUND") return 8;
  if (c.includes("12")) return 12;
  if (["YARIM", "HALF"].some((k) => c.includes(k)) || lbl.includes("YARIM") || lbl.includes("4 SAAT")) return 4;
  if (NIGHT_CODE_MARKERS.some((k) => c.includes(k))) return 24;
  if (lbl.includes("POL") || lbl.includes("GÜNDÜZ") || lbl.includes("KISA")) return 8;
  if (lbl.includes("NÖBET") || lbl.includes("GECE") || lbl.includes("SORUMLU") || lbl.includes("RESÜS") || lbl.includes("TRİAJ") || lbl.includes("CERRAHİ")) {
    return 24;
  }
  return 0;
}

export function createPlanWorkHourResolver(workingHours = []) {
  const map = new Map();
  (Array.isArray(workingHours) ? workingHours : []).forEach((item) => {
    const meta = extractShiftMeta(item);
    if (!meta) return;
    const code = String(meta.code || "").trim().toUpperCase();
    if (!code) return;

    let hours = NaN;
    if (meta.rawHours !== undefined && meta.rawHours !== null && String(meta.rawHours).trim() !== "") {
      hours = Number(String(meta.rawHours).replace(",", "."));
    } else if (meta.start && meta.end) {
      hours = shiftDurationHours(meta.start, meta.end);
    }
    if (Number.isFinite(hours) && hours >= 0) {
      shiftKeyCandidates(code).forEach((key) => {
        map.set(key, roundHours(hours));
      });
      if (meta.label) {
        shiftKeyCandidates(meta.label).forEach((key) => {
          if (!map.has(key)) map.set(key, roundHours(hours));
        });
      }
    }
  });

  return (code, label = "") => {
    const codeKeys = shiftKeyCandidates(code);
    for (const key of codeKeys) {
      const mapped = map.get(key);
      if (Number.isFinite(mapped) && mapped >= 0) return roundHours(mapped);
    }
    const labelKeys = shiftKeyCandidates(label);
    for (const key of labelKeys) {
      const mapped = map.get(key);
      if (Number.isFinite(mapped) && mapped >= 0) return roundHours(mapped);
    }
    const primaryCode = codeKeys[0] || String(code || "").trim().toUpperCase();
    return roundHours(fallbackShiftHours(primaryCode, label));
  };
}

function toAssignmentDate(item, day, year, month) {
  const rawDate = String(item?.date || item?.day || "").slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) return rawDate;
  if (Number.isFinite(day) && year && month) return `${year}-${pad2(month)}-${pad2(day)}`;
  return rawDate;
}

function toAssignmentDay(item, date) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return Number(date.slice(8, 10));
  return Number(item?.dayNum || item?.day || item?.d);
}

export function normalizePlanAssignments(assignments = [], {
  people = [],
  resolveHours,
  year,
  month,
  preferExplicitHours = true,
} = {}) {
  const peopleIndex = buildPersonIdentityIndex(people);
  const resolve =
    typeof resolveHours === "function"
      ? resolveHours
      : createPlanWorkHourResolver([]);

  const out = [];
  for (const item of Array.isArray(assignments) ? assignments : []) {
    if (!item || typeof item !== "object") continue;
    const rawDay = Number(item.dayNum || item.day || item.d);
    const date = toAssignmentDate(item, rawDay, year, month);
    const day = toAssignmentDay(item, date);
    if (!Number.isFinite(day) || day < 1 || day > 31) continue;

    const person = resolvePersonRef(
      {
        personId: String(item.personId || item.pid || item.staffId || "").trim(),
        name: item.personName || item.name || "",
      },
      peopleIndex
    );
    const personId = String(person?.id || item.personId || item.pid || item.staffId || "").trim();
    const personName = person?.fullName || person?.name || item.personName || item.name || "";
    const explicit = Number(item.hours);
    const hasExplicit = Number.isFinite(explicit) && explicit > 0;
    const resolvedHours = resolve(
      item.shiftCode || item.shift || item.code || "",
      item.roleLabel || item.rowLabel || item.label || item.area || ""
    );
    let hours;
    if (preferExplicitHours) {
      // stored hours win; resolver is the fallback
      hours = hasExplicit ? roundHours(explicit) : resolvedHours;
    } else {
      // resolver wins; stored hours are the safety-net fallback when resolver returns 0
      hours = resolvedHours > 0 ? resolvedHours : (hasExplicit ? roundHours(explicit) : 0);
    }
    if (!(hours > 0)) continue;

    out.push({
      personId,
      personName,
      personKey: personId ? `id:${personId}` : `name:${canonName(personName)}`,
      date,
      day,
      shiftCode: String(item.shiftCode || item.shift || item.code || "").trim(),
      rowLabel: String(item.roleLabel || item.rowLabel || item.label || item.area || "").trim(),
      hours,
      raw: item,
    });
  }
  return out.sort((a, b) => {
    const left = `${a.personKey}|${a.date || ""}|${a.shiftCode}|${a.rowLabel}|${a.hours}`;
    const right = `${b.personKey}|${b.date || ""}|${b.shiftCode}|${b.rowLabel}|${b.hours}`;
    return left.localeCompare(right, "tr", { sensitivity: "base" });
  });
}

export function groupAssignmentsByPersonAndDay(assignments = [], opts = {}) {
  const normalized = normalizePlanAssignments(assignments, opts);
  const byPerson = new Map();

  normalized.forEach((item) => {
    const key = item.personKey;
    if (!key) return;
    if (!byPerson.has(key)) {
      byPerson.set(key, {
        personId: item.personId || "",
        personName: item.personName || "",
        byDay: {},
        totalHours: 0,
        assignments: [],
      });
    }
    const entry = byPerson.get(key);
    if (!entry.personId && item.personId) entry.personId = item.personId;
    if (!entry.personName && item.personName) entry.personName = item.personName;
    entry.byDay[item.day] = roundHours((Number(entry.byDay[item.day]) || 0) + item.hours);
    entry.totalHours = roundHours((Number(entry.totalHours) || 0) + item.hours);
    entry.assignments.push(item);
  });

  return byPerson;
}

export function buildPersonDayHoursMapFromAssignments(assignments = [], opts = {}) {
  return groupAssignmentsByPersonAndDay(assignments, opts);
}

export function sumWorkedHoursForPersonMonth(assignments = [], personId = "", {
  personName = "",
  people = [],
  resolveHours,
  preferExplicitHours = true,
} = {}) {
  const byPerson = groupAssignmentsByPersonAndDay(assignments, { people, resolveHours, preferExplicitHours });
  const key = personId ? `id:${String(personId).trim()}` : `name:${canonName(personName)}`;
  return roundHours(byPerson.get(key)?.totalHours || 0);
}

export function buildMonthlyTotalsFromAssignments(assignments = [], opts = {}) {
  return Array.from(groupAssignmentsByPersonAndDay(assignments, opts).values())
    .map((entry) => ({
      personId: entry.personId || "",
      personName: entry.personName || "",
      totalHours: roundHours(entry.totalHours || 0),
      dayCount: Object.values(entry.byDay || {}).filter((hours) => Number(hours) > 0).length,
      byDay: { ...(entry.byDay || {}) },
      assignments: Array.isArray(entry.assignments) ? [...entry.assignments] : [],
    }))
    .sort((a, b) =>
      String(a.personName || "").localeCompare(String(b.personName || ""), "tr", { sensitivity: "base" })
    );
}

export function buildMonthlyTotalsIndex(assignments = [], opts = {}) {
  const out = new Map();
  for (const entry of buildMonthlyTotalsFromAssignments(assignments, opts)) {
    const personId = String(entry?.personId || "").trim();
    const personNameKey = canonName(entry?.personName || "");
    if (personId) out.set(`id:${personId}`, entry);
    if (personNameKey && !out.has(`name:${personNameKey}`)) {
      out.set(`name:${personNameKey}`, entry);
    }
  }
  return out;
}
