import { getGeneratedSchedule } from "../api/apiAdapter.js";
import {
  buildPersonIdentityIndex,
  canonName,
  choosePreferredName,
  resolvePersonRef,
} from "./personIdentity.js";
import {
  createPlanWorkHourResolver,
  groupAssignmentsByPersonAndDay,
} from "./planWorkCalculator.js";

const DEFAULT_ROLES = ["Nurse", "Doctor"];

export function createPlanShiftHourResolver(workingHours = []) {
  return createPlanWorkHourResolver(workingHours);
}

export async function fetchGeneratedPlanAssignmentsForMonth({
  sectionId = "calisma-cizelgesi",
  serviceId = "",
  year,
  month,
  roles = DEFAULT_ROLES,
} = {}) {
  const out = [];
  for (const role of Array.isArray(roles) ? roles : DEFAULT_ROLES) {
    const generated = await getGeneratedSchedule({
      sectionId,
      serviceId,
      role,
      year,
      month,
    }).catch((err) => {
      if (err?.status !== 404) console.error("getGeneratedSchedule err:", err);
      return null;
    });
    if (Array.isArray(generated?.assignments) && generated.assignments.length) {
      out.push(...generated.assignments);
    }
  }
  return out;
}

function buildMetaIndex(source = []) {
  const byId = new Map();
  const byCanon = new Map();
  (Array.isArray(source) ? source : []).forEach((entry, idx) => {
    if (!entry) return;
    const name =
      entry.fullName ||
      entry.name ||
      entry.displayName ||
      entry.personName ||
      "";
    if (!name) return;
    const id = entry.id ?? entry.personId ?? entry.pid ?? `tmp-${idx}`;
    const info = {
      id: id != null ? String(id) : null,
      name,
      title: entry.title || entry.role || "",
      service: entry.service || entry.serviceId || entry.department || "",
    };
    if (info.id) byId.set(info.id, info);
    const key = canonName(name);
    if (key && !byCanon.has(key)) byCanon.set(key, info);
  });
  return { byId, byCanon };
}

export function buildWorkRowsFromPlanAssignments({
  assignments = [],
  people = [],
  dcount = 31,
  resolveShiftHours,
}) {
  const metaIndex = buildMetaIndex(people);
  const grouped = groupAssignmentsByPersonAndDay(assignments, {
    people,
    resolveHours: resolveShiftHours,
  });
  const rows = new Map();

  const ensureRow = (key, rowPersonId, displayName, metaInfo) => {
    if (rows.has(key)) return rows.get(key);
    const resolvedName =
      choosePreferredName(metaInfo?.name || "", displayName || "") ||
      displayName ||
      "Bilinmeyen personel";
    const row = {
      id: crypto.randomUUID(),
      personId: rowPersonId || metaInfo?.id || "",
      person: resolvedName,
      title: (metaInfo?.title || "").trim(),
      service: (metaInfo?.service || "").trim(),
      days: Array.from({ length: dcount }, () => ""),
    };
    rows.set(key, row);
    return row;
  };

  for (const entry of grouped.values()) {
    const resolvedPid = String(entry?.personId || "").trim();
    const sourceName = entry?.personName || "";
    const nameKey = canonName(sourceName);
    const meta = resolvedPid
      ? metaIndex.byId.get(resolvedPid)
      : (nameKey ? metaIndex.byCanon.get(nameKey) : null);
    const rowKey = resolvedPid ? `id:${resolvedPid}` : `name:${nameKey || crypto.randomUUID()}`;
    const row = ensureRow(rowKey, resolvedPid, sourceName, meta);
    for (const [dayKey, hours] of Object.entries(entry?.byDay || {})) {
      const day = Number(dayKey);
      if (!Number.isFinite(day) || day < 1 || day > dcount) continue;
      const current = Number(row.days[day - 1]) || 0;
      row.days[day - 1] = hours > 0 ? Math.round((current + Number(hours)) * 100) / 100 : row.days[day - 1];
    }
  }

  return Array.from(rows.values()).sort((a, b) =>
    String(a.person || "").localeCompare(String(b.person || ""), "tr", { sensitivity: "base" })
  );
}

export function buildPersonDayHoursFromPlanAssignments({
  assignments = [],
  personId = "",
  personName = "",
  people = [],
  resolveShiftHours,
}) {
  const peopleIndex = buildPersonIdentityIndex(people);
  const person = resolvePersonRef({ personId, name: personName }, peopleIndex);
  const targetKey = person?.id
    ? `id:${String(person.id).trim()}`
    : `name:${canonName(person?.fullName || person?.name || personName || "")}`;
  return { ...(groupAssignmentsByPersonAndDay(assignments, {
    people,
    resolveHours: resolveShiftHours,
  }).get(targetKey)?.byDay || {}) };
}
