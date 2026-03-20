import { getMonthlySchedule } from "../api/apiAdapter.js";
import { LS } from "../utils/storage.js";

const pad2 = (n) => String(n).padStart(2, "0");
const canon = (s) =>
  (s || "")
    .trim()
    .toLocaleLowerCase("tr-TR")
    .replace(/\s+/g, " ");

function shiftHoursFromCode(code = "") {
  const c = String(code || "").toUpperCase();
  if (!c) return 0;
  if (c === "A" || /^A[\s/_-]?/.test(c)) return 4;
  if (/^M\d*$/.test(c) || c === "M") return 8;
  if (["Y", "YILLIK", "E", "R", "İ", "I", "B", "AN", "RAPOR"].includes(c)) return 0;
  if (c.includes("4")) return 4;
  if (c.includes("8")) return 8;
  if (c.includes("12")) return 12;
  if (["N", "V1", "V2", "SV", "24", "GECE"].some((k) => c.includes(k))) {
    return 24;
  }
  return 8;
}

function personIdOf(person) {
  return String(person?.id || person?._id || "").trim();
}

function personNameOf(person) {
  return person?.fullName || person?.name || "";
}

function addModelEntry(target, { personId = "", nameKey = "", day, entry }) {
  if (!Number.isFinite(day) || day < 1 || day > 31 || !entry) return;
  const pid = String(personId || "").trim();
  const canonNameKey = canon(nameKey || "");

  if (pid) {
    target.assignments[pid] = { ...(target.assignments[pid] || {}), [day]: entry };
    return;
  }

  if (canonNameKey) {
    target.byName[canonNameKey] = { ...(target.byName[canonNameKey] || {}), [day]: entry };
  }
}

function fromRowsV2(people = []) {
  const rows = LS.get("scheduleRowsV2", null);
  if (!Array.isArray(rows)) return null;

  const nameToId = new Map();
  for (const person of people || []) {
    const key = canon(personNameOf(person));
    const pid = personIdOf(person);
    if (key && pid) nameToId.set(key, pid);
  }

  const assignments = {};
  const byName = {};

  for (const row of rows) {
    for (const [col, val] of Object.entries(row || {})) {
      if (!val || col === "label" || col === "GOREV" || col === "GÖREV") continue;
      const m = String(col).match(/^(\d{2})\s/);
      if (!m) continue;
      const day = Number.parseInt(m[1], 10);
      const nameKey = canon(String(val));
      if (!nameKey || !day) continue;
      const personId = nameToId.get(nameKey) || "";
      const shiftCode = row.vardiya || row.shiftCode || "";
      const entry = {
        shiftCode,
        rowLabel: row.label || row.GOREV || row["GÖREV"] || "",
        hours: shiftHoursFromCode(shiftCode),
        source: "scheduleRowsV2",
      };
      addModelEntry({ assignments, byName }, { personId, nameKey, day, entry });
    }
  }

  return { assignments, byName };
}

function fromRosterFlat(year, month) {
  const ym = `${year}-${pad2(month)}`;
  const payload = LS.get("generatedRosterFlat", null);
  if (!payload || typeof payload !== "object") return null;

  const assignments = {};
  const byName = {};

  for (const bucket of Object.values(payload)) {
    if (!bucket || typeof bucket !== "object") continue;
    const items = bucket?.[ym];
    if (!Array.isArray(items)) continue;

    for (const item of items) {
      const day = Number(item?.day);
      if (!day) continue;
      const pid = String(item?.personId || "").trim();
      const nameKey = canon(item?.personName || item?.name || "");
      const shiftCode = item?.shiftCode || item?.roleLabel || "";
      const entry = {
        shiftCode,
        rowLabel: item?.roleLabel || item?.rowId || "",
        hours: shiftHoursFromCode(shiftCode),
        source: "generatedRosterFlat",
      };
      addModelEntry({ assignments, byName }, { personId: pid, nameKey, day, entry });
    }
  }

  return { assignments, byName };
}

function fromNamedAssignments(data, people = []) {
  const named =
    data?.roster?.namedAssignments ||
    data?.namedAssignments ||
    data?.data?.roster?.namedAssignments ||
    null;
  if (!named) return null;

  const nameToId = new Map();
  for (const person of people || []) {
    const key = canon(personNameOf(person));
    const pid = personIdOf(person);
    if (key && pid) nameToId.set(key, pid);
  }

  const defs = data?.defs || data?.rows || data?.data?.defs || [];
  const shiftByRow = new Map();
  const labelByRow = new Map();
  for (const def of defs || []) {
    const id = String(def?.id ?? def?.rowId ?? "");
    if (!id) continue;
    shiftByRow.set(id, def?.shiftCode || "");
    labelByRow.set(id, def?.label || "");
  }

  const assignments = {};
  const byName = {};

  for (const [dayStr, perRow] of Object.entries(named || {})) {
    const day = Number(dayStr);
    if (!day) continue;
    for (const [rowId, names] of Object.entries(perRow || {})) {
      if (!Array.isArray(names)) continue;
      for (const name of names) {
        if (!name) continue;
        const nameKey = canon(name);
        const pid = nameToId.get(nameKey) || "";
        const shiftCode = shiftByRow.get(rowId) || "";
        const entry = {
          shiftCode,
          rowLabel: labelByRow.get(rowId) || rowId,
          hours: shiftHoursFromCode(shiftCode),
          source: "backend",
        };
        addModelEntry({ assignments, byName }, { personId: pid, nameKey, day, entry });
      }
    }
  }

  return { assignments, byName };
}

function fromExplicitAssignments(data, people = []) {
  const list =
    data?.data?.assignments ||
    data?.assignments ||
    data?.schedule?.data?.assignments ||
    [];
  if (!Array.isArray(list)) return null;

  const nameToId = new Map();
  for (const person of people || []) {
    const key = canon(personNameOf(person));
    const pid = personIdOf(person);
    if (key && pid) nameToId.set(key, pid);
  }

  const assignments = {};
  const byName = {};

  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const dayRaw = item.day ?? item.dayNum ?? item.d;
    const dateRaw = String(item.date || item.day || "").slice(0, 10);
    const dayFromDate =
      /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? Number.parseInt(dateRaw.slice(8, 10), 10) : NaN;
    const day = Number.isFinite(Number(dayRaw)) ? Number(dayRaw) : dayFromDate;
    if (!Number.isFinite(day) || day < 1 || day > 31) continue;

    const pid = String(item.personId || item.pid || item.staffId || "").trim();
    const nameRaw = item.personName || item.fullName || item.name || "";
    const nameKey = canon(nameRaw);
    const resolvedPid = pid || (nameKey ? nameToId.get(nameKey) || "" : "");
    const shiftCode = item.shiftCode || item.shift || item.code || "";
    const rowLabel = item.roleLabel || item.rowLabel || item.area || item.label || "";
    const explicitHours = Number(item.hours);
    const entry = {
      shiftCode,
      rowLabel,
      hours: Number.isFinite(explicitHours) ? explicitHours : shiftHoursFromCode(shiftCode),
      source: "backend",
    };
    addModelEntry({ assignments, byName }, { personId: resolvedPid, nameKey, day, entry });
  }

  return { assignments, byName };
}

function hasBackendEnvelope(data) {
  if (!data || typeof data !== "object") return false;
  if (Object.prototype.hasOwnProperty.call(data, "data")) return true;
  if (Object.prototype.hasOwnProperty.call(data, "updatedAt")) return true;
  if (Object.prototype.hasOwnProperty.call(data, "sectionId")) return true;
  return false;
}

function fromBackendSchedule(data, people = []) {
  if (!data) return null;
  const named = fromNamedAssignments(data, people);
  const explicit = fromExplicitAssignments(data, people);
  return merge(named, explicit) || { assignments: {}, byName: {} };
}

function merge(base, override) {
  if (!base) return override || { assignments: {}, byName: {} };
  if (!override) return base;

  const result = {
    assignments: { ...(base.assignments || {}) },
    byName: { ...(base.byName || {}) },
  };

  for (const [pid, days] of Object.entries(override.assignments || {})) {
    result.assignments[pid] = { ...(result.assignments[pid] || {}), ...days };
  }
  for (const [name, days] of Object.entries(override.byName || {})) {
    result.byName[name] = { ...(result.byName[name] || {}), ...days };
  }

  return result;
}

export function getScheduleModelSync({ year, month, people = [] }) {
  const ym = `${year}-${pad2(month)}`;
  const backendCache = LS.get(`schedule::${ym}`, null) || LS.get(`monthlySchedule::${ym}`, null);
  if (hasBackendEnvelope(backendCache)) {
    return fromBackendSchedule(backendCache, people);
  }

  // Backend read model yoksa legacy/local cache adapter'larına düş.
  let model = fromRowsV2(people);
  model = merge(model, fromRosterFlat(year, month));
  return model || { assignments: {}, byName: {} };
}

export async function getScheduleModel({ sectionId, serviceId, role = "", year, month, people = [] }) {
  const ym = `${year}-${pad2(month)}`;
  let backendData = null;

  try {
    if (sectionId) {
      backendData = await getMonthlySchedule({ sectionId, serviceId, role, year, month });
      if (backendData) LS.set(`schedule::${ym}`, backendData);
    }
  } catch {
    backendData = null;
  }

  if (!backendData) {
    backendData = LS.get(`schedule::${ym}`, null) || LS.get(`monthlySchedule::${ym}`, null);
  }
  if (hasBackendEnvelope(backendData)) {
    return fromBackendSchedule(backendData, people);
  }

  // Backend veri yoksa local adapter kaynaklarını fallback olarak kullan.
  let model = fromRowsV2(people);
  model = merge(model, fromRosterFlat(year, month));
  return model || { assignments: {}, byName: {} };
}

export function getPersonDayShift({ model, personId, personName, day }) {
  if (!model) return null;
  const pid = String(personId || "").trim();
  const nameKey = canon(personName || "");

  if (pid && model.assignments?.[pid]?.[day]) return model.assignments[pid][day];
  if (nameKey && model.byName?.[nameKey]?.[day]) return model.byName[nameKey][day];
  return null;
}

export function getPersonMonthShifts({ model, personId, personName }) {
  if (!model) return {};
  const pid = String(personId || "").trim();
  const nameKey = canon(personName || "");

  const fromId = (pid && model.assignments?.[pid]) || {};
  const fromName = (nameKey && model.byName?.[nameKey]) || {};
  return { ...fromName, ...fromId };
}
