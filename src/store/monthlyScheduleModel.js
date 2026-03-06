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
  if (c.includes("4")) return 4;
  if (c === "M" || c.includes("8")) return 8;
  if (c.includes("12")) return 12;
  if (["N", "V1", "V2", "SV", "24", "GECE"].some((k) => c.includes(k))) {
    return 24;
  }
  return 24;
}

function personIdOf(person) {
  return String(person?.id || person?._id || "").trim();
}

function personNameOf(person) {
  return person?.fullName || person?.name || "";
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

      byName[nameKey] = { ...(byName[nameKey] || {}), [day]: entry };
      if (personId) {
        assignments[personId] = { ...(assignments[personId] || {}), [day]: entry };
      }
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

      if (nameKey) byName[nameKey] = { ...(byName[nameKey] || {}), [day]: entry };
      if (pid) assignments[pid] = { ...(assignments[pid] || {}), [day]: entry };
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

        if (nameKey) byName[nameKey] = { ...(byName[nameKey] || {}), [day]: entry };
        if (pid) assignments[pid] = { ...(assignments[pid] || {}), [day]: entry };
      }
    }
  }

  return { assignments, byName };
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

  let model = fromRowsV2(people);
  model = merge(model, fromRosterFlat(year, month));
  if (backendCache) {
    model = merge(model, fromNamedAssignments(backendCache, people));
  }
  return model || { assignments: {}, byName: {} };
}

export async function getScheduleModel({ sectionId, serviceId, year, month, people = [] }) {
  const ym = `${year}-${pad2(month)}`;
  let backendData = null;

  try {
    if (sectionId) {
      backendData = await getMonthlySchedule({ sectionId, serviceId, year, month });
      if (backendData) LS.set(`schedule::${ym}`, backendData);
    }
  } catch {
    backendData = null;
  }

  if (!backendData) {
    backendData = LS.get(`schedule::${ym}`, null) || LS.get(`monthlySchedule::${ym}`, null);
  }

  let model = fromRowsV2(people);
  model = merge(model, fromRosterFlat(year, month));
  if (backendData) {
    model = merge(model, fromNamedAssignments(backendData, people));
  }
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
