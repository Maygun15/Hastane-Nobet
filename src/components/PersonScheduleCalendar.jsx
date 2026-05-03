// src/components/PersonScheduleCalendar.jsx (UPDATED)
import React, { useEffect, useMemo, useState } from "react";
import { buildMonthDays } from "../utils/date.js";
import { LS } from "../utils/storage.js";
import { assignSchedule, getGeneratedSchedule, getMonthlySchedule, unassignSchedule } from "../api/apiAdapter.js";
import { API } from "../lib/api.js";
import DayCard from "./DayCard.jsx";
import MonthStats from "./MonthStats.jsx";
import Modal from "./Modal.jsx";
import { LEAVE_RULES } from "../constants/rules.js";
import { buildLeaveCreditRules } from "../utils/leaveTypeRules.js";
import { buildMonthlyTotalsIndex, createPlanWorkHourResolver, sumWorkedHoursForPersonMonth } from "../utils/planWorkCalculator.js";
import { requiredHoursBase, workedLikeLeaveHours } from "../utils/overtime.js";

const pad2 = (n) => String(n).padStart(2, "0");
const stripDiacritics = (str = "") =>
  str
    .toString()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
const canonName = (s = "") => stripDiacritics(s).replace(/\s+/g, " ").toLocaleUpperCase("tr-TR");

const dayNameTR = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];
const SERVICE_SUPERVISOR_LABEL = "SERVİS SORUMLUSU";

const AREA_STORAGE_KEYS = ["workAreasV2", "workAreas"];
const WORKING_HOURS_KEYS = ["workingHoursV2", "workingHours"];

const SOURCE_PRIORITY = {
  remote: 3,
};

function buildDisplayCells(year, month0) {
  const first = new Date(year, month0, 1);
  const daysInMonth = new Date(year, month0 + 1, 0).getDate();
  const offset = (first.getDay() + 6) % 7;
  const total = Math.ceil((offset + daysInMonth) / 7) * 7;
  const startDate = new Date(year, month0, 1 - offset);
  const cells = [];
  for (let i = 0; i < total; i++) {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + i);
    cells.push({
      date,
      inMonth: date.getMonth() === month0,
    });
  }
  return cells;
}

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

function isServiceSupervisorLabel(label = "") {
  return stripDiacritics(String(label || ""))
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .includes("servis sorumlu");
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

function buildRemoteScheduleCandidate({ schedule, serviceId, role, year, month, countPersonMatches }) {
  if (!schedule) return null;
  const data = schedule?.data || {};
  const defs = Array.isArray(data.defs) ? data.defs : Array.isArray(data.rows) ? data.rows : [];
  const normalizedAssignments = normalizeRemoteAssignments({ ...data, year, month }, defs);
  return {
    schedule,
    serviceId,
    role,
    defs,
    normalizedAssignments,
    personMatches: countPersonMatches(normalizedAssignments),
    assignmentCount: normalizedAssignments.length,
    defCount: defs.length,
    updatedAtTs: Date.parse(schedule?.updatedAt || "") || 0,
  };
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

function splitAreaTokens(value) {
  return String(value || "")
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function extractAreasFromPerson(person) {
  const out = [];
  const candidates = [
    person?.areas,
    person?.workAreas,
    person?.workareas,
    person?.meta?.areas,
    person?.meta?.workAreas,
    person?.meta?.workareas,
    person?.raw?.areas,
    person?.raw?.workAreas,
    person?.raw?.workareas,
    person?.raw?.meta?.areas,
    person?.raw?.meta?.workAreas,
    person?.["ÇALIŞMA ALANLARI"],
    person?.["CALISMA ALANLARI"],
    person?.raw?.["ÇALIŞMA ALANLARI"],
    person?.raw?.["CALISMA ALANLARI"],
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (Array.isArray(candidate)) {
      for (const item of candidate) {
        if (!item) continue;
        if (typeof item === "string") {
          out.push(...splitAreaTokens(item));
        } else if (typeof item === "object") {
          const label = item.name ?? item.label ?? item.title ?? item.code ?? item.id ?? "";
          if (label) out.push(...splitAreaTokens(label));
        }
      }
      continue;
    }
    if (typeof candidate === "string") {
      out.push(...splitAreaTokens(candidate));
      continue;
    }
    if (typeof candidate === "object") {
      const label = candidate.name ?? candidate.label ?? candidate.title ?? candidate.code ?? candidate.id ?? "";
      if (label) out.push(...splitAreaTokens(label));
    }
  }
  return out;
}

function collectAreasFromPeople(list) {
  const out = [];
  (Array.isArray(list) ? list : []).forEach((person) => {
    out.push(...extractAreasFromPerson(person));
  });
  return out;
}

function normalizeWorkingHours(input) {
  const map = new Map();
  (Array.isArray(input) ? input : []).forEach((item) => {
    if (!item) return;
    const code = String(
      item.shiftCode ??
      item.code ??
      item.id ??
      item.vardiyaKodu ??
      item.vardiya ??
      item.name ??
      ""
    ).trim();
    if (!code) return;
    const start = String(item.start ?? item.from ?? item.begin ?? item.startTime ?? "").trim();
    const end = String(item.end ?? item.to ?? item.finish ?? item.endTime ?? "").trim();
    const hours = item.hours ?? item.duration ?? item.totalHours;
    const labelRaw = String(item.label ?? item.name ?? item.area ?? item.title ?? "").trim();
    const time = start && end ? `${start}-${end}` : "";
    const label = labelRaw || (time ? `${code} (${time})` : code);
    map.set(code, { code, label, start, end, hours });
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
    aliasIds: Array.isArray(person.aliasIds) ? person.aliasIds.map((v) => String(v).trim()).filter(Boolean) : [],
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
    user.username,
    user.userName,
    user.identifier,
    user.email,
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

function buildDefsIndex(defs) {
  const byId = new Map();
  const byShift = new Map();
  (Array.isArray(defs) ? defs : []).forEach((def) => {
    if (!def) return;
    const id = def.id ?? def.rowId ?? def._id ?? def.shiftId ?? def.code ?? null;
    if (id != null && String(id).trim()) {
      byId.set(String(id).trim(), def);
    }
    const shiftCode = String(def.shiftCode ?? def.code ?? "").trim();
    if (shiftCode) {
      byShift.set(shiftCode, def);
    }
  });
  return { byId, byShift };
}

function normalizeRemoteAssignments(data, defs) {
  const merged = [];
  const seen = new Set();
  const defIndex = buildDefsIndex(defs);
  const hasExplicitAssignments = Array.isArray(data?.assignments) && data.assignments.length > 0;
  const pushUnique = (item) => {
    if (!item) return;
    const dateStr = String(item?.date ?? item?.day ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return;
    const pid = String(item?.personId ?? item?.personID ?? item?.staffId ?? item?.pid ?? "").trim();
    const pname = String(item?.personName ?? item?.fullName ?? item?.name ?? "").trim();
    let shiftId = item?.shiftId ?? item?.shiftCode ?? item?.shift ?? item?.code ?? "";
    let shiftCode = item?.shiftCode ?? item?.shiftId ?? item?.shift ?? item?.code ?? "";
    let roleLabel = item?.roleLabel ?? item?.role ?? item?.label ?? "";
    const shiftIdKey = String(shiftId || "").trim();
    const shiftCodeKey = String(shiftCode || "").trim();
    const def =
      (shiftIdKey && defIndex.byId.get(shiftIdKey)) ||
      (shiftCodeKey && defIndex.byId.get(shiftCodeKey)) ||
      (shiftCodeKey && defIndex.byShift.get(shiftCodeKey)) ||
      null;
    if (def) {
      const defId = def.id ?? def.rowId ?? def._id ?? def.shiftId ?? def.code ?? "";
      const defShift = String(def.shiftCode ?? def.code ?? "").trim();
      const defLabel = String(def.label ?? def.name ?? def.area ?? "").trim();
      if (!shiftIdKey && defId) shiftId = String(defId);
      if (!shiftCodeKey && defShift) shiftCode = defShift;
      if (!String(roleLabel || "").trim() && defLabel) roleLabel = defLabel;
    }
    const shift = String(shiftCode || shiftId || "").trim();
    roleLabel = String(roleLabel || "").trim();
    const identity = canonName(pname) || (pid ? `id:${pid}` : "");
    const k = `${dateStr}|${identity}|${shift}|${roleLabel}`;
    if (seen.has(k)) return;
    seen.add(k);
    merged.push({
      ...item,
      shiftId,
      shiftCode,
      roleLabel,
      date: dateStr,
      day: dateStr,
    });
  };

  if (Array.isArray(data?.assignments) && data.assignments.length) {
    (data.assignments || []).forEach((item) => pushUnique(item));
  }

  // assignments varsa onu otorite kabul et; eski/stale namedAssignments
  // manuel düzenlemeleri gölgede bırakmasın.
  if (hasExplicitAssignments) return merged;

  const named = data?.roster?.namedAssignments || data?.namedAssignments || null;
  if (!named || typeof named !== "object") return merged;

  Object.entries(named).forEach(([dayStr, perRow]) => {
    const dayNum = Number(dayStr);
    if (!Number.isFinite(dayNum) || dayNum < 1 || dayNum > 31) return;
    const dateStr = `${String(data?.year || "").padStart(4, "0")}-${pad2(data?.month || 0)}-${pad2(dayNum)}`;
    Object.entries(perRow || {}).forEach(([rowId, names]) => {
      if (!Array.isArray(names) || !names.length) return;
      const def =
        defIndex.byId.get(String(rowId).trim()) ||
        defIndex.byShift.get(String(rowId).trim()) ||
        null;
      const shiftId = def?.id ?? def?.rowId ?? def?._id ?? def?.shiftId ?? rowId;
      const shiftCode = String(def?.shiftCode ?? def?.code ?? rowId).trim();
      const roleLabel = String(def?.label ?? def?.name ?? def?.area ?? rowId).trim();
      names.forEach((nameRaw) => {
        if (!nameRaw) return;
        pushUnique({
          date: dateStr,
          day: dateStr,
          shiftId,
          shiftCode,
          roleLabel,
          personName: String(nameRaw),
        });
      });
    });
  });
  return merged;
}

function collectAssignmentsFromRemote({ year, month0, personId, personCanon, assignments, defs }) {
  const map = new Map();
  if (!Array.isArray(assignments)) return map;
  const targetPid = personId ? String(personId) : "";
  const targetCanon = personCanon ? canonName(personCanon) : "";
  const defIndex = buildDefsIndex(defs);
  for (const item of assignments) {
    if (!item) continue;
    const pidRaw = item.personId ?? item.personID ?? item.staffId ?? item.pid ?? "";
    const pid = pidRaw == null ? "" : String(pidRaw).trim();
    const nameRaw = item.personName ?? item.fullName ?? item.name ?? "";
    const rowCanon = nameRaw ? canonName(nameRaw) : "";

    const hasTargetId = !!targetPid;
    const hasPid = !!pid;
    const pidMatch = hasTargetId && hasPid && pid === targetPid;
    const canonMatch = targetCanon && rowCanon === targetCanon;
    if (!pidMatch && !canonMatch) continue;

    const dateStr = String(item.date ?? item.day ?? "").slice(0, 10);
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(dateStr)) continue;
    const [yy, mm, dd] = dateStr.split("-").map((v) => Number(v));
    if (!yy || !mm || !dd) continue;
    if (yy !== Number(year) || mm !== Number(month0 + 1)) continue;
    const dayNum = dd;

    let shiftId = item.shiftId ?? item.shiftCode ?? item.shift ?? item.code ?? undefined;
    let shiftCode = item.shiftCode ?? item.shiftId ?? item.shift ?? item.code ?? undefined;
    let roleLabel = item.roleLabel ?? item.role ?? item.label ?? undefined;

    const shiftIdKey = shiftId != null ? String(shiftId).trim() : "";
    const shiftCodeKey = shiftCode != null ? String(shiftCode).trim() : "";
    let def = null;
    if (shiftIdKey && defIndex.byId.has(shiftIdKey)) {
      def = defIndex.byId.get(shiftIdKey);
    } else if (shiftCodeKey && defIndex.byId.has(shiftCodeKey)) {
      def = defIndex.byId.get(shiftCodeKey);
    } else if (shiftCodeKey && defIndex.byShift.has(shiftCodeKey)) {
      def = defIndex.byShift.get(shiftCodeKey);
    }
    if (def) {
      const defId = def.id ?? def.rowId ?? def._id ?? def.shiftId ?? def.code ?? "";
      const defShift = String(def.shiftCode ?? def.code ?? "").trim();
      const defLabel = String(def.label ?? def.name ?? def.area ?? "").trim();
      if (!shiftIdKey && defId) shiftId = String(defId);
      if ((!shiftCodeKey || defIndex.byId.has(shiftCodeKey)) && defShift) shiftCode = defShift;
      if (!roleLabel && defLabel) roleLabel = defLabel;
    }

    const assignment = {
      day: dateStr,
      shiftId,
      shiftCode,
      roleLabel,
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

function buildLeaveCodesByDayMap(leavesForPerson = {}, year, month0) {
  const out = {};
  const ym = `${year}-${pad2(month0 + 1)}`;
  for (const [key, val] of Object.entries(leavesForPerson || {})) {
    if (!val) continue;
    let dayNum = null;
    if (/^\d+$/.test(String(key))) {
      dayNum = Number(key);
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(String(key)) && String(key).startsWith(`${ym}-`)) {
      dayNum = Number(String(key).slice(8, 10));
    }
    if (!Number.isFinite(dayNum) || dayNum < 1 || dayNum > 31) continue;
    out[dayNum] = val;
  }
  return out;
}

function collapseLeaves(allLeaves, personId, canon, ymKey, aliasIds = []) {
  const merged = {};
  const ids = new Set(
    [personId, ...(Array.isArray(aliasIds) ? aliasIds : [])]
      .map((v) => (v == null ? "" : String(v).trim()))
      .filter(Boolean)
  );
  for (const id of ids) {
    Object.assign(merged, (allLeaves?.[id] || {})[ymKey] || {});
  }
  // ID ile bulunan personelde isim-bazlı eski kayıtları dahil etme:
  // Toplu İzin Listesi (ID bazlı) tek kaynak kabul edilir.
  if (canon && ids.size === 0) {
    const byName = (allLeaves?.[`__name__:${canon}`] || {})[ymKey] || {};
    return { ...byName, ...merged };
  }
  return merged;
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
  const canManage = role.isAdmin || role.isAuthorized;

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

  const userPersonId = useMemo(
    () => resolveUserPerson(user, options),
    [user, options]
  );

  const initialPersonId = useMemo(() => {
    if (!canManage) return userPersonId || options[0]?.id || "";
    return options[0]?.id || "";
  }, [canManage, userPersonId, options]);

  const [selectedId, setSelectedId] = useState(initialPersonId);
  const [showStats, setShowStats] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [remoteRevision, setRemoteRevision] = useState(0);
  const [remoteAssignmentsRaw, setRemoteAssignmentsRaw] = useState([]);
  const [remoteDefs, setRemoteDefs] = useState([]);
  const [remoteError, setRemoteError] = useState("");
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteServiceIdUsed, setRemoteServiceIdUsed] = useState(null);
  const [remoteRoleUsed, setRemoteRoleUsed] = useState(null);
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

  // Tatil verisi: { "YYYY-MM-DD": { kind: "full"|"arife"|"half", name: string } }
  const [holidayMap, setHolidayMap] = useState({});
  useEffect(() => {
    let active = true;
    API.http.get(`/api/holidays?y=${year}&m=${month0 + 1}`)
      .then((data) => {
        if (!active) return;
        const items = Array.isArray(data?.items) ? data.items : [];
        const map = {};
        for (const h of items) {
          if (h?.date) map[String(h.date).slice(0, 10)] = { kind: h.kind || "full", name: h.name || "" };
        }
        setHolidayMap(map);
      })
      .catch(() => {});
    return () => { active = false; };
  }, [year, month0]);

  useEffect(() => {
    setSelectedId(initialPersonId);
  }, [initialPersonId]);

  useEffect(() => {
    const bumpRemote = () => setRemoteRevision((v) => v + 1);
    const onPlannerChange = () => bumpRemote();
    const onScheduleBuilt = () => bumpRemote();
    const onScheduleSaved = () => bumpRemote();
    const onStorage = (ev) => {
      if (ev?.key === "scheduleLastSaved" || ev?.key === "scheduleBuildTrigger" || !ev?.key) {
        bumpRemote();
      }
    };

    window.addEventListener("planner:changed", onPlannerChange);
    window.addEventListener("schedule:built", onScheduleBuilt);
    window.addEventListener("schedule:saved", onScheduleSaved);
    window.addEventListener("schedule:invalidated", onScheduleSaved);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("planner:changed", onPlannerChange);
      window.removeEventListener("schedule:built", onScheduleBuilt);
      window.removeEventListener("schedule:saved", onScheduleSaved);
      window.removeEventListener("schedule:invalidated", onScheduleSaved);
      window.removeEventListener("storage", onStorage);
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
    return collapseLeaves(
      allLeaves,
      selectedPerson.id,
      selectedPerson.canon,
      ymKey,
      selectedPerson.aliasIds || selectedPerson.raw?.aliasIds || []
    );
  }, [allLeaves, selectedPerson, ymKey]);

  useEffect(() => {
    let active = true;
    if (!sectionId) {
      setRemoteAssignmentsRaw([]);
      setRemoteDefs([]);
      setRemoteError("");
      setRemoteLoading(false);
      setRemoteServiceIdUsed(null);
      setRemoteRoleUsed(null);
      return () => {};
    }
    if (!canManage && !effectiveServiceId && !selectedPerson) {
      setRemoteAssignmentsRaw([]);
      setRemoteDefs([]);
      setRemoteError("");
      setRemoteLoading(false);
      setRemoteServiceIdUsed(null);
      setRemoteRoleUsed(null);
      return () => {};
    }
    setRemoteLoading(true);
    (async () => {
      try {
        const explicitServiceKey = String(effectiveServiceId ?? "").trim();
        const explicitRoleKey = String(scheduleRole ?? "").trim();
        const candidates = Array.from(
          new Set([effectiveServiceId, String(serviceId ?? "").trim(), ""].filter(v => v !== undefined))
        );
        const roleCandidates = Array.from(
          new Set([scheduleRole, "", "Nurse", "Doctor"].map((v) => String(v ?? "").trim()))
        );
        const targetPid = selectedPerson?.id ? String(selectedPerson.id) : "";
        const targetCanon = selectedPerson?.canon ? String(selectedPerson.canon) : "";
        const countPersonMatches = (list) => {
          if (!Array.isArray(list) || !list.length) return 0;
          if (!targetPid && !targetCanon) return list.length;
          let count = 0;
          for (const item of list) {
            if (!item) continue;
            const pidRaw = item.personId ?? item.personID ?? item.staffId ?? item.pid ?? "";
            const pid = pidRaw == null ? "" : String(pidRaw).trim();
            const nameRaw = item.personName ?? item.fullName ?? item.name ?? "";
            const idMatch = !!targetPid && !!pid && pid === targetPid;
            const canonMatch = !!targetCanon && !!nameRaw && canonName(nameRaw) === targetCanon;
            if (idMatch || canonMatch) count += 1;
          }
          return count;
        };

        // Prefer the explicit monthly key first. If that exact read-model row exists,
        // do not guess across other service/role combinations.
        if (explicitServiceKey || explicitRoleKey) {
          const explicitSchedule = await getMonthlySchedule({
            sectionId,
            serviceId: explicitServiceKey,
            role: explicitRoleKey,
            year,
            month,
          });
          if (explicitSchedule) {
            const explicitCandidate = buildRemoteScheduleCandidate({
              schedule: explicitSchedule,
              serviceId: explicitServiceKey,
              role: explicitRoleKey,
              year,
              month,
              countPersonMatches,
            });
            const explicitGenerated = await getGeneratedSchedule({
              sectionId,
              serviceId: explicitServiceKey,
              role: explicitRoleKey,
              year,
              month,
            }).catch((err) => {
              if (err?.status !== 404) throw err;
              return null;
            });
            const explicitAssignments =
              (explicitCandidate?.normalizedAssignments?.length
                ? explicitCandidate.normalizedAssignments
                : null) ??
              (Array.isArray(explicitGenerated?.assignments) && explicitGenerated.assignments.length
                ? explicitGenerated.assignments
                : []);
            const explicitMatches = countPersonMatches(explicitAssignments);
            const hasTarget = !!targetPid || !!targetCanon;
            const explicitUsable =
              explicitAssignments.length > 0 && (!hasTarget || explicitMatches > 0);
            if (explicitUsable) {
              if (!active) return;
              setRemoteDefs(explicitCandidate?.defs || []);
              setRemoteAssignmentsRaw(explicitAssignments);
              setRemoteServiceIdUsed(explicitServiceKey || null);
              setRemoteRoleUsed(explicitRoleKey || null);
              setRemoteError("");
              return;
            }
          }
        }

        const fetched = [];
        const roleList = roleCandidates.length ? roleCandidates : [""];
        for (const roleKey of roleList) {
          for (const sid of candidates) {
            const s = await getMonthlySchedule({
              sectionId,
              serviceId: sid,
              role: roleKey,
              year,
              month,
            });
            if (!s) continue;
            fetched.push(buildRemoteScheduleCandidate({
              schedule: s,
              serviceId: sid,
              role: roleKey,
              year,
              month,
              countPersonMatches,
            }));
          }
        }

        fetched.sort((a, b) => {
          if (b.personMatches !== a.personMatches) return b.personMatches - a.personMatches;
          if (b.assignmentCount !== a.assignmentCount) return b.assignmentCount - a.assignmentCount;
          if (b.defCount !== a.defCount) return b.defCount - a.defCount;
          const aServicePref = a.serviceId === effectiveServiceId ? 1 : 0;
          const bServicePref = b.serviceId === effectiveServiceId ? 1 : 0;
          if (bServicePref !== aServicePref) return bServicePref - aServicePref;
          const aRolePref = a.role === scheduleRole ? 1 : 0;
          const bRolePref = b.role === scheduleRole ? 1 : 0;
          if (bRolePref !== aRolePref) return bRolePref - aRolePref;
          return b.updatedAtTs - a.updatedAtTs;
        });

        const picked = fetched[0] || null;
        const pickedMonthlyAssignments = picked?.normalizedAssignments?.length
          ? picked.normalizedAssignments
          : null;
        const pickedGenerated = !pickedMonthlyAssignments && picked
          ? await getGeneratedSchedule({
              sectionId,
              serviceId: String(picked.serviceId ?? ""),
              role: String(picked.role ?? ""),
              year,
              month,
            }).catch((err) => {
              if (err?.status !== 404) throw err;
              return null;
            })
          : null;
        if (!active) return;
        setRemoteDefs(picked?.defs || []);
        setRemoteAssignmentsRaw(
          pickedMonthlyAssignments ??
          (Array.isArray(pickedGenerated?.assignments) && pickedGenerated.assignments.length
            ? pickedGenerated.assignments
            : [])
        );
        setRemoteServiceIdUsed(picked ? String(picked.serviceId ?? "") : null);
        setRemoteRoleUsed(picked ? String(picked.role ?? "") : null);
        setRemoteError("");
      } catch (err) {
        if (!active) return;
        // Mevcut veriyi koru — geçici hata anında takvimi boşaltma
        setRemoteError(err?.message || "Sunucudan nöbet verisi alınamadı.");
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
      defs: remoteDefs,
    });
  }, [selectedPerson, year, month0, remoteAssignmentsRaw, remoteDefs]);

  const workingHoursRaw = useMemo(() => {
    return Array.isArray(workingHours) ? workingHours : [];
  }, [workingHours, settingsRevision]);

  // remoteDefs, workingHoursRaw ile aynı shiftCode'a sahip olduğunda start/end bilgisini
  // silerek saat hesabını bozuyor — bu yüzden summaryWorkingHours sadece workingHoursRaw'dan üretiliyor.
  // remoteDefs, shiftOptions fallback'inde ve def etiket zenginleştirmesinde ayrıca kullanılıyor.
  const summaryWorkingHours = useMemo(
    () => normalizeWorkingHours(workingHoursRaw || []),
    [workingHoursRaw]
  );

  const shiftOptions = useMemo(() => {
    const merged = summaryWorkingHours;
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
  }, [remoteDefs, settingsRevision, summaryWorkingHours]);

  const areaOptions = useMemo(() => {
    const fromPropsRaw = Array.isArray(workAreas) ? workAreas : [];
    const fromPeopleRaw = collectAreasFromPeople(people);
    const merged = normalizeWorkAreas([...fromPropsRaw, ...fromPeopleRaw]);
    if (merged.length) return merged;
    const set = new Set();
    (remoteDefs || []).forEach((def) => {
      const label = String(def?.label ?? def?.area ?? def?.name ?? "").trim();
      if (label) set.add(label);
    });
    return Array.from(set.values()).sort((a, b) => a.localeCompare(b, "tr", { sensitivity: "base" }));
  }, [remoteDefs, settingsRevision, workAreas, people]);

  const assignmentsByDay = useMemo(() => {
    const combined = new Map();
    const merge = (srcMap) => {
      if (!(srcMap instanceof Map)) return;
      for (const [day, list] of srcMap.entries()) {
        if (!combined.has(day)) combined.set(day, []);
        combined.get(day).push(...list);
      }
    };
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
    remoteAssignments,
    leavesForPerson,
    year,
    month0,
  ]);

  const resolvePlanHours = useMemo(() => createPlanWorkHourResolver(summaryWorkingHours), [summaryWorkingHours]);

  const displaySummaryAssignments = useMemo(() => {
    const out = [];
    for (const [dayNum, list] of assignmentsByDay.entries()) {
      for (const item of Array.isArray(list) ? list : []) {
        out.push({
          ...item,
          day: `${year}-${pad2(month0 + 1)}-${pad2(dayNum)}`,
          date: `${year}-${pad2(month0 + 1)}-${pad2(dayNum)}`,
          personId: String(item?.personId || selectedPerson?.id || "").trim(),
          personName: String(item?.personName || selectedPerson?.name || "").trim(),
          rowLabel: String(item?.rowLabel || item?.roleLabel || item?.label || item?.area || "").trim(),
        });
      }
    }
    return out;
  }, [assignmentsByDay, year, month0, selectedPerson]);

  const truthSummary = useMemo(() => {
    if (!selectedPerson) return null;
    const totalsIndex = buildMonthlyTotalsIndex(displaySummaryAssignments, {
      people,
      resolveHours: resolvePlanHours,
      preferExplicitHours: true,
    });
    return (
      totalsIndex.get(`id:${String(selectedPerson.id || "").trim()}`) ||
      totalsIndex.get(`name:${selectedPerson.canon || canonName(selectedPerson.name || "")}`) ||
      null
    );
  }, [selectedPerson, displaySummaryAssignments, people, resolvePlanHours]);

  const overtimeStats = useMemo(() => {
    if (!selectedPerson) return null;
    try {
      const leaveRules = buildLeaveCreditRules(
        LS.get("leaveTypesV2", []),
        LEAVE_RULES
      );

      const officialHolidaysYmd = new Set();
      const arifeDaysYmd = new Set();
      Object.entries(holidayMap || {}).forEach(([dateStr, holiday]) => {
        const kind = String(holiday?.kind || "").toLowerCase();
        if (kind === "arife" || kind === "half") arifeDaysYmd.add(dateStr);
        else if (kind === "full") officialHolidaysYmd.add(dateStr);
      });

      const requiredBase = requiredHoursBase(year, month0 + 1, officialHolidaysYmd, arifeDaysYmd);
      const personLeavesByDay = buildLeaveCodesByDayMap(leavesForPerson, year, month0);
      const leaveCredit = workedLikeLeaveHours(year, month0 + 1, personLeavesByDay, leaveRules);
      const worked = sumWorkedHoursForPersonMonth(displaySummaryAssignments, selectedPerson.id, {
        personName: selectedPerson.name,
        people,
        resolveHours: resolvePlanHours,
        preferExplicitHours: true,
      });

      const requiredFinal = Math.max(0, requiredBase - leaveCredit);
      const overtime = worked - requiredFinal;

      return { requiredBase, leaveCredit, requiredFinal, worked, overtime };
    } catch {
      return null;
    }
  }, [selectedPerson, year, month0, leavesForPerson, displaySummaryAssignments, people, resolvePlanHours, holidayMap]);

  const { cells } = useMemo(() => buildMonthDays(year, month0), [year, month0]);
  const displayCells = useMemo(() => buildDisplayCells(year, month0), [year, month0]);

  const renderAssignments = (list = []) =>
    list.map((assg, idx) => {
      const isEditable = canManage && assg?.source === "remote";
      const isPinned = !!assg?.pinned;
      return (
        <div
          key={assg.id ?? `${assg.shiftCode || ""}-${assg.roleLabel || ""}-${idx}`}
          className={`rounded bg-blue-50 border border-blue-200 px-1 py-0.5 text-[11px] text-blue-700 mt-1 flex items-center justify-between gap-2 group overflow-hidden ${
            isEditable ? "cursor-pointer hover:bg-blue-100" : ""
          }`}
          title={[assg.shiftCode || assg.code || "-", assg.roleLabel || ""].filter(Boolean).join(" · ")}
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
          <span className="flex min-w-0 items-center gap-1">
            {isPinned && <span title="Sabitlenmiş">📌</span>}
            <span className="shrink-0 font-semibold">{assg.shiftCode || assg.code || "-"}</span>
            {assg.roleLabel ? <span className="ml-1 truncate">{assg.roleLabel}</span> : null}
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
    const rawLabel = String(assg?.roleLabel || assg?.label || "").trim();
    const inferredLabel =
      rawLabel ||
      (assg?.supervisorTask || isServiceSupervisorLabel(rawLabel) ? SERVICE_SUPERVISOR_LABEL : "");
    setAssignShiftId(shiftId);
    setAssignRoleLabel(inferredLabel);
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
      window.dispatchEvent(new Event("planner:changed"));
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
      const prevShiftId = String(
        assignModal.assg?.shiftId || assignModal.assg?.shiftCode || assignModal.assg?.shift || assignModal.assg?.code || ""
      ).trim();
      const baseRoleLabel = String(assignRoleLabel || "").trim();
      const roleLabel = baseRoleLabel
        || (assignModal.assg?.supervisorTask ? SERVICE_SUPERVISOR_LABEL : "");
      await assignSchedule({
        sectionId,
        serviceId: remoteServiceIdUsed ?? effectiveServiceId,
        role: remoteRoleUsed ?? scheduleRole,
        date: assignModal.dateStr,
        shiftId,
        shiftCode: shiftId,
        ...(assignModal.mode === "edit" && prevShiftId && prevShiftId !== shiftId
          ? { previousShiftId: prevShiftId }
          : {}),
        personId: selectedPerson.id,
        personName: selectedPerson.name,
        roleLabel,
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
    const pname = String(assg?.personName || selectedPerson.name || "").trim();
    if (!dateStr || !shiftId || !pid) return;
    if (!window.confirm(`${selectedPerson.name} için ${dateStr} tarihli nöbet silinsin mi?`)) return;
    try {
      await unassignSchedule({
        sectionId,
        serviceId: remoteServiceIdUsed ?? effectiveServiceId,
        role: remoteRoleUsed ?? scheduleRole,
        date: dateStr,
        shiftId,
        personId: pid,
        personName: pname || undefined,
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
        <div className="min-w-[140px]">
          <div className="text-xs text-slate-500">Dönem</div>
          <div className="text-base font-semibold text-slate-800">
            {Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric" }).format(new Date(year, month0))}
          </div>
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
        {!canManage && selectedPerson && (
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
          {showStats ? "Özeti Gizle" : "Özeti Göster"}
        </button>
      </div>

      {/* Uyarılar */}
      {!selectedPerson && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 text-amber-800 px-4 py-3 text-sm">
          Bu kullanıcıyla eşleşen bir personel kaydı bulunamadı. Personel listesinde kimlik bilgilerinizi
          güncelleyip tekrar deneyin.
        </div>
      )}

      {canManage && remoteError && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-700 px-4 py-3 text-sm">
          {remoteError}
        </div>
      )}

      {/* Takvim Loading */}
      {remoteLoading && (
        <div className="flex items-center gap-2 rounded-lg border border-sky-100 bg-sky-50 px-4 py-2.5 text-sm text-sky-700">
          <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
          </svg>
          Çizelge yükleniyor…
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
        {displayCells.map(({ date: dt, inMonth }, idx) => {
          const dayNum = dt.getDate();
          if (!inMonth) {
            return (
              <DayCard
                key={`outside-${idx}-${year}-${month0}-${dayNum}`}
                dayNum={dayNum}
                dateObj={dt}
                leaveCode=""
                assignments={[]}
                isWeekend={dt.getDay() === 0 || dt.getDay() === 6}
                requiredCount={0}
                showCoverageStatus={false}
                isOutsideMonth
                renderLeave={renderLeave}
                renderAssignments={renderAssignments}
                onAddShift={null}
                onRemoveShift={null}
                onEditShift={null}
                hasConflict={false}
                conflictLeaveCode=""
                holiday={null}
              />
            );
          }
          const assignments = assignmentsByDay.get(dayNum) || [];
          const leaveCodeRaw =
            leavesForPerson[String(dayNum)] || leavesForPerson[`${year}-${pad2(month0 + 1)}-${pad2(dayNum)}`];
          const leaveFormatted = formatLeaveValue(leaveCodeRaw);
          const hasConflict = assignments.length > 0 && !!leaveFormatted;
          const leaveCode = hasConflict ? "" : leaveFormatted;
          const isWeekend = dt.getDay() === 0 || dt.getDay() === 6;
          const dateStr = `${year}-${pad2(month0 + 1)}-${pad2(dayNum)}`;
          const holiday = holidayMap[dateStr] || null;

          return (
            <DayCard
              key={`day-${dayNum}`}
              dayNum={dayNum}
              dateObj={dt}
              leaveCode={leaveCode}
              assignments={assignments}
              isWeekend={isWeekend}
              requiredCount={0}
              showCoverageStatus={false}
              renderLeave={renderLeave}
              renderAssignments={renderAssignments}
              onAddShift={canManage ? () => openAssignModal(dayNum) : null}
              onRemoveShift={canManage ? (assg) => handleRemoveShift(assg, dayNum) : null}
              onEditShift={null}
              hasConflict={hasConflict}
              conflictLeaveCode={hasConflict ? leaveFormatted : ""}
              holiday={holiday}
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
          planSummary={truthSummary}
          requiredPerDay={2}
          workingHours={shiftOptions}
          overtimeStats={overtimeStats}
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
        <div className="mt-1">
          <span className="inline-block h-3 w-3 bg-amber-100 border border-amber-400 mr-2 align-middle rounded" />
          İzin + Vardiya çakışması (aynı günde her ikisi de mevcut)
        </div>
        <div className="mt-1">
          <span className="inline-block h-3 w-3 bg-orange-100 border border-orange-200 mr-2 align-middle rounded" />
          Resmi tatil (Türkiye)
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
