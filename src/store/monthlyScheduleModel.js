import { getMonthlySchedule, getAssignmentsForMonth } from "../api/apiAdapter.js";
import {
  buildPersonIdentityIndex,
  canonName,
  resolvePersonRef,
} from "../utils/personIdentity.js";
import { createPlanWorkHourResolver } from "../utils/planWorkCalculator.js";
import { LS } from "../utils/storage.js";

const pad2 = (n) => String(n).padStart(2, "0");
const canon = (s) => canonName(s || "");
const normalizeScopePart = (value = "") => {
  const s = String(value ?? "").trim();
  return s || "ALL";
};

// Önbellek geçerlilik süresi: 5 dakika
const CACHE_TTL_MS = 5 * 60 * 1000;

function cacheKey({ ym, sectionId = "", serviceId = "", role = "" }) {
  return `schedule::${ym}::${normalizeScopePart(sectionId)}::${normalizeScopePart(serviceId)}::${normalizeScopePart(role)}`;
}

function legacyCacheKey(ym) {
  return `schedule::${ym}`;
}

function readCache({ ym, sectionId = "", serviceId = "", role = "" }) {
  const raw =
    LS.get(cacheKey({ ym, sectionId, serviceId, role }), null) ||
    LS.get(`monthlySchedule::${ym}::${normalizeScopePart(sectionId)}::${normalizeScopePart(serviceId)}::${normalizeScopePart(role)}`, null) ||
    LS.get(legacyCacheKey(ym), null) ||
    LS.get(`monthlySchedule::${ym}`, null);
  if (!raw) return null;
  // TTL zarfı varsa kontrol et
  if (raw?._cachedAt && Date.now() - raw._cachedAt > CACHE_TTL_MS) {
    const scoped = cacheKey({ ym, sectionId, serviceId, role });
    LS.remove ? LS.remove(scoped) : localStorage.removeItem(scoped);
    return null;
  }
  return raw;
}

function writeCache({ ym, sectionId = "", serviceId = "", role = "" }, data) {
  LS.set(cacheKey({ ym, sectionId, serviceId, role }), { ...data, _cachedAt: Date.now() });
}

// Dışa açık: yazma işlemlerinden sonra çağrılacak
export function invalidateScheduleCache(year, month) {
  const ym = `${year}-${pad2(month)}`;
  try {
    const prefixes = [`schedule::${ym}`, `monthlySchedule::${ym}`];
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (prefixes.some((prefix) => key === prefix || key.startsWith(`${prefix}::`))) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => localStorage.removeItem(key));
    window.dispatchEvent(new Event("schedule:invalidated"));
  } catch {}
}

const resolveFallbackShiftHours = createPlanWorkHourResolver([]);

function shiftHoursFromCode(code = "", label = "") {
  return resolveFallbackShiftHours(code, label);
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

  const peopleIndex = buildPersonIdentityIndex(people);

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
      const personId = String(resolvePersonRef({ name: nameKey }, peopleIndex)?.id || "").trim();
      const shiftCode = row.vardiya || row.shiftCode || "";
      const entry = {
        shiftCode,
        rowLabel: row.label || row.GOREV || row["GÖREV"] || "",
        hours: shiftHoursFromCode(shiftCode, row.label || row.GOREV || row["GÖREV"] || ""),
        source: "scheduleRowsV2",
      };
      addModelEntry({ assignments, byName }, { personId, nameKey, day, entry });
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

  const peopleIndex = buildPersonIdentityIndex(people);

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
        const pid = String(resolvePersonRef({ name: nameKey }, peopleIndex)?.id || "").trim();
        const shiftCode = shiftByRow.get(rowId) || "";
        const rowLabel = labelByRow.get(rowId) || rowId;
        const entry = {
          shiftCode,
          rowLabel,
          hours: shiftHoursFromCode(shiftCode, rowLabel),
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

  const peopleIndex = buildPersonIdentityIndex(people);

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
    const resolvedPid = String(
      resolvePersonRef({ personId: pid, name: nameKey }, peopleIndex)?.id || pid || ""
    ).trim();
    const shiftCode = item.shiftCode || item.shift || item.code || "";
    const rowLabel = item.roleLabel || item.rowLabel || item.area || item.label || "";
    const explicitHours = Number(item.hours);
    const hasUsefulHours = Number.isFinite(explicitHours) && explicitHours > 0;
    const hasUsefulShift = !!String(shiftCode || "").trim();
    const hasUsefulLabel = !!String(rowLabel || "").trim();
    if (!hasUsefulHours && !hasUsefulShift && !hasUsefulLabel) continue;
    const entry = {
      shiftCode,
      rowLabel,
      hours: hasUsefulHours ? explicitHours : shiftHoursFromCode(shiftCode, rowLabel),
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

function entryScore(entry) {
  if (!entry || typeof entry !== "object") return 0;
  let score = 0;
  if (String(entry.shiftCode || "").trim()) score += 4;
  if (String(entry.rowLabel || "").trim()) score += 2;
  if (Number(entry.hours) > 0) score += 3;
  if (entry.source === "backend") score += 1;
  return score;
}

function mergeDayMaps(baseDays = {}, overrideDays = {}) {
  const result = { ...(baseDays || {}) };
  for (const [day, entry] of Object.entries(overrideDays || {})) {
    const existing = result[day];
    if (!existing) {
      result[day] = entry;
      continue;
    }
    result[day] = entryScore(entry) >= entryScore(existing) ? entry : existing;
  }
  return result;
}

function merge(base, override) {
  if (!base) return override || { assignments: {}, byName: {} };
  if (!override) return base;

  const result = {
    assignments: { ...(base.assignments || {}) },
    byName: { ...(base.byName || {}) },
  };

  for (const [pid, days] of Object.entries(override.assignments || {})) {
    result.assignments[pid] = mergeDayMaps(result.assignments[pid] || {}, days || {});
  }
  for (const [name, days] of Object.entries(override.byName || {})) {
    result.byName[name] = mergeDayMaps(result.byName[name] || {}, days || {});
  }

  return result;
}

export function getScheduleModelSync({ sectionId = "", serviceId = "", role = "", year, month, people = [] }) {
  const ym = `${year}-${pad2(month)}`;
  const backendCache = readCache({ ym, sectionId, serviceId, role });
  if (hasBackendEnvelope(backendCache)) {
    return fromBackendSchedule(backendCache, people);
  }

  // Backend read model yoksa yalnız draft/local scheduleRowsV2 fallback'ine düş.
  const model = fromRowsV2(people);
  return model || { assignments: {}, byName: {} };
}

// Build model directly from Assignment collection flat array
function fromAssignmentsList(list = [], people = []) {
  const peopleIndex = buildPersonIdentityIndex(people);
  const assignments = {};
  const byName = {};
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const dateRaw = String(item.date || item.day || "").slice(0, 10);
    const dayFromDate = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? Number(dateRaw.slice(8, 10)) : NaN;
    const day = Number.isFinite(dayFromDate) ? dayFromDate : NaN;
    if (!Number.isFinite(day) || day < 1 || day > 31) continue;
    const pid = String(item.personId || item.pid || "").trim();
    const nameRaw = item.personName || item.fullName || item.name || "";
    const nameKey = canon(nameRaw);
    const resolvedPid = String(
      resolvePersonRef({ personId: pid, name: nameKey }, peopleIndex)?.id || pid || ""
    ).trim();
    const shiftCode = String(item.shiftCode || item.shift || item.code || "").trim();
    const rowLabel = String(item.roleLabel || item.rowLabel || item.area || item.label || "").trim();
    const explicitHours = Number(item.hours);
    const entry = {
      shiftCode,
      rowLabel,
      hours: Number.isFinite(explicitHours) && explicitHours > 0
        ? explicitHours
        : shiftHoursFromCode(shiftCode, rowLabel),
      source: "assignments",
    };
    addModelEntry({ assignments, byName }, { personId: resolvedPid, nameKey, day, entry });
  }
  return { assignments, byName };
}

export async function getScheduleModel({ sectionId, serviceId, role = "", year, month, people = [] }) {
  const ym = `${year}-${pad2(month)}`;

  // 1) Assignment koleksiyonu — SSOT
  try {
    if (sectionId) {
      const list = await getAssignmentsForMonth({ sectionId, serviceId, role, year, month });
      if (Array.isArray(list) && list.length > 0) {
        return fromAssignmentsList(list, people);
      }
    }
  } catch {
    // Endpoint yoksa eski yoldan devam et
  }

  // 2) Fallback: MonthlySchedule
  let backendData = null;
  try {
    if (sectionId) {
      backendData = await getMonthlySchedule({ sectionId, serviceId, role, year, month });
      if (backendData) writeCache({ ym, sectionId, serviceId, role }, backendData);
    }
  } catch {
    backendData = null;
  }

  if (!backendData) {
    backendData = readCache({ ym, sectionId, serviceId, role });
  }
  if (hasBackendEnvelope(backendData)) {
    return fromBackendSchedule(backendData, people);
  }

  // 3) Son çare: taslak localStorage
  const model = fromRowsV2(people);
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
