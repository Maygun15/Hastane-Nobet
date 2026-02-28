// src/components/PersonScheduleCalendar.jsx (UPDATED)
import React, { useEffect, useMemo, useState } from "react";
import { buildMonthDays } from "../utils/date.js";
import { LS } from "../utils/storage.js";
import { assignSchedule, getMonthlySchedule, unassignSchedule } from "../api/apiAdapter.js";
import DayCard from "./DayCard.jsx";
import MonthStats from "./MonthStats.jsx";
import Modal from "./Modal.jsx";

const pad2 = (n) => String(n).padStart(2, "0");
const stripDiacritics = (str = "") =>
  str
    .toString()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
const canonName = (s = "") => stripDiacritics(s).replace(/\s+/g, " ").toLocaleUpperCase("tr-TR");

const dayNameTR = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];

const emptyAssignments = { map: new Map(), mismatch: null };

const AREA_STORAGE_KEYS = ["workAreasV2", "workAreas"];
const WORKING_HOURS_KEYS = ["workingHoursV2", "workingHours"];

const SOURCE_PRIORITY = {
  remote: 3,
  aiPlan: 2,
  buffer: 1,
  rosterPreview: 1,
  dpResult: 1,
};

function assignmentKey(assg) {
  const shift = String(
    assg?.shiftCode ??
      assg?.shiftId ??
      assg?.shift ??
      assg?.code ??
      ""
  ).trim();
  const role = String(assg?.roleLabel ?? assg?.role ?? assg?.label ?? "").trim();
  return `${shift}||${role}`;
}

function dedupeAssignments(list) {
  if (!Array.isArray(list) || !list.length) return [];
  const map = new Map();
  for (const assg of list) {
    const key = assignmentKey(assg);
    const current = map.get(key);
    if (!current) {
      map.set(key, assg);
      continue;
    }
    const currRank = SOURCE_PRIORITY[current?.source] || 0;
    const nextRank = SOURCE_PRIORITY[assg?.source] || 0;
    if (nextRank >= currRank) map.set(key, assg);
  }
  return Array.from(map.values());
}

function preferSingleAssignment(list) {
  if (!Array.isArray(list) || list.length <= 1) return list || [];
  const scored = [...list].sort((a, b) => {
    const ar = SOURCE_PRIORITY[a?.source] || 0;
    const br = SOURCE_PRIORITY[b?.source] || 0;
    if (br !== ar) return br - ar;
    if (!!b?.pinned !== !!a?.pinned) return (b?.pinned ? 1 : 0) - (a?.pinned ? 1 : 0);
    return 0;
  });
  return [scored[0]];
}

function collectLeaveDays(leavesForPerson, year, month0) {
  const out = new Set();
  if (!leavesForPerson) return out;
  const ym = `${year}-${pad2(month0 + 1)}`;
  for (const [k, v] of Object.entries(leavesForPerson || {})) {
    if (!v) continue;
    if (/^\d{4}-\d{2}-\d{2}$/.test(k)) {
      if (!k.startsWith(ym)) continue;
      const d = Number(k.slice(8, 10));
      if (Number.isFinite(d)) out.add(d);
      continue;
    }
    const d = Number(k);
    if (Number.isFinite(d)) out.add(d);
  }
  return out;
}

function buildServiceLabelMap() {
  const map = new Map();
  const feed = (entry) => {
    if (!entry) return;
    if (Array.isArray(entry)) {
      entry.forEach(feed);
      return;
    }
    if (typeof entry === "string") {
      const str = entry.trim();
      if (str) map.set(str, str);
      return;
    }
    if (typeof entry === "object") {
      const idRaw =
        entry.id ??
        entry.code ??
        entry.serviceId ??
        entry.serviceCode ??
        entry.label ??
        null;
      const nameRaw =
        entry.name ??
        entry.title ??
        entry.label ??
        entry.displayName ??
        entry.code ??
        entry.serviceName ??
        null;
      if (idRaw != null) {
        const key = String(idRaw).trim();
        if (key) {
          const val = nameRaw != null ? String(nameRaw).trim() : key;
          if (val) map.set(key, val);
        }
      }
      if (nameRaw != null) {
        const val = String(nameRaw).trim();
        if (val) map.set(val, val);
      }
      for (const value of Object.values(entry)) {
        if (Array.isArray(value)) feed(value);
      }
    }
  };

  for (const key of AREA_STORAGE_KEYS) {
    let raw;
    try {
      raw = localStorage.getItem(key);
    } catch {
      raw = null;
    }
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      feed(parsed);
    } catch {
      /* ignore broken JSON */
    }
  }

  return map;
}

function extractListValue(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    const candidates = [raw.value, raw.items, raw.list, raw.data];
    for (const c of candidates) {
      if (Array.isArray(c)) return c;
    }
  }
  return [];
}

function readStorageList(keys) {
  const out = [];
  for (const key of keys) {
    const v = LS.get(key, null);
    const list = extractListValue(v);
    if (Array.isArray(list) && list.length) out.push(...list);
  }
  return out;
}

function normalizeWorkAreas(input) {
  const set = new Set();
  (Array.isArray(input) ? input : []).forEach((item) => {
    if (item == null) return;
    if (typeof item === "string") {
      const v = item.trim();
      if (v) set.add(v);
      return;
    }
    if (typeof item === "object") {
      const v = String(item.name ?? item.label ?? item.title ?? item.code ?? "").trim();
      if (v) set.add(v);
    }
  });
  return Array.from(set.values()).sort((a, b) => a.localeCompare(b, "tr", { sensitivity: "base" }));
}

function normalizeWorkingHours(input) {
  const map = new Map();
  (Array.isArray(input) ? input : []).forEach((item) => {
    if (!item) return;
    const code = String(item.code ?? item.id ?? "").trim();
    if (!code) return;
    const start = String(item.start ?? "").trim();
    const end = String(item.end ?? "").trim();
    const labelRaw = String(item.label ?? item.name ?? "").trim();
    const time = start && end ? `${start}-${end}` : "";
    const label = labelRaw || (time ? `${code} (${time})` : code);
    map.set(code, { code, label });
  });
  return Array.from(map.values()).sort((a, b) =>
    String(a.label || a.code).localeCompare(String(b.label || b.code), "tr", { sensitivity: "base" })
  );
}

function normalizePerson(person) {
  if (!person) return null;
  const idCandidates = [
    person.id,
    person.personId,
    person.pid,
    person.tc,
    person.tcNo,
    person.TCKN,
    person.kod,
    person.code,
  ]
    .map((v) => (v == null ? "" : String(v).trim()))
    .filter(Boolean);
  const id = idCandidates[0] || "";
  const nameCandidates = [
    person.fullName,
    person.name,
    person.displayName,
    person.personName,
    [person.firstName, person.lastName].filter(Boolean).join(" "),
    person["Ad Soyad"],
    person["AD SOYAD"],
    person["ad soyad"],
  ]
    .map((v) => (v == null ? "" : String(v).trim()))
    .filter(Boolean);
  const name = nameCandidates[0] || "";
  if (!name && !id) return null;
  return {
    id,
    name: name || id,
    canon: canonName(name || id),
    raw: person,
    service: person.service || person.serviceId || person.department || "",
  };
}

function resolveUserPerson(user, options) {
  if (!user || !options.length) return "";
  const userIdCandidates = [
    user.personId,
    user.person_id,
    user.staffId,
    user.id,
    user.tc,
    user.tcNo,
    user.tcno,
    user.TCKN,
    user.employeeId,
    user.code,
  ]
    .map((v) => (v == null ? "" : String(v).trim()))
    .filter(Boolean);
  for (const candidate of userIdCandidates) {
    const match = options.find((opt) => opt.id && opt.id === candidate);
    if (match) return match.id;
  }
  const userNameCandidates = [
    user.fullName,
    user.name,
    user.displayName,
    [user.firstName, user.lastName].filter(Boolean).join(" "),
  ]
    .map((v) => (v == null ? "" : String(v).trim()))
    .filter(Boolean);
  if (!userNameCandidates.length) return "";
  const userCanon = canonName(userNameCandidates[0]);
  if (!userCanon) return "";
  const match = options.find((opt) => opt.canon === userCanon);
  return match?.id || "";
}

function assignmentCanon(assg) {
  const candidates = [
    assg?.personName,
    assg?.name,
    assg?.displayName,
    assg?.fullName,
  ]
    .map((v) => (v == null ? "" : String(v).trim()))
    .filter(Boolean);
  return candidates.length ? canonName(candidates[0]) : "";
}

function collectAssignmentsForMonth({ year, month0, personId, personCanon }) {
  const ctx = (() => {
    try {
      return JSON.parse(localStorage.getItem("dpResultLast") || "null");
    } catch {
      return null;
    }
  })();
  if (!ctx || !ctx.result?.assignments) return emptyAssignments;
  if (Number(ctx.year) !== Number(year) || Number(ctx.month) !== Number(month0)) {
    return { map: new Map(), mismatch: ctx };
  }
  const target = `${year}-${pad2(month0 + 1)}`;
  const map = new Map();
  const targetPid = personId ? String(personId) : "";
  const targetCanon = personCanon ? canonName(personCanon) : "";

  for (const assg of ctx.result.assignments || []) {
    if (!assg) continue;
    const pid = String(assg.personId ?? assg.personID ?? assg.staffId ?? assg.pid ?? "").trim();
    const hasTargetId = !!targetPid;
    const hasPid = !!pid;
    const pidMatch = hasTargetId && hasPid && pid === targetPid;
    const canonMatch = (!hasTargetId || !hasPid) && targetCanon && assignmentCanon(assg) === targetCanon;
    if (!pidMatch && !canonMatch) continue;
    if (!assg.day || !assg.day.startsWith(target)) continue;
    const dayNum = parseInt(assg.day.slice(8, 10), 10);
    if (!Number.isFinite(dayNum)) continue;
    if (!map.has(dayNum)) map.set(dayNum, []);
    map.get(dayNum).push(assg);
  }
  return { map, mismatch: null };
}

function collectAssignmentsFromBuffer({ year, month0, personId, personCanon }) {
  const map = new Map();
  try {
    const raw = localStorage.getItem("assignmentsBuffer");
    if (!raw) return map;
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return map;
    const targetPid = personId ? String(personId) : "";
    const targetCanon = personCanon ? canonName(personCanon) : "";
    for (const item of arr) {
      if (!item) continue;

      const pidRaw = item.personId ?? item.personID ?? item.staffId ?? item.pid ?? "";
      const pid = pidRaw == null ? "" : String(pidRaw).trim();
      const fullName = item.fullName ?? item.personName ?? item.name ?? "";
      const canon = fullName ? canonName(String(fullName)) : "";

      const hasTargetId = !!targetPid;
      const hasPid = !!pid;
      const pidMatch = hasTargetId && hasPid && pid === targetPid;
      const canonMatch = (!hasTargetId || !hasPid) && targetCanon && canon && canon === targetCanon;
      if (!pidMatch && !canonMatch) continue;

      let dateStr = item.date ?? item.Date ?? "";
      if (!dateStr && Number.isFinite(Number(item.day ?? item.Day))) {
        const dd = Number(item.day ?? item.Day);
        if (dd >= 1 && dd <= 31) {
          dateStr = `${year}-${pad2(month0 + 1)}-${pad2(dd)}`;
        }
      }
      dateStr = String(dateStr || "").trim();
      if (!dateStr) continue;
      const date = new Date(dateStr);
      if (Number.isNaN(date.getTime())) continue;
      if (date.getFullYear() !== year || date.getMonth() !== month0) continue;
      const dayNum = date.getDate();
      if (!Number.isFinite(dayNum)) continue;

      const shift =
        item.shiftCode ??
        item.Shift ??
        item.code ??
        item["Vardiya"] ??
        item["VARDIYA"] ??
        "";
      const service =
        item.service ??
        item.Service ??
        item.role ??
        item["Görev"] ??
        item["GÖREV"] ??
        "";

      if (!map.has(dayNum)) map.set(dayNum, []);
      map.get(dayNum).push({
        day: `${year}-${pad2(month0 + 1)}-${pad2(dayNum)}`,
        roleLabel: service,
        shiftCode: shift,
        personId: pid || targetPid || undefined,
        personName: fullName || undefined,
        source: "buffer",
      });
    }
  } catch {
    /* noop */
  }
  return map;
}

function collectAssignmentsFromAiPlan({ year, month0, personId, personCanon }) {
  const map = new Map();
  let payload = null;
  try {
    payload = JSON.parse(localStorage.getItem("scheduleRowsV2") || "null");
  } catch {
    payload = null;
  }
  if (!payload || !Array.isArray(payload.rows)) return map;
  if (Number(payload.year) !== Number(year) || Number(payload.month) !== Number(month0 + 1)) {
    return map;
  }

  const serviceLabels = buildServiceLabelMap();
  const targetPid = personId ? String(personId) : "";
  const targetCanon = personCanon ? canonName(personCanon) : "";

  for (const row of payload.rows) {
    if (!row) continue;

    const pidRaw = row.personId ?? row.personID ?? row.staffId ?? row.pid ?? null;
    const pid = pidRaw == null ? "" : String(pidRaw).trim();
    const nameRaw = row.personName ?? row.fullName ?? row.name ?? "";
    const rowCanon = nameRaw ? canonName(nameRaw) : "";

    const hasTargetId = !!targetPid;
    const hasPid = !!pid;
    const pidMatch = hasTargetId && hasPid && pid === targetPid;
    const canonMatch = (!hasTargetId || !hasPid) && targetCanon && rowCanon && rowCanon === targetCanon;
    if (!pidMatch && !canonMatch) continue;

    const dateStr = String(row.date ?? row.day ?? "").slice(0, 10);
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(dateStr)) continue;
    const dt = new Date(dateStr);
    if (Number.isNaN(dt.getTime())) continue;
    if (dt.getFullYear() !== Number(year) || dt.getMonth() !== Number(month0)) continue;
    const dayNum = dt.getDate();
    if (!Number.isFinite(dayNum)) continue;

    const shiftCode = row.shiftCode ?? row.shift ?? row.code ?? "";
    const serviceId = row.serviceId ?? row.service ?? row.role ?? "";
    const serviceKey = String(serviceId || "").trim();
    const roleLabel = serviceLabels.get(serviceKey) || serviceKey;

    const assignment = {
      day: dateStr,
      shiftCode: shiftCode ? String(shiftCode).trim() : undefined,
      roleLabel: roleLabel || undefined,
      personId: pid || (targetPid || undefined),
      personName: nameRaw || undefined,
      note: row.note || undefined,
      source: "aiPlan",
      serviceId: serviceId != null ? serviceId : undefined,
    };

    if (!map.has(dayNum)) map.set(dayNum, []);
    map.get(dayNum).push(assignment);
  }

  return map;
}

function collectAssignmentsFromRosterPreview({ year, month0, personId, personCanon }) {
  const map = new Map();
  let payload = null;
  try {
    payload = JSON.parse(localStorage.getItem("generatedRosterFlat") || "null");
  } catch {
    payload = null;
  }
  if (!payload || typeof payload !== "object") return map;

  const targetPid = personId ? String(personId) : "";
  const targetCanon = personCanon ? canonName(personCanon) : "";
  const ymKey = `${year}-${pad2(month0 + 1)}`;

  const buckets = Object.values(payload).filter((chunk) => chunk && typeof chunk === "object");
  for (const bucket of buckets) {
    const items = bucket?.[ymKey];
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (!item) continue;
      const pidRaw = item.personId ?? null;
      const pid = pidRaw == null ? "" : String(pidRaw).trim();
      const nameRaw = item.personName ?? "";
      const rowCanon = nameRaw ? canonName(nameRaw) : "";
      const hasTargetId = !!targetPid;
      const hasPid = !!pid;
      const pidMatch = hasTargetId && hasPid && pid === targetPid;
      const canonMatch = (!hasTargetId || !hasPid) && targetCanon && rowCanon === targetCanon;
      if (!pidMatch && !canonMatch) continue;

      const dateStr = String(item.date || "").slice(0, 10);
      if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(dateStr)) continue;
      const dt = new Date(dateStr);
      if (Number.isNaN(dt.getTime())) continue;
      if (dt.getFullYear() !== Number(year) || dt.getMonth() !== Number(month0)) continue;
      const dayNum = dt.getDate();
      if (!Number.isFinite(dayNum)) continue;

      const assignment = {
        day: dateStr,
        shiftCode: item.shiftCode ? String(item.shiftCode).trim() : undefined,
        roleLabel: item.roleLabel ? String(item.roleLabel).trim() : undefined,
        personId: pid || (targetPid || undefined),
        personName: nameRaw || undefined,
        note: item.note || undefined,
        source: "rosterPreview",
      };

      if (!map.has(dayNum)) map.set(dayNum, []);
      map.get(dayNum).push(assignment);
    }
  }

  return map;
}

function collectAssignmentsFromRemote({ year, month0, personId, personCanon, assignments }) {
  const map = new Map();
  if (!Array.isArray(assignments)) return map;
  const targetPid = personId ? String(personId) : "";
  const targetCanon = personCanon ? canonName(personCanon) : "";
  for (const item of assignments) {
    if (!item) continue;
    const pidRaw = item.personId ?? item.personID ?? item.staffId ?? item.pid ?? "";
    const pid = pidRaw == null ? "" : String(pidRaw).trim();
    const nameRaw = item.personName ?? item.fullName ?? item.name ?? "";
    const rowCanon = nameRaw ? canonName(nameRaw) : "";

    const hasTargetId = !!targetPid;
    const hasPid = !!pid;
    const pidMatch = hasTargetId && hasPid && pid === targetPid;
    const canonMatch = (!hasTargetId || !hasPid) && targetCanon && rowCanon === targetCanon;
    if (!pidMatch && !canonMatch) continue;

    const dateStr = String(item.date ?? item.day ?? "").slice(0, 10);
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(dateStr)) continue;
    const [yy, mm, dd] = dateStr.split("-").map((v) => Number(v));
    if (!yy || !mm || !dd) continue;
    if (yy !== Number(year) || mm !== Number(month0 + 1)) continue;
    const dayNum = dd;

    const assignment = {
      day: dateStr,
      shiftId: item.shiftId ?? item.shiftCode ?? item.shift ?? item.code ?? undefined,
      shiftCode: item.shiftCode ?? item.shiftId ?? item.shift ?? item.code ?? undefined,
      roleLabel: item.roleLabel ?? item.role ?? item.label ?? undefined,
      personId: pid || (targetPid || undefined),
      personName: nameRaw || undefined,
      note: item.note || undefined,
      pinned: !!item.pinned,
      source: "remote",
    };

    if (!map.has(dayNum)) map.set(dayNum, []);
    map.get(dayNum).push(assignment);
  }
  return map;
}

function formatLeaveValue(val) {
  if (!val) return "";
  if (typeof val === "string") return val.toUpperCase();
  if (Array.isArray(val)) {
    return val
      .map((item) => formatLeaveValue(item))
      .filter(Boolean)
      .join(", ");
  }
  if (typeof val === "object") {
    const code = val.code || val.type || val.kind || "";
    const note = val.note || val.description || "";
    return [code, note].filter(Boolean).join(" ");
  }
  return String(val);
}

function collapseLeaves(allLeaves, personId, canon, ymKey) {
  const base = (allLeaves?.[personId] || {})[ymKey] || {};
  if (!canon) return base;
  const byName = (allLeaves?.[`__name__:${canon}`] || {})[ymKey] || {};
  return { ...byName, ...base };
}

export default function PersonScheduleCalendar({
  year,
  month,
  people = [],
  allLeaves = {},
  user,
  role = { isAdmin: false, isAuthorized: false, isStandard: false },
  sectionId = "calisma-cizelgesi",
  serviceId = "",
  scheduleRole = "",
  workAreas = [],
  workingHours = [],
}) {
  const month0 = Math.max(0, Math.min(11, Number(month) - 1 || 0));
  const ymKey = `${year}-${pad2(month0 + 1)}`;

  const options = useMemo(() => {
    const rows = [];
    const seen = new Set();
    (people || []).forEach((person) => {
      const norm = normalizePerson(person);
      if (!norm || !norm.id || seen.has(norm.id)) return;
      seen.add(norm.id);
      rows.push(norm);
    });
    rows.sort((a, b) => a.name.localeCompare(b.name, "tr", { sensitivity: "base" }));
    return rows;
  }, [people]);

  const initialPersonId = useMemo(() => {
    if (role.isStandard) {
      const match = resolveUserPerson(user, options);
      if (match) return match;
    }
    return options[0]?.id || "";
  }, [role.isStandard, user, options]);

  const [selectedId, setSelectedId] = useState(initialPersonId);
  const [dpRevision, setDpRevision] = useState(0);
  const [showStats, setShowStats] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [remoteRevision, setRemoteRevision] = useState(0);
  const [remoteAssignmentsRaw, setRemoteAssignmentsRaw] = useState([]);
  const [remoteDefs, setRemoteDefs] = useState([]);
  const [remoteError, setRemoteError] = useState("");
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteServiceIdUsed, setRemoteServiceIdUsed] = useState("");
  const [assignModal, setAssignModal] = useState({
    open: false,
    mode: "add",
    dayNum: null,
    dateStr: "",
    assg: null,
  });
  const [assignShiftId, setAssignShiftId] = useState("");
  const [assignRoleLabel, setAssignRoleLabel] = useState("");
  const [assignNote, setAssignNote] = useState("");
  const [assignPinned, setAssignPinned] = useState(false);
  const [assignError, setAssignError] = useState("");
  const [settingsRevision, setSettingsRevision] = useState(0);

  useEffect(() => {
    setSelectedId(initialPersonId);
  }, [initialPersonId]);

  useEffect(() => {
    const bumpLocal = () => setDpRevision((v) => v + 1);
    const bumpRemote = () => setRemoteRevision((v) => v + 1);
    const onPlannerChange = () => {
      bumpLocal();
      bumpRemote();
    };
    const onScheduleBuilt = () => bumpRemote();

    window.addEventListener("planner:dpResult", onPlannerChange);
    window.addEventListener("planner:assignments", onPlannerChange);
    window.addEventListener("planner:aiPlan", onPlannerChange);
    window.addEventListener("schedule:built", onScheduleBuilt);
    window.addEventListener("storage", bumpLocal);
    return () => {
      window.removeEventListener("planner:dpResult", onPlannerChange);
      window.removeEventListener("planner:assignments", onPlannerChange);
      window.removeEventListener("planner:aiPlan", onPlannerChange);
      window.removeEventListener("schedule:built", onScheduleBuilt);
      window.removeEventListener("storage", bumpLocal);
    };
  }, []);

  useEffect(() => {
    const bump = () => setSettingsRevision((v) => v + 1);
    window.addEventListener("settings:changed", bump);
    window.addEventListener("workAreas:changed", bump);
    window.addEventListener("workingHours:changed", bump);
    window.addEventListener("storage", bump);
    window.addEventListener("focus", bump);
    return () => {
      window.removeEventListener("settings:changed", bump);
      window.removeEventListener("workAreas:changed", bump);
      window.removeEventListener("workingHours:changed", bump);
      window.removeEventListener("storage", bump);
      window.removeEventListener("focus", bump);
    };
  }, []);

  const canManage = role.isAdmin || role.isAuthorized;

  const selectedPerson = useMemo(
    () => options.find((opt) => String(opt.id) === String(selectedId)) || null,
    [options, selectedId]
  );
  const effectiveServiceId = useMemo(() => {
    const explicit = String(serviceId ?? "").trim();
    if (explicit) return explicit;
    const fallback =
      selectedPerson?.raw?.serviceId ??
      selectedPerson?.raw?.service ??
      selectedPerson?.service ??
      "";
    return String(fallback || "").trim();
  }, [serviceId, selectedPerson]);

  const filteredOptions = useMemo(() => {
    if (!searchQuery.trim()) return options;
    const q = canonName(searchQuery);
    return options.filter((opt) => opt.canon.includes(q));
  }, [options, searchQuery]);

  const leavesForPerson = useMemo(() => {
    if (!selectedPerson) return {};
    return collapseLeaves(allLeaves, selectedPerson.id, selectedPerson.canon, ymKey);
  }, [allLeaves, selectedPerson, ymKey]);

  const assignmentInfo = useMemo(() => {
    if (!selectedPerson) return emptyAssignments;
    return collectAssignmentsForMonth({
      year,
      month0,
      personId: selectedPerson.id,
      personCanon: selectedPerson.canon,
      revision: dpRevision,
    });
  }, [selectedPerson, year, month0, dpRevision]);

  const bufferAssignments = useMemo(() => {
    if (!selectedPerson) return new Map();
    return collectAssignmentsFromBuffer({
      year,
      month0,
      personId: selectedPerson.id,
      personCanon: selectedPerson.canon,
    });
  }, [selectedPerson, year, month0, dpRevision]);

  const aiPlanAssignments = useMemo(() => {
    if (!selectedPerson) return new Map();
    return collectAssignmentsFromAiPlan({
      year,
      month0,
      personId: selectedPerson.id,
      personCanon: selectedPerson.canon,
    });
  }, [selectedPerson, year, month0, dpRevision]);

  const rosterPreviewAssignments = useMemo(() => {
    if (!selectedPerson) return new Map();
    return collectAssignmentsFromRosterPreview({
      year,
      month0,
      personId: selectedPerson.id,
      personCanon: selectedPerson.canon,
    });
  }, [selectedPerson, year, month0, dpRevision]);

  useEffect(() => {
    let active = true;
    if (!canManage || !sectionId) {
      setRemoteAssignmentsRaw([]);
      setRemoteDefs([]);
      setRemoteError("");
      setRemoteLoading(false);
      setRemoteServiceIdUsed("");
      return () => {};
    }
    setRemoteLoading(true);
    (async () => {
      try {
        const candidates = Array.from(
          new Set([effectiveServiceId, String(serviceId ?? "").trim(), ""])
        );
        let schedule = null;
        let pickedServiceId = "";
        for (const sid of candidates) {
          const s = await getMonthlySchedule({
            sectionId,
            serviceId: sid,
            role: scheduleRole,
            year,
            month,
          });
          if (!s) continue;
          schedule = s;
          pickedServiceId = sid;
          const hasAssignments = Array.isArray(s?.data?.assignments) && s.data.assignments.length > 0;
          const hasDefs = Array.isArray(s?.data?.defs) && s.data.defs.length > 0;
          if (hasAssignments || hasDefs) break;
        }
        if (!active) return;
        const data = schedule?.data || {};
        const defs = Array.isArray(data.defs) ? data.defs : Array.isArray(data.rows) ? data.rows : [];
        setRemoteDefs(defs);
        setRemoteAssignmentsRaw(Array.isArray(data.assignments) ? data.assignments : []);
        setRemoteServiceIdUsed(pickedServiceId);
        setRemoteError("");
      } catch (err) {
        if (!active) return;
        setRemoteAssignmentsRaw([]);
        setRemoteDefs([]);
        setRemoteError(err?.message || "Sunucudan nöbet verisi alınamadı.");
        setRemoteServiceIdUsed("");
      } finally {
        if (active) setRemoteLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [canManage, sectionId, effectiveServiceId, scheduleRole, year, month, remoteRevision, serviceId]);

  const remoteAssignments = useMemo(() => {
    if (!selectedPerson) return new Map();
    return collectAssignmentsFromRemote({
      year,
      month0,
      personId: selectedPerson.id,
      personCanon: selectedPerson.canon,
      assignments: remoteAssignmentsRaw,
    });
  }, [selectedPerson, year, month0, remoteAssignmentsRaw]);

  const shiftOptions = useMemo(() => {
    const fromPropsRaw = Array.isArray(workingHours) ? workingHours : [];
    const fromLSRaw = readStorageList(WORKING_HOURS_KEYS);
    const merged = normalizeWorkingHours([...fromPropsRaw, ...fromLSRaw]);
    if (merged.length) return merged;
    const map = new Map();
    (remoteDefs || []).forEach((def) => {
      const code = String(def?.shiftCode ?? def?.code ?? def?.label ?? "").trim();
      if (!code) return;
      const label = String(def?.label ?? def?.area ?? def?.name ?? code).trim();
      if (!map.has(code)) map.set(code, { code, label });
    });
    return Array.from(map.values()).sort((a, b) =>
      String(a.label || a.code).localeCompare(String(b.label || b.code), "tr", { sensitivity: "base" })
    );
  }, [remoteDefs, settingsRevision, workingHours]);

  const areaOptions = useMemo(() => {
    const fromPropsRaw = Array.isArray(workAreas) ? workAreas : [];
    const fromLSRaw = readStorageList(AREA_STORAGE_KEYS);
    const merged = normalizeWorkAreas([...fromPropsRaw, ...fromLSRaw]);
    if (merged.length) return merged;
    const set = new Set();
    (remoteDefs || []).forEach((def) => {
      const label = String(def?.label ?? def?.area ?? def?.name ?? "").trim();
      if (label) set.add(label);
    });
    return Array.from(set.values()).sort((a, b) => a.localeCompare(b, "tr", { sensitivity: "base" }));
  }, [remoteDefs, settingsRevision, workAreas]);

  const assignmentsByDay = useMemo(() => {
    const combined = new Map();
    const hasRemote = Array.isArray(remoteAssignmentsRaw) && remoteAssignmentsRaw.length > 0;
    const merge = (srcMap) => {
      if (!(srcMap instanceof Map)) return;
      for (const [day, list] of srcMap.entries()) {
        if (!combined.has(day)) combined.set(day, []);
        combined.get(day).push(...list);
      }
    };
    if (!hasRemote) {
      if (assignmentInfo?.map instanceof Map) merge(assignmentInfo.map);
      merge(bufferAssignments);
      merge(aiPlanAssignments);
      merge(rosterPreviewAssignments);
    }
    merge(remoteAssignments);
    const leaveDays = collectLeaveDays(leavesForPerson, year, month0);
    for (const [day, list] of combined.entries()) {
      const unique = dedupeAssignments(list);
      const filtered = leaveDays.has(Number(day))
        ? unique.filter((a) => a?.pinned)
        : unique;
      const capped = preferSingleAssignment(filtered);
      if (capped.length) combined.set(day, capped);
      else combined.delete(day);
    }
    return combined;
  }, [
    assignmentInfo?.map,
    bufferAssignments,
    aiPlanAssignments,
    rosterPreviewAssignments,
    remoteAssignments,
    remoteAssignmentsRaw,
    leavesForPerson,
    year,
    month0,
  ]);

  const { cells } = useMemo(() => buildMonthDays(year, month0), [year, month0]);

  const renderAssignments = (list = []) =>
    list.map((assg, idx) => {
      const isEditable = canManage && assg?.source === "remote";
      const isPinned = !!assg?.pinned;
      return (
        <div
          key={idx}
          className={`rounded bg-blue-50 border border-blue-200 px-1 py-0.5 text-[11px] text-blue-700 mt-1 flex items-center justify-between gap-2 group ${
            isEditable ? "cursor-pointer hover:bg-blue-100" : ""
          }`}
          onClick={isEditable ? () => openEditModal(assg) : undefined}
          role={isEditable ? "button" : undefined}
          tabIndex={isEditable ? 0 : undefined}
          onKeyDown={
            isEditable
              ? (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openEditModal(assg);
                  }
                }
              : undefined
          }
        >
          <span className="flex items-center gap-1">
            {isPinned && <span title="Sabitlenmiş">📌</span>}
            <span className="font-semibold">{assg.shiftCode || assg.code || "-"}</span>
            {assg.roleLabel ? <span className="ml-1">{assg.roleLabel}</span> : null}
          </span>
          {isEditable && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleRemoveShift(assg);
              }}
              className="opacity-0 group-hover:opacity-100 text-blue-500 hover:text-red-600 transition-opacity"
              title="Sil"
            >
              ✕
            </button>
          )}
        </div>
      );
    });

  const renderLeave = (code) =>
    code ? (
      <div className="rounded bg-rose-50 border border-rose-200 px-1 py-0.5 text-[11px] text-rose-700 mt-1">
        {code}
      </div>
    ) : null;

  const openAssignModal = (dayNum) => {
    if (!canManage || !selectedPerson) return;
    const dateStr = `${year}-${pad2(month0 + 1)}-${pad2(dayNum)}`;
    const first = shiftOptions[0]?.code || "";
    setAssignShiftId(first);
    setAssignRoleLabel(areaOptions[0] || "");
    setAssignNote("");
    setAssignPinned(false);
    setAssignError("");
    setAssignModal({ open: true, mode: "add", dayNum, dateStr, assg: null });
  };

  const openEditModal = (assg, dayNum) => {
    if (!canManage || !selectedPerson) return;
    if (assg?.source && assg.source !== "remote") return;
    const dateStr = String(assg?.day || assg?.date || `${year}-${pad2(month0 + 1)}-${pad2(dayNum)}`).slice(0, 10);
    const shiftId = String(assg?.shiftId || assg?.shiftCode || assg?.shift || assg?.code || "").trim();
    setAssignShiftId(shiftId);
    setAssignRoleLabel(String(assg?.roleLabel || assg?.label || "").trim());
    setAssignNote(String(assg?.note || "").trim());
    setAssignPinned(!!assg?.pinned);
    setAssignError("");
    setAssignModal({ open: true, mode: "edit", dayNum: dayNum ?? null, dateStr, assg });
  };

  const closeAssignModal = () => {
    setAssignModal({ open: false, mode: "add", dayNum: null, dateStr: "", assg: null });
    setAssignError("");
  };

  const refreshRemote = () => {
    setRemoteRevision((v) => v + 1);
    try {
      window.dispatchEvent(new Event("planner:assignments"));
    } catch {}
  };

  const handleConfirmAssign = async () => {
    if (!assignModal.open || !selectedPerson) return;
    const shiftId = String(assignShiftId || "").trim();
    if (!shiftId) {
      setAssignError("Vardiya seçmelisiniz.");
      return;
    }
    try {
      if (assignModal.mode === "edit" && assignModal.assg) {
        const prevShiftId = String(
          assignModal.assg.shiftId || assignModal.assg.shiftCode || assignModal.assg.shift || assignModal.assg.code || ""
        ).trim();
        if (prevShiftId && prevShiftId !== shiftId) {
          await unassignSchedule({
            sectionId,
            serviceId: remoteServiceIdUsed || effectiveServiceId,
            role: scheduleRole,
            date: assignModal.dateStr,
            shiftId: prevShiftId,
            personId: selectedPerson.id,
          });
        }
      }
      await assignSchedule({
        sectionId,
        serviceId: remoteServiceIdUsed || effectiveServiceId,
        role: scheduleRole,
        date: assignModal.dateStr,
        shiftId,
        shiftCode: shiftId,
        personId: selectedPerson.id,
        personName: selectedPerson.name,
        roleLabel: assignRoleLabel,
        note: assignNote,
        pinned: assignPinned,
      });
      closeAssignModal();
      refreshRemote();
    } catch (err) {
      setAssignError(err?.message || "Nöbet eklenemedi.");
    }
  };

  const handleRemoveShift = async (assg, dayNum) => {
    if (!canManage || !selectedPerson) return;
    if (assg?.source && assg.source !== "remote") return;
    const dateStr = String(assg?.day || assg?.date || `${year}-${pad2(month0 + 1)}-${pad2(dayNum)}`).slice(0, 10);
    const shiftId = String(assg?.shiftId || assg?.shiftCode || assg?.shift || assg?.code || "").trim();
    const pid = String(assg?.personId || selectedPerson.id || "").trim();
    if (!dateStr || !shiftId || !pid) return;
    if (!window.confirm(`${selectedPerson.name} için ${dateStr} tarihli nöbet silinsin mi?`)) return;
    try {
      await unassignSchedule({
        sectionId,
        serviceId: remoteServiceIdUsed || effectiveServiceId,
        role: scheduleRole,
        date: dateStr,
        shiftId,
        personId: pid,
      });
      refreshRemote();
    } catch (err) {
      alert(err?.message || "Nöbet silinemedi.");
    }
  };

  return (
    <div className="space-y-4">
      {/* Başlık ve Personel Seçici */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-slate-500">Yıl</span>
          <span className="text-sm font-semibold text-slate-800">{year}</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-slate-500">Ay</span>
          <span className="text-sm font-semibold text-slate-800">
            {Intl.DateTimeFormat("tr-TR", { month: "long" }).format(new Date(year, month0))}
          </span>
        </div>
        <div className="flex-1" />
        {(role.isAdmin || role.isAuthorized) && (
          <label className="flex flex-col text-xs text-slate-500 gap-1 w-80">
            Personel Ara
            <input
              type="text"
              placeholder="İsim ara..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9 rounded-lg border px-3 text-sm text-slate-700 focus:ring-2 focus:ring-sky-400 focus:border-transparent"
            />
          </label>
        )}
        {(role.isAdmin || role.isAuthorized) && (
          <label className="flex flex-col text-xs text-slate-500 gap-1 w-72">
            Personel
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              className="h-9 rounded-lg border px-3 text-sm text-slate-700 focus:ring-2 focus:ring-sky-400 focus:border-transparent"
            >
              <option value="">-- Seç --</option>
              {filteredOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {role.isStandard && selectedPerson && (
          <div className="text-sm text-slate-600">
            Personel: <span className="font-medium text-slate-800">{selectedPerson.name}</span>
          </div>
        )}
        <button
          onClick={() => setShowStats(!showStats)}
          className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
            showStats
              ? "bg-sky-100 text-sky-700 border border-sky-200"
              : "bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200"
          }`}
        >
          {showStats ? "📊 Özet" : "📊 Özet"}
        </button>
      </div>

      {/* Uyarılar */}
      {!selectedPerson && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 text-amber-800 px-4 py-3 text-sm">
          Bu kullanıcıyla eşleşen bir personel kaydı bulunamadı. Personel listesinde kimlik bilgilerinizi
          güncelleyip tekrar deneyin.
        </div>
      )}

      {selectedPerson && role.isStandard && !resolveUserPerson(user, options) && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 text-amber-800 px-4 py-3 text-sm">
          Hesabınızla eşleşen personel kaydı bulunamadı. Şu an listeden ilk kayıt gösteriliyor.
        </div>
      )}

      {assignmentInfo.mismatch && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 text-amber-800 px-4 py-3 text-sm">
          Son oluşturulan plan {assignmentInfo.mismatch?.year}-{pad2(Number(assignmentInfo.mismatch?.month) + 1)}{" "}
          dönemine ait. {year}-{pad2(month0 + 1)} için nöbet verisi bulunamadı.
        </div>
      )}
      {remoteError && canManage && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-700 px-4 py-3 text-sm">
          {remoteError}
        </div>
      )}

      {/* Takvim Başlığı */}
      <div className="grid grid-cols-7 gap-1 text-xs font-semibold text-slate-500 px-1">
        {dayNameTR.map((name) => (
          <div key={name} className="text-center py-1">
            {name}
          </div>
        ))}
      </div>

      {/* Takvim Grid */}
      <div className="grid grid-cols-7 gap-1">
        {cells.map((dt, idx) => {
          if (!dt) {
            return <div key={`empty-${idx}`} className="h-32 rounded-xl bg-transparent" />;
          }
          const dayNum = dt.getDate();
          const leaveCodeRaw =
            leavesForPerson[String(dayNum)] || leavesForPerson[`${year}-${pad2(month0 + 1)}-${pad2(dayNum)}`];
          const leaveCode = formatLeaveValue(leaveCodeRaw);
          const assignments = assignmentsByDay.get(dayNum) || [];
          const isWeekend = dt.getDay() === 0 || dt.getDay() === 6;

          return (
            <DayCard
              key={`day-${dayNum}`}
              dayNum={dayNum}
              dateObj={dt}
              leaveCode={leaveCode}
              assignments={assignments}
              isWeekend={isWeekend}
              requiredCount={2}
              renderLeave={renderLeave}
              renderAssignments={renderAssignments}
              onAddShift={canManage ? () => openAssignModal(dayNum) : null}
              onRemoveShift={canManage ? (assg) => handleRemoveShift(assg, dayNum) : null}
              onEditShift={null}
            />
          );
        })}
      </div>

      {/* Ayın Özeti */}
      {showStats && selectedPerson && (
        <MonthStats
          year={year}
          month={month}
          cells={cells}
          assignments={assignmentsByDay}
          requiredPerDay={2}
        />
      )}

      {/* Legend */}
      <div className="text-xs text-slate-500 bg-white rounded-lg border border-slate-200 p-3">
        <div>
          <span className="inline-block h-3 w-3 bg-rose-100 border border-rose-200 mr-2 align-middle rounded" />
          İzin kayıtları (Toplu İzin Listesi)
        </div>
        <div className="mt-1">
          <span className="inline-block h-3 w-3 bg-blue-100 border border-blue-200 mr-2 align-middle rounded" />
          Nöbet atamaları (son plan / içe aktarılan görevler)
        </div>
        <div className="text-[10px] text-slate-400 mt-2">
          Not: Excel'den içe aktarılan görevler, serbest metin tarih ve vardiya alanlarını düzgün biçimde
          parse edebildiğimiz sürece burada gösterilir.
        </div>
      </div>

      <Modal
        open={assignModal.open}
        title={assignModal.mode === "edit" ? "Nöbet Düzenle" : "Nöbet Ekle"}
        onClose={closeAssignModal}
        footer={
          <>
            <button
              onClick={closeAssignModal}
              className="px-3 py-2 rounded border text-sm hover:bg-slate-50"
            >
              Vazgeç
            </button>
            <button
              onClick={handleConfirmAssign}
              className="px-3 py-2 rounded bg-sky-600 text-white text-sm hover:bg-sky-700"
            >
              Kaydet
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="text-sm text-slate-600">
            Personel: <span className="font-medium text-slate-800">{selectedPerson?.name || "-"}</span>
          </div>
          <div className="text-sm text-slate-600">
            Tarih: <span className="font-medium text-slate-800">{assignModal.dateStr}</span>
          </div>
          <label className="flex flex-col gap-1 text-sm">
            Alan
            <input
              value={assignRoleLabel}
              onChange={(e) => setAssignRoleLabel(e.target.value)}
              className="h-9 rounded border px-3 text-sm"
              placeholder="Örn: NÖROLOJİ"
              list="assign-area-options"
            />
            {areaOptions.length > 0 && (
              <datalist id="assign-area-options">
                {areaOptions.map((opt) => (
                  <option key={opt} value={opt} />
                ))}
              </datalist>
            )}
          </label>
          {shiftOptions.length > 0 ? (
            <label className="flex flex-col gap-1 text-sm">
              Vardiya
              <select
                value={assignShiftId}
                onChange={(e) => {
                  const code = e.target.value;
                  setAssignShiftId(code);
                }}
                className="h-9 rounded border px-3 text-sm"
              >
                <option value="">Seç...</option>
                {shiftOptions.map((opt) => (
                  <option key={opt.code} value={opt.code}>
                    {opt.label} ({opt.code})
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="flex flex-col gap-1 text-sm">
              Vardiya Kodu
              <input
                value={assignShiftId}
                onChange={(e) => setAssignShiftId(e.target.value)}
                className="h-9 rounded border px-3 text-sm"
                placeholder="Örn: V1"
              />
            </label>
          )}
          <label className="flex flex-col gap-1 text-sm">
            Not (opsiyonel)
            <input
              value={assignNote}
              onChange={(e) => setAssignNote(e.target.value)}
              className="h-9 rounded border px-3 text-sm"
              placeholder="Kısa not"
            />
          </label>
          {canManage && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={assignPinned}
                onChange={(e) => setAssignPinned(e.target.checked)}
              />
              Nöbeti sabitle
            </label>
          )}
          {remoteLoading && (
            <div className="text-xs text-slate-400">Sunucu senkronizasyonu...</div>
          )}
          {assignError && (
            <div className="text-sm text-rose-600">{assignError}</div>
          )}
        </div>
      </Modal>
    </div>
  );
}
