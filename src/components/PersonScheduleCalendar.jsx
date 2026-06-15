// src/components/PersonScheduleCalendar.jsx (UPDATED)
import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { buildMonthDays } from "../utils/date.js";
import { LS } from "../utils/storage.js";
import { assignSchedule, unassignSchedule } from "../api/apiAdapter.js";
import { setLeave, setLeaveWithCheck } from "../lib/leaves.js";
import { API } from "../lib/api.js";
import DayCard from "./DayCard.jsx";
import MonthStats from "./MonthStats.jsx";
import Modal from "./Modal.jsx";
import { LEAVE_RULES } from "../constants/rules.js";
import { buildLeaveCreditRules } from "../utils/leaveTypeRules.js";
import { buildMonthlyTotalsIndex, createPlanWorkHourResolver, sumWorkedHoursForPersonMonth } from "../utils/planWorkCalculator.js";
import { requiredHoursBase, workedLikeLeaveHours } from "../utils/overtime.js";
import { fetchScheduleTruth } from "../utils/scheduleTruth.js";
import OverrideDialog from "./OverrideDialog.jsx";
import QuickReplacePanel from "./QuickReplacePanel.jsx";
import { resolvePersonId } from "../utils/personIdentity.js";
import { resolvePersonWorkAreaNames } from "../lib/workAreasModel.js";

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
const DEFAULT_LEAVE_TYPE_NAMES = {
  AN: "Ay sonu nöbet izni",
  B: "Boşluk isteği",
  "Bİ": "Babalık izni",
  "Dİ": "Doğum izni",
  "Eİ": "Evlilik izni",
  G: "Görev izni",
  H: "Hafta tatili",
  "İ": "İzin",
  "İİ": "İdari izin",
  KN: "Kesin nöbet",
  R: "Rapor",
  RE: "Refakat izni",
  S: "Senelik izin",
  "Sİ": "Sağlık izni",
  "SÜ": "Süt izni",
  "SÜ1": "Süt izni 1",
  "SÜ2": "Süt izni 2",
  "Üİ": "Ücretsiz izin",
  Y: "Yıllık izin",
};
const INTERNAL_LEAVE_CODES = new Set(["ÇŞ", "KN"]);
const PREFERRED_LEAVE_CODE_ORDER = ["Y", "R", "SÜ", "SÜ1", "SÜ2", "Eİ", "Bİ", "Dİ", "İ", "İİ", "Üİ", "RE", "Sİ", "B", "AN"];

const SOURCE_PRIORITY = {
  remote: 3,
};

function normalizeLeaveCode(code = "") {
  return String(code || "").trim().toLocaleUpperCase("tr-TR");
}

function normalizeLeaveType(type) {
  if (!type) return null;
  const code = normalizeLeaveCode(
    type.code ??
      type.kisaltma ??
      type.abbr ??
      type.short ??
      type.KISALTMA ??
      type.value ??
      ""
  );
  if (!code) return null;
  const name = String(
    type.name ??
      type.turAdi ??
      type.title ??
      type.label ??
      type.TUR_ADI ??
      type["TÜR_ADI"] ??
      DEFAULT_LEAVE_TYPE_NAMES[code] ??
      ""
  ).trim();
  const description = String(
    type.description ??
      type.desc ??
      type.aciklama ??
      type.açıklama ??
      ""
  ).trim();
  return { code, name, description };
}

function buildLeaveTypeOptions(leaveTypes = []) {
  const map = new Map();
  const add = (item) => {
    const normalized = normalizeLeaveType(item);
    if (!normalized) return;
    const current = map.get(normalized.code);
    map.set(normalized.code, {
      code: normalized.code,
      name: normalized.name || current?.name || "",
      description: normalized.description || current?.description || "",
    });
  };

  Object.keys(LEAVE_RULES || {}).forEach((code) => {
    add({ code, name: DEFAULT_LEAVE_TYPE_NAMES[normalizeLeaveCode(code)] || "" });
  });
  Object.entries(DEFAULT_LEAVE_TYPE_NAMES).forEach(([code, name]) => add({ code, name }));
  (Array.isArray(leaveTypes) ? leaveTypes : []).forEach(add);

  return Array.from(map.values())
    .filter((item) => !INTERNAL_LEAVE_CODES.has(item.code))
    .sort((a, b) => {
      const ai = PREFERRED_LEAVE_CODE_ORDER.indexOf(a.code);
      const bi = PREFERRED_LEAVE_CODE_ORDER.indexOf(b.code);
      if (ai !== -1 || bi !== -1) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      return a.code.localeCompare(b.code, "tr", { sensitivity: "base" });
    });
}

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

function dedupeTextList(values) {
  const map = new Map();
  (Array.isArray(values) ? values : []).forEach((value) => {
    const text = String(value || "").trim();
    if (!text) return;
    const key = text.toLocaleUpperCase("tr-TR");
    if (!map.has(key)) map.set(key, text);
  });
  return Array.from(map.values());
}

function splitShiftTokens(value) {
  return String(value || "")
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function extractShiftCodesFromPerson(person) {
  const out = [];
  const candidates = [
    person?.shiftCodes,
    person?.shifts,
    person?.vardiyalar,
    person?.meta?.shiftCodes,
    person?.meta?.shifts,
    person?.meta?.vardiyalar,
    person?.raw?.shiftCodes,
    person?.raw?.shifts,
    person?.raw?.vardiyalar,
    person?.raw?.meta?.shiftCodes,
    person?.raw?.meta?.shifts,
    person?.["VARDİYE KODLARI"],
    person?.["VARDIYE KODLARI"],
    person?.["VARDİYELER"],
    person?.["VARDIYELER"],
    person?.raw?.["VARDİYE KODLARI"],
    person?.raw?.["VARDIYE KODLARI"],
    person?.raw?.["VARDİYELER"],
    person?.raw?.["VARDIYELER"],
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (Array.isArray(candidate)) {
      for (const item of candidate) {
        if (!item) continue;
        if (typeof item === "string") {
          out.push(...splitShiftTokens(item));
        } else if (typeof item === "object") {
          const code = item.shiftCode ?? item.code ?? item.id ?? item.name ?? item.label ?? "";
          if (code) out.push(...splitShiftTokens(code));
        }
      }
      continue;
    }
    if (typeof candidate === "string") {
      out.push(...splitShiftTokens(candidate));
      continue;
    }
    if (typeof candidate === "object") {
      const code = candidate.shiftCode ?? candidate.code ?? candidate.id ?? candidate.name ?? candidate.label ?? "";
      if (code) out.push(...splitShiftTokens(code));
    }
  }
  return dedupeTextList(out);
}

function shiftKey(value) {
  return String(value || "").trim().toLocaleUpperCase("tr-TR");
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
  const realId = resolvePersonId(person);
  const fallbackId = name ? `name:${canonName(name)}` : "";
  const id = realId || fallbackId;
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

function hasReadableShiftLabels(list = []) {
  return (Array.isArray(list) ? list : []).some((item) => {
    const raw = String(item?.shiftCode ?? item?.shift ?? item?.code ?? "").trim();
    return !!raw && !/^\d{10,}$/.test(raw);
  });
}

function normalizeAssignmentForDisplay(item, defsIndex) {
  if (!item || typeof item !== "object") return item;
  const safeIndex = defsIndex || { byId: new Map(), byShift: new Map() };
  const shiftIdKey = String(item?.shiftId ?? item?.rowId ?? "").trim();
  const shiftCodeKey = String(item?.shiftCode ?? item?.shift ?? item?.code ?? "").trim();
  const roleLabel = String(item?.roleLabel ?? item?.role ?? item?.label ?? "").trim();

  let def = null;
  if (shiftIdKey && safeIndex.byId.has(shiftIdKey)) def = safeIndex.byId.get(shiftIdKey);
  else if (shiftCodeKey && safeIndex.byId.has(shiftCodeKey)) def = safeIndex.byId.get(shiftCodeKey);
  else if (shiftCodeKey && safeIndex.byShift.has(shiftCodeKey)) def = safeIndex.byShift.get(shiftCodeKey);

  if (!def && roleLabel) {
    for (const candidate of safeIndex.byId.values()) {
      const defLabel = String(candidate?.label ?? candidate?.name ?? candidate?.area ?? "").trim();
      const defShift = String(candidate?.shiftCode ?? candidate?.code ?? "").trim();
      if (!defLabel || !defShift) continue;
      if (defLabel === roleLabel && (!shiftCodeKey || /^\d{10,}$/.test(shiftCodeKey))) {
        def = candidate;
        break;
      }
    }
  }

  if (!def) return item;

  const defShift = String(def?.shiftCode ?? def?.code ?? "").trim();
  const defLabel = String(def?.label ?? def?.name ?? def?.area ?? "").trim();
  return {
    ...item,
    shiftId: shiftIdKey || String(def?.id ?? def?.rowId ?? "").trim() || item?.shiftId,
    shiftCode:
      !shiftCodeKey || /^\d{10,}$/.test(shiftCodeKey)
        ? (defShift || shiftCodeKey || item?.shiftCode)
        : item?.shiftCode,
    roleLabel: roleLabel || defLabel || item?.roleLabel,
  };
}

function displayShiftToken(assg = {}) {
  const raw = String(assg?.shiftCode || assg?.code || "").trim();
  if (raw && !/^\d{10,}$/.test(raw)) return raw;
  const label = String(assg?.roleLabel || assg?.rowLabel || assg?.label || "").trim();
  return label || "-";
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

    const assignment = normalizeAssignmentForDisplay({
      day: dateStr,
      shiftId,
      shiftCode,
      roleLabel,
      personId: pid || (targetPid || undefined),
      personName: nameRaw || undefined,
      note: item.note || undefined,
      pinned: !!item.pinned,
      source: "remote",
    }, defIndex);

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

const PersonScheduleCalendar = forwardRef(function PersonScheduleCalendar({
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
  leaveTypes = [],
}, ref) {
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
  const [overrideDialog, setOverrideDialog] = useState({ open: false, errors: [], pending: null });
  const [quickReplaceOpen, setQuickReplaceOpen] = useState(false);
  const [quickReplaceSelection, setQuickReplaceSelection] = useState(null);
  const [swappedDates, setSwappedDates] = useState(new Set());
  const [leaveClearedDates, setLeaveClearedDates] = useState(new Set());
  const [leaveModal, setLeaveModal] = useState({ open: false, dayNum: null, dateStr: "" });
  const [leaveModalCode, setLeaveModalCode] = useState("");
  const [leaveModalNote, setLeaveModalNote] = useState("");
  const [leaveModalSaving, setLeaveModalSaving] = useState(false);
  const [leaveModalError, setLeaveModalError] = useState("");
  const [leaveBackendConflict, setLeaveBackendConflict] = useState(null);
  const pendingRefreshRef = useRef(null);
  const hasFetchedOnceRef = useRef(false);
  const [settingsRevision, setSettingsRevision] = useState(0);
  const [googleCalendarStatus, setGoogleCalendarStatus] = useState({
    loading: false,
    connected: false,
    lastSyncAt: null,
    message: "",
  });
  const [googleCalendarBusy, setGoogleCalendarBusy] = useState(false);

  const leaveTypeOptions = useMemo(() => {
    const storedLeaveTypes = LS.get("leaveTypesV2", []);
    return buildLeaveTypeOptions(
      Array.isArray(leaveTypes) && leaveTypes.length ? leaveTypes : storedLeaveTypes
    );
  }, [leaveTypes, settingsRevision]);

  const leaveTypeByCode = useMemo(() => {
    const map = new Map();
    leaveTypeOptions.forEach((item) => map.set(item.code, item));
    return map;
  }, [leaveTypeOptions]);

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
    if (canManage) return;
    let active = true;
    setGoogleCalendarStatus((s) => ({ ...s, loading: true }));
    API.http.get("/api/calendar/google/status")
      .then((data) => {
        if (!active) return;
        setGoogleCalendarStatus({
          loading: false,
          connected: !!data?.connected,
          lastSyncAt: data?.lastSyncAt || null,
          message: "",
        });
      })
      .catch((err) => {
        if (!active) return;
        setGoogleCalendarStatus({
          loading: false,
          connected: false,
          lastSyncAt: null,
          message: err?.message || "Google Takvim durumu alınamadı",
        });
      });
    return () => { active = false; };
  }, [canManage]);

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

  const effectiveScheduleRole = useMemo(() => {
    const explicit = String(scheduleRole ?? "").trim();
    if (explicit) return explicit;
    const roleHint = String(
      selectedPerson?.raw?.meta?.role ??
        selectedPerson?.raw?.role ??
        selectedPerson?.role ??
        selectedPerson?.raw?.title ??
        selectedPerson?.raw?.meta?.title ??
        ""
    ).toLowerCase();
    if (/doktor|doctor|hekim|tabip/.test(roleHint)) return "Doctor";
    if (/nurse|hemşire|hemsire|ebe|att|memur/.test(roleHint)) return "Nurse";
    return "";
  }, [scheduleRole, selectedPerson]);

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
        const explicitRoleKey = String(effectiveScheduleRole ?? "").trim();
        const candidates = Array.from(
          new Set([effectiveServiceId, String(serviceId ?? "").trim(), ""].filter(v => v !== undefined))
        );
        const roleCandidates = Array.from(
          new Set([effectiveScheduleRole, "", "Nurse", "Doctor"].map((v) => String(v ?? "").trim()))
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

        // Bu ekran Assignment/person-calendar fast-path kullanmıyor.
        // Kaynak doğrudan Çalışma Çizelgesi read-modeli olmalı:
        // önce monthly/generated schedule, sonra zorunlu legacy fallback.
        // Böylece görev etiketi ve vardiya saatleri defs üzerinden doğru çözülür.
        // Prefer the explicit monthly key first. If that exact read-model row exists,
        // do not guess across other service/role combinations.
        if (explicitServiceKey || explicitRoleKey) {
          const explicitCandidate = await fetchScheduleTruth({
            sectionId,
            serviceId: explicitServiceKey,
            role: explicitRoleKey,
            year,
            month,
            options: { preferScheduleReadModel: true },
          }).catch((err) => {
            if (err?.status !== 404) throw err;
            return null;
          });
          const explicitAssignments = Array.isArray(explicitCandidate?.assignments)
            ? explicitCandidate.assignments
            : [];
          const explicitMatches = countPersonMatches(explicitAssignments);
          const hasTarget = !!targetPid || !!targetCanon;
          const explicitUsable =
            explicitAssignments.length > 0 &&
            (!hasTarget || explicitMatches > 0) &&
            ((explicitCandidate?.defs || []).length > 0 || hasReadableShiftLabels(explicitAssignments));
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

        const fetched = [];
        const roleList = roleCandidates.length ? roleCandidates : [""];
        for (const roleKey of roleList) {
          for (const sid of candidates) {
            const truth = await fetchScheduleTruth({
              sectionId,
              serviceId: sid,
              role: roleKey,
              year,
              month,
              options: { preferScheduleReadModel: true },
            }).catch((err) => {
              if (err?.status !== 404) throw err;
              return null;
            });
            if (!truth) continue;
            fetched.push({
              serviceId: sid,
              role: roleKey,
              defs: truth?.defs || [],
              normalizedAssignments: Array.isArray(truth?.assignments) ? truth.assignments : [],
              personMatches: countPersonMatches(truth?.assignments || []),
              assignmentCount: Array.isArray(truth?.assignments) ? truth.assignments.length : 0,
              defCount: Array.isArray(truth?.defs) ? truth.defs.length : 0,
              updatedAtTs: Date.parse(truth?.schedule?.updatedAt || "") || 0,
            });
          }
        }

        fetched.sort((a, b) => {
          if (b.personMatches !== a.personMatches) return b.personMatches - a.personMatches;
          if (b.assignmentCount !== a.assignmentCount) return b.assignmentCount - a.assignmentCount;
          if (b.defCount !== a.defCount) return b.defCount - a.defCount;
          const aServicePref = a.serviceId === effectiveServiceId ? 1 : 0;
          const bServicePref = b.serviceId === effectiveServiceId ? 1 : 0;
          if (bServicePref !== aServicePref) return bServicePref - aServicePref;
          const aRolePref = a.role === effectiveScheduleRole ? 1 : 0;
          const bRolePref = b.role === effectiveScheduleRole ? 1 : 0;
          if (bRolePref !== aRolePref) return bRolePref - aRolePref;
          return b.updatedAtTs - a.updatedAtTs;
        });

        const picked = fetched[0] || null;
        if (!active) return;
        setRemoteDefs(picked?.defs || []);
        setRemoteAssignmentsRaw(Array.isArray(picked?.normalizedAssignments) ? picked.normalizedAssignments : []);
        setRemoteServiceIdUsed(picked ? String(picked.serviceId ?? "") : null);
        setRemoteRoleUsed(picked ? String(picked.role ?? "") : null);
        setRemoteError("");
      } catch (err) {
        if (!active) return;
        // Mevcut veriyi koru — geçici hata anında takvimi boşaltma
        setRemoteError(err?.message || "Sunucudan nöbet verisi alınamadı.");
      } finally {
        if (active) {
          setRemoteLoading(false);
          hasFetchedOnceRef.current = true;
          const resolve = pendingRefreshRef.current;
          pendingRefreshRef.current = null;
          resolve?.();
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [canManage, sectionId, effectiveServiceId, effectiveScheduleRole, year, month, remoteRevision, serviceId]);

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

  const selectedPersonRaw = selectedPerson?.raw || selectedPerson || null;

  const personAreaOptions = useMemo(() => {
    if (!selectedPersonRaw) return [];
    return dedupeTextList([
      ...resolvePersonWorkAreaNames(selectedPersonRaw, workAreas),
      ...extractAreasFromPerson(selectedPersonRaw),
    ]);
  }, [selectedPersonRaw, workAreas, settingsRevision]);

  const selectedPersonShiftCodes = useMemo(() => {
    if (!selectedPersonRaw) return [];
    return extractShiftCodesFromPerson(selectedPersonRaw);
  }, [selectedPersonRaw, settingsRevision]);

  const personShiftOptions = useMemo(() => {
    if (!selectedPersonShiftCodes.length) return [];
    const wanted = new Set(selectedPersonShiftCodes.map(shiftKey));
    const matched = shiftOptions.filter((opt) => wanted.has(shiftKey(opt.code)));
    if (matched.length) return matched;
    return selectedPersonShiftCodes.map((code) => ({ code, label: code }));
  }, [selectedPersonShiftCodes, shiftOptions]);

  const areaOptions = useMemo(() => {
    // workAreas prop boşsa localStorage'dan fallback oku — settings henüz yüklenmemişse de tam liste görünsün
    const fromPropsRaw = Array.isArray(workAreas) && workAreas.length > 0
      ? workAreas
      : (LS.get("workAreasV2") || LS.get("workAreas") || []);
    const fromPeopleRaw = collectAreasFromPeople(people);
    const globalNames = normalizeWorkAreas(fromPropsRaw);
    const peopleNames = normalizeWorkAreas(fromPeopleRaw);
    const remoteLabels = (remoteDefs || [])
      .map((def) => String(def?.label ?? def?.area ?? def?.name ?? "").trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, "tr", { sensitivity: "base" }));
    // Kişinin kendi alanları önce, ardından tüm global alanlar, sonra diğer kaynaklar
    return dedupeTextList([...personAreaOptions, ...globalNames, ...peopleNames, ...remoteLabels]);
  }, [remoteDefs, settingsRevision, workAreas, people, personAreaOptions]);

  const assignAreaOptions = useMemo(
    () => (personAreaOptions.length > 0 ? personAreaOptions : areaOptions),
    [personAreaOptions, areaOptions]
  );

  const assignShiftOptions = useMemo(
    () => (personShiftOptions.length ? personShiftOptions : shiftOptions),
    [personShiftOptions, shiftOptions]
  );

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
    for (const [day, list] of combined.entries()) {
      const unique = dedupeAssignments(list);
      // İzin olan günlerde nöbeti gizleme. Gizlemek, görev yazılmadı sanılmasına
      // ve "izin + nöbet" çakışmasının kullanıcıdan saklanmasına yol açıyordu.
      const capped = preferSingleAssignment(unique);
      if (capped.length) combined.set(day, capped);
      else combined.delete(day);
    }
    return combined;
  }, [
    remoteAssignments,
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
  const monthLabel = useMemo(
    () => Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric" }).format(new Date(year, month0, 1)),
    [year, month0]
  );

  const renderAssignments = (list = []) =>
    list.map((assg, idx) => {
      const isEditable = canManage && assg?.source === "remote";
      const isPinned = !!assg?.pinned;
      const visibleShift = displayShiftToken(assg);
      return (
        <div
          key={assg.id ?? `${visibleShift}-${assg.roleLabel || ""}-${idx}`}
          className={`rounded bg-blue-50 border border-blue-200 px-1 py-0.5 text-[11px] text-blue-700 mt-1 flex items-center justify-between gap-2 group overflow-hidden ${
            isEditable ? "cursor-pointer hover:bg-blue-100" : ""
          }`}
          title={[visibleShift, assg.roleLabel || ""].filter(Boolean).join(" · ")}
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
            <span className="shrink-0 font-semibold">{visibleShift}</span>
            {assg.roleLabel ? <span className="ml-1 truncate">{assg.roleLabel}</span> : null}
          </span>
          {isEditable && (
            <span className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setQuickReplaceSelection({
                    date: String(assg?.day || assg?.date || "").slice(0, 10),
                    taskLabel: String(assg?.roleLabel || assg?.label || "").trim(),
                    shiftCode: String(assg?.shiftCode || assg?.code || "").trim(),
                    rowId: String(assg?.rowId || assg?.shiftId || "").trim(),
                    shiftId: String(assg?.shiftId || assg?.rowId || assg?.shiftCode || "").trim(),
                    personId: String(assg?.personId || selectedPerson?.id || "").trim(),
                    personName: String(assg?.personName || selectedPerson?.name || "").trim(),
                    autoSearch: true,
                  });
                  setQuickReplaceOpen(true);
                }}
                className="text-blue-500 hover:text-blue-700 transition-colors"
                title="Alternatif personel bul"
              >
                ↺
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemoveShift(assg);
                }}
                className="text-blue-500 hover:text-red-600 transition-colors"
                title="Sil"
              >
                ✕
              </button>
            </span>
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

  const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());

  const firstValidEmail = (candidates = []) =>
    String(candidates.find((value) => isValidEmail(value)) || "").trim();

  const getSelectedPersonEmail = () => {
    const raw = selectedPerson?.raw || {};
    return firstValidEmail([
      selectedPerson?.email,
      selectedPerson?.mail,
      raw.email,
      raw.mail,
      raw.eMail,
      raw.emailAddress,
      raw["Mail"],
      raw["MAIL"],
      raw["E-posta"],
      raw["EPOSTA"],
      raw?.contact?.email,
      raw?.user?.email,
      raw?.account?.email,
    ]);
  };

  const findLinkedUserEmail = async () => {
    if (!selectedPerson) return "";
    const selectedIds = new Set(
      [
        selectedPerson.id,
        selectedPerson.raw?.id,
        selectedPerson.raw?._id,
        selectedPerson.raw?.personId,
        ...(Array.isArray(selectedPerson.aliasIds) ? selectedPerson.aliasIds : []),
        ...(Array.isArray(selectedPerson.raw?.aliasIds) ? selectedPerson.raw.aliasIds : []),
      ]
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    );
    const selectedTc = String(selectedPerson.raw?.tc || selectedPerson.raw?.tcNo || selectedPerson.raw?.TCKN || "").replace(/\D+/g, "");
    const selectedCanon = selectedPerson.canon || canonName(selectedPerson.name || "");

    try {
      const data = await API.http.get("/api/users");
      const users = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
      const linked = users.find((u) => {
        const uidPerson = String(u?.personId || u?.person_id || u?.staffId || "").trim();
        if (uidPerson && selectedIds.has(uidPerson)) return true;

        const utc = String(u?.tc || u?.tcNo || u?.TCKN || "").replace(/\D+/g, "");
        if (selectedTc && utc && selectedTc === utc) return true;

        const userCanon = canonName(
          u?.name || u?.fullName || u?.displayName || [u?.firstName, u?.lastName].filter(Boolean).join(" ")
        );
        return selectedCanon && userCanon && selectedCanon === userCanon;
      });
      return firstValidEmail([linked?.email, linked?.mail, linked?.eMail, linked?.emailAddress]);
    } catch (err) {
      console.warn("linked user email lookup failed:", err?.message || err);
      return "";
    }
  };

  const buildSelectedPersonScheduleText = () => {
    if (!selectedPerson) return "";
    const daysInMonth = new Date(year, month0 + 1, 0).getDate();
    const lines = [
      `${selectedPerson.name} - ${monthLabel} Nöbet Çizelgesi`,
      "",
    ];

    for (let dayNum = 1; dayNum <= daysInMonth; dayNum += 1) {
      const dateStr = `${year}-${pad2(month0 + 1)}-${pad2(dayNum)}`;
      const dayLabel = new Date(year, month0, dayNum).toLocaleDateString("tr-TR", {
        weekday: "short",
      });
      const leaveRaw = leavesForPerson[String(dayNum)] || leavesForPerson[dateStr];
      const leaveText = formatLeaveValue(leaveRaw);
      const holidayText = holidayMap[dateStr]?.name || "";
      const assignmentText = (assignmentsByDay.get(dayNum) || [])
        .map((assg) => {
          const visibleShift = displayShiftToken(assg);
          const rowLabel = String(
            assg?.roleLabel ||
              assg?.rowLabel ||
              assg?.label ||
              assg?.area ||
              assg?.taskLabel ||
              ""
          ).trim();
          const detail = rowLabel && rowLabel !== visibleShift ? rowLabel : "";
          return [visibleShift, detail].filter(Boolean).join(" - ") || "Nöbet";
        })
        .filter(Boolean)
        .join(", ");

      const parts = [
        assignmentText,
        leaveText ? `İzin: ${leaveText}` : "",
        holidayText ? `Tatil: ${holidayText}` : "",
      ].filter(Boolean);

      if (parts.length) {
        lines.push(`${pad2(dayNum)} ${dayLabel}: ${parts.join(" | ")}`);
      }
    }

    if (lines.length === 2) {
      lines.push("Bu ay için kayıtlı nöbet bulunmuyor.");
    }

    return lines.join("\n");
  };

  const handleEmailSelectedSchedule = async () => {
    if (!selectedPerson) {
      window.alert?.("E-posta göndermek için önce personel seçin.");
      return;
    }
    const email = getSelectedPersonEmail() || await findLinkedUserEmail();
    if (!isValidEmail(email)) {
      window.alert?.(`${selectedPerson.name} için geçerli e-posta adresi bulunamadı.`);
      return;
    }

    const subject = `${selectedPerson.name} - ${monthLabel} nöbet çizelgesi`;
    const body = buildSelectedPersonScheduleText();
    window.location.href = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  useImperativeHandle(
    ref,
    () => ({
      printSchedule: () => window.print(),
      emailSchedule: handleEmailSelectedSchedule,
      getSelectedPerson: () => selectedPerson,
    }),
    [selectedPerson, assignmentsByDay, leavesForPerson, holidayMap, monthLabel]
  );

  const openAssignModal = (dayNum) => {
    if (!canManage || !selectedPerson) return;
    const dateStr = `${year}-${pad2(month0 + 1)}-${pad2(dayNum)}`;
    const first = assignShiftOptions[0]?.code || shiftOptions[0]?.code || "";
    setAssignShiftId(first);
    setAssignRoleLabel(assignAreaOptions[0] || areaOptions[0] || "");
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
    const p = new Promise((resolve) => {
      pendingRefreshRef.current = resolve;
    });
    setRemoteRevision((v) => v + 1);
    try {
      window.dispatchEvent(new Event("planner:changed"));
    } catch {}
    return p;
  };

  const buildAssignParams = () => {
    const shiftId = String(assignShiftId || "").trim();
    const prevShiftId = String(
      assignModal.assg?.shiftId || assignModal.assg?.shiftCode || assignModal.assg?.shift || assignModal.assg?.code || ""
    ).trim();
    const baseRoleLabel = String(assignRoleLabel || "").trim();
    const roleLabel = baseRoleLabel || (assignModal.assg?.supervisorTask ? SERVICE_SUPERVISOR_LABEL : "");
    return {
      sectionId,
      serviceId: remoteServiceIdUsed ?? effectiveServiceId,
      role: remoteRoleUsed ?? scheduleRole,
      date: assignModal.dateStr,
      shiftId,
      shiftCode: shiftId,
      ...(assignModal.mode === "edit" && prevShiftId
        ? { previousShiftId: prevShiftId }
        : {}),
      personId: selectedPerson.id,
      personName: selectedPerson.name,
      roleLabel,
      note: assignNote,
      pinned: assignPinned,
    };
  };

  const handleConfirmAssign = async () => {
    if (!assignModal.open || !selectedPerson) return;
    const shiftId = String(assignShiftId || "").trim();
    if (!shiftId) {
      setAssignError("Vardiya seçmelisiniz.");
      return;
    }
    try {
      await assignSchedule(buildAssignParams());
      closeAssignModal();
      refreshRemote();
    } catch (err) {
      if (err?.status === 409 && err?.body?.canForce) {
        const violations = Array.isArray(err.body.errors)
          ? err.body.errors.map((e) => (typeof e === "string" ? e : e?.message || JSON.stringify(e)))
          : [err.body.message || "Kural ihlali"];
        setOverrideDialog({ open: true, errors: violations, pending: buildAssignParams() });
      } else {
        setAssignError(err?.message || "Nöbet eklenemedi.");
      }
    }
  };

  const handleOverrideConfirm = async (reason) => {
    if (!overrideDialog.pending) return;
    try {
      await assignSchedule({ ...overrideDialog.pending, force: true, overrideReason: reason });
      setOverrideDialog({ open: false, errors: [], pending: null });
      closeAssignModal();
      refreshRemote();
    } catch (err) {
      setAssignError(err?.message || "Nöbet eklenemedi.");
      setOverrideDialog({ open: false, errors: [], pending: null });
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

  // ── Planlama Takvimi İzin Modal ────────────────────────────────────────────
  const openLeaveModal = (dayNum) => {
    if (!canManage || !selectedPerson) return;
    const dateStr = `${year}-${pad2(month0 + 1)}-${pad2(dayNum)}`;
    const existing = leavesForPerson[String(dayNum)] || leavesForPerson[dateStr];
    const existingCode = existing && typeof existing === "object" ? (existing.code || "") : (existing || "");
    const defaultCode =
      existingCode ||
      leaveTypeByCode.get("Y")?.code ||
      leaveTypeOptions[0]?.code ||
      "Y";
    setLeaveModalCode(defaultCode);
    setLeaveModalNote(existing?.note || "");
    setLeaveModalError("");
    setLeaveBackendConflict(null);
    setLeaveModal({ open: true, dayNum, dateStr });
  };

  const closeLeaveModal = () => {
    setLeaveModal({ open: false, dayNum: null, dateStr: "" });
    setLeaveModalCode("");
    setLeaveModalNote("");
    setLeaveModalError("");
    setLeaveBackendConflict(null);
  };

  const handleConfirmLeave = async (clearDuty, opts = {}) => {
    if (!selectedPerson || !leaveModal.dayNum) return;
    const code = leaveModalCode.trim();
    if (!code) { setLeaveModalError("İzin kodu seçmelisiniz."); return; }
    setLeaveModalSaving(true);
    setLeaveModalError("");
    try {
      await setLeaveWithCheck({
        personId: selectedPerson.id,
        personName: selectedPerson.name,
        year,
        month: month0 + 1,
        day: leaveModal.dayNum,
        code,
        ...(leaveModalNote.trim() ? { note: leaveModalNote.trim() } : {}),
        force: opts.force ?? clearDuty,
      });

      if (clearDuty) {
        const dutyList = assignmentsByDay.get(leaveModal.dayNum) || [];
        for (const assg of dutyList) {
          const shiftId = String(assg?.shiftId || assg?.shiftCode || assg?.shift || assg?.code || "").trim();
          if (!shiftId) continue;
          try {
            await unassignSchedule({
              sectionId,
              serviceId: remoteServiceIdUsed ?? effectiveServiceId,
              role: remoteRoleUsed ?? scheduleRole,
              date: leaveModal.dateStr,
              shiftId,
              personId: String(assg?.personId || selectedPerson.id).trim(),
              personName: String(assg?.personName || selectedPerson.name || "").trim() || undefined,
            });
          } catch (err) {
            console.warn("leave modal: unassign failed:", err?.message);
          }
        }
        setLeaveClearedDates((prev) => new Set([...prev, leaveModal.dateStr]));
        refreshRemote();
      }

      setLeaveBackendConflict(null);
      closeLeaveModal();
    } catch (err) {
      if (err?.status === 409 && err?.data?.conflict) {
        setLeaveBackendConflict(err.data);
      } else {
        setLeaveModalError(err?.message || "İzin kaydedilemedi.");
      }
    } finally {
      setLeaveModalSaving(false);
    }
  };

  const handleConnectGoogleCalendar = async () => {
    setGoogleCalendarBusy(true);
    setGoogleCalendarStatus((s) => ({ ...s, message: "" }));
    try {
      const data = await API.http.post("/api/calendar/google/auth-url", {});
      if (!data?.url) throw new Error("Google bağlantı adresi alınamadı");
      window.location.href = data.url;
    } catch (err) {
      setGoogleCalendarStatus((s) => ({
        ...s,
        message: err?.message || "Google Takvim bağlantısı başlatılamadı",
      }));
      setGoogleCalendarBusy(false);
    }
  };

  const handleSyncGoogleCalendar = async () => {
    setGoogleCalendarBusy(true);
    setGoogleCalendarStatus((s) => ({ ...s, message: "" }));
    try {
      const result = await API.http.post("/api/calendar/google/sync", {
        year,
        month: month0 + 1,
        sectionId,
      }, { timeoutMs: 60000 });
      const count = Number(result?.created || 0) + Number(result?.updated || 0) + Number(result?.skipped || 0);
      setGoogleCalendarStatus({
        loading: false,
        connected: true,
        lastSyncAt: new Date().toISOString(),
        message: `${count} nöbet Google Takvim ile eşitlendi.`,
      });
    } catch (err) {
      setGoogleCalendarStatus((s) => ({
        ...s,
        message: err?.message || "Google Takvim senkronizasyonu başarısız",
      }));
    } finally {
      setGoogleCalendarBusy(false);
    }
  };

  const handleDisconnectGoogleCalendar = async () => {
    if (!window.confirm("Google Takvim bağlantısı kaldırılsın mı? Google'daki mevcut etkinlikler silinmez.")) return;
    setGoogleCalendarBusy(true);
    try {
      await API.http.delete("/api/calendar/google/disconnect");
      setGoogleCalendarStatus({
        loading: false,
        connected: false,
        lastSyncAt: null,
        message: "Google Takvim bağlantısı kaldırıldı.",
      });
    } catch (err) {
      setGoogleCalendarStatus((s) => ({
        ...s,
        message: err?.message || "Google Takvim bağlantısı kaldırılamadı",
      }));
    } finally {
      setGoogleCalendarBusy(false);
    }
  };

  return (
    <>
    <div className="person-screen-only space-y-4">
      {selectedPerson && (
        <div className="print-only border-b border-slate-200 pb-3">
          <div className="text-base font-semibold text-slate-900">
            Personel: {selectedPerson.name}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric" }).format(new Date(year, month0))}
          </div>
        </div>
      )}
      {/* Başlık ve Personel Seçici */}
      <div className="no-print flex flex-wrap items-end gap-3">
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
        {canManage && (
          <button
            onClick={() => {
              setQuickReplaceSelection(null);
              setQuickReplaceOpen(true);
            }}
            className="px-3 py-2 rounded-lg text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 transition-colors"
          >
            Hızlı Yerine Atama
          </button>
        )}
      </div>

      {/* Uyarılar */}
      {!selectedPerson && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 text-amber-800 px-4 py-3 text-sm">
          Bu kullanıcıyla eşleşen bir personel kaydı bulunamadı. Personel listesinde kimlik bilgilerinizi
          güncelleyip tekrar deneyin.
        </div>
      )}

      {!canManage && selectedPerson && (
        <div className="no-print rounded-2xl border border-sky-100 bg-sky-50/60 p-4 text-sm text-slate-700">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[220px]">
              <div className="font-semibold text-slate-900">Google Takvim</div>
              <div className="text-xs text-slate-600 mt-1">
                Nöbetlerinizi Google Takvim’e tek yönlü aktarır. Hatırlatma: çalışmadan bir gün önce 16:00.
              </div>
              {googleCalendarStatus.lastSyncAt && (
                <div className="text-xs text-slate-500 mt-1">
                  Son senkron: {new Date(googleCalendarStatus.lastSyncAt).toLocaleString("tr-TR")}
                </div>
              )}
              {googleCalendarStatus.message && (
                <div className="text-xs text-sky-700 mt-2">{googleCalendarStatus.message}</div>
              )}
            </div>
            {googleCalendarStatus.connected ? (
              <>
                <button
                  onClick={handleSyncGoogleCalendar}
                  disabled={googleCalendarBusy}
                  className="px-3 py-2 rounded-xl bg-sky-600 text-white text-xs font-semibold hover:bg-sky-700 disabled:opacity-60"
                >
                  {googleCalendarBusy ? "Eşitleniyor..." : "Bu Ayı Eşitle"}
                </button>
                <button
                  onClick={handleDisconnectGoogleCalendar}
                  disabled={googleCalendarBusy}
                  className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-600 text-xs font-semibold hover:bg-slate-50 disabled:opacity-60"
                >
                  Bağlantıyı Kaldır
                </button>
              </>
            ) : (
              <button
                onClick={handleConnectGoogleCalendar}
                disabled={googleCalendarBusy || googleCalendarStatus.loading}
                className="px-3 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 disabled:opacity-60"
              >
                {googleCalendarBusy ? "Bağlanıyor..." : "Google Takvim Bağla"}
              </button>
            )}
          </div>
        </div>
      )}

      {canManage && remoteError && (
        <div className="no-print rounded-lg border border-rose-200 bg-rose-50 text-rose-700 px-4 py-3 text-sm">
          {remoteError}
        </div>
      )}

      {/* Takvim Loading */}
      {remoteLoading && (
        <div className="no-print flex items-center gap-2 rounded-lg border border-sky-100 bg-sky-50 px-4 py-2.5 text-sm text-sky-700">
          <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
          </svg>
          Çizelge yükleniyor…
        </div>
      )}

      {/* Boş durum — atama verisi yok */}
      {!remoteLoading && hasFetchedOnceRef.current && !remoteError && selectedPerson && remoteAssignmentsRaw.length === 0 && (
        <div className="no-print rounded-lg border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-500">
          Bu dönem için atama verisi bulunamadı. Planlama sekmesinden{" "}
          <strong className="text-slate-700">Çizelgeden Doldur</strong> çalıştırın.
        </div>
      )}

      {/* Takvim Başlığı */}
      <div className="person-calendar-weekdays grid grid-cols-7 gap-1 text-xs font-semibold text-slate-500 px-1">
        {dayNameTR.map((name) => (
          <div key={name} className="text-center py-1">
            {name}
          </div>
        ))}
      </div>

      {/* Takvim Grid */}
      <div className="person-calendar-grid grid grid-cols-7 gap-1">
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
          const wasSwapped = swappedDates.has(dateStr);
          const wasLeaveCleared = leaveClearedDates.has(dateStr);

          return (
            <div key={`day-${dayNum}`} className="relative">
              {wasSwapped && (
                <span
                  title="Bu gün Hızlı Yerine Atama ile değiştirildi"
                  className="absolute top-1 right-1 z-10 text-[9px] bg-amber-100 text-amber-700 border border-amber-300 rounded px-1 leading-4 font-semibold pointer-events-none select-none"
                >
                  ↺
                </span>
              )}
              {wasLeaveCleared && (
                <span
                  title="Nöbet izin nedeniyle temizlendi"
                  className="absolute top-1 left-1 z-10 text-[9px] bg-rose-100 text-rose-700 border border-rose-300 rounded px-1 leading-4 font-semibold pointer-events-none select-none"
                >
                  İzin
                </span>
              )}
              <DayCard
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
                onAddLeave={canManage ? () => openLeaveModal(dayNum) : null}
                onRemoveShift={canManage ? (assg) => handleRemoveShift(assg, dayNum) : null}
                onEditShift={null}
                hasConflict={hasConflict}
                conflictLeaveCode={hasConflict ? leaveFormatted : ""}
                holiday={holiday}
              />
            </div>
          );
        })}
      </div>

      {/* Ayın Özeti */}
      {showStats && selectedPerson && (
        <div className="person-print-summary">
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
        </div>
      )}

      {/* Legend */}
      <div className="calendar-print-exclude text-xs text-slate-500 bg-white rounded-lg border border-slate-200 p-3">
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
            <select
              value={assignRoleLabel}
              onChange={(e) => setAssignRoleLabel(e.target.value)}
              className="h-9 rounded border px-3 text-sm"
            >
              {assignAreaOptions.length === 0 ? (
                <option value="">— Alan tanımlı değil —</option>
              ) : (
                <>
                  {/* Mevcut değer listede yoksa (manuel girilmiş alan) seçenek olarak koru */}
                  {assignRoleLabel &&
                    !assignAreaOptions.some(
                      (o) => o.toLocaleUpperCase("tr-TR") === assignRoleLabel.toLocaleUpperCase("tr-TR")
                    ) && (
                      <option value={assignRoleLabel}>{assignRoleLabel}</option>
                    )}
                  {assignAreaOptions.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </>
              )}
            </select>
          </label>
          {assignShiftOptions.length > 0 ? (
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
                {assignShiftOptions.map((opt) => (
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

      {/* ── Planlama Takvimi İzin Modal ── */}
      {leaveModal.open && selectedPerson && (() => {
        const conflictAssignments = assignmentsByDay.get(leaveModal.dayNum) || [];
        const hasConflict = conflictAssignments.length > 0;
        const selectedLeaveType = leaveTypeByCode.get(normalizeLeaveCode(leaveModalCode));
        const inputCls = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100";
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
            <div className="mx-4 w-full max-w-sm rounded-2xl border border-slate-200 bg-white shadow-xl">
              <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
                <h2 className="text-[15px] font-semibold text-slate-900">İzin Girişi</h2>
                <button
                  type="button"
                  onClick={closeLeaveModal}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M12 4L4 12M4 4l8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                </button>
              </div>

              <div className="px-6 py-5 space-y-4">
                {/* Context */}
                <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-600 space-y-1">
                  <div>Personel: <span className="font-semibold text-slate-800">{selectedPerson.name}</span></div>
                  <div>Tarih: <span className="font-semibold text-slate-800">{leaveModal.dateStr}</span></div>
                </div>

                {/* Conflict warning */}
                {hasConflict && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                    <div className="flex items-start gap-2 text-sm text-amber-800">
                      <svg className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" viewBox="0 0 16 16" fill="none">
                        <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5"/>
                        <path d="M8 5v3.5M8 11h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                      </svg>
                      <span>
                        <strong>Bu gün personelin nöbeti var.</strong><br />
                        {conflictAssignments.map((a) => String(a?.shiftCode || a?.roleLabel || "")).filter(Boolean).join(", ")}
                      </span>
                    </div>
                  </div>
                )}

                {/* Leave code */}
                <div>
                  <label className="block text-[12px] font-semibold text-slate-600 mb-1.5">İzin Kodu</label>
                  <select
                    value={leaveModalCode}
                    onChange={(e) => setLeaveModalCode(e.target.value)}
                    className={inputCls}
                  >
                    {leaveTypeOptions.map((type) => (
                      <option key={type.code} value={type.code}>
                        {type.name ? `${type.code} - ${type.name}` : type.code}
                      </option>
                    ))}
                  </select>
                  {selectedLeaveType?.name && (
                    <div className="mt-2 rounded-xl border border-sky-100 bg-sky-50 px-3 py-2 text-xs leading-5 text-slate-600">
                      <span className="font-semibold text-slate-800">{selectedLeaveType.code}</span>
                      <span> - {selectedLeaveType.name}</span>
                      {selectedLeaveType.description && (
                        <div className="mt-1 text-slate-500">{selectedLeaveType.description}</div>
                      )}
                    </div>
                  )}
                </div>

                {/* Note */}
                <div>
                  <label className="block text-[12px] font-semibold text-slate-600 mb-1.5">Not (isteğe bağlı)</label>
                  <input
                    type="text"
                    value={leaveModalNote}
                    onChange={(e) => setLeaveModalNote(e.target.value)}
                    placeholder="Açıklama..."
                    className={inputCls}
                  />
                </div>

                {leaveModalError && (
                  <div className="text-sm text-rose-600">{leaveModalError}</div>
                )}

                {leaveBackendConflict && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
                    <p className="font-medium text-amber-800 mb-1">Bu tarihte aktif nöbet mevcut</p>
                    <p className="text-amber-700 text-xs mb-2">{leaveBackendConflict.detail}</p>
                    <button
                      type="button"
                      onClick={() => handleConfirmLeave(false, { force: true })}
                      disabled={leaveModalSaving}
                      className="w-full rounded-lg bg-amber-600 px-3 py-2 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-60 transition-colors"
                    >
                      {leaveModalSaving ? "Kaydediliyor…" : "Nöbeti Yoksay ve İzni Kaydet"}
                    </button>
                  </div>
                )}

                {/* Actions */}
                {hasConflict ? (
                  <div className="space-y-2 pt-1">
                    <button
                      type="button"
                      onClick={() => handleConfirmLeave(false)}
                      disabled={leaveModalSaving}
                      className="w-full rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60 transition-colors"
                    >
                      {leaveModalSaving ? "Kaydediliyor…" : "Sadece İzin Kaydet"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleConfirmLeave(true)}
                      disabled={leaveModalSaving}
                      className="w-full rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-60 transition-colors"
                    >
                      {leaveModalSaving ? "İşleniyor…" : "İzin Kaydet ve Nöbeti Boşalt"}
                    </button>
                    <button
                      type="button"
                      onClick={closeLeaveModal}
                      disabled={leaveModalSaving}
                      className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 transition-colors"
                    >
                      İptal
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={closeLeaveModal}
                      className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Vazgeç
                    </button>
                    <button
                      type="button"
                      onClick={() => handleConfirmLeave(false)}
                      disabled={leaveModalSaving}
                      className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
                    >
                      {leaveModalSaving ? "Kaydediliyor…" : "Kaydet"}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      <OverrideDialog
        open={overrideDialog.open}
        errors={overrideDialog.errors}
        onConfirm={handleOverrideConfirm}
        onCancel={() => setOverrideDialog({ open: false, errors: [], pending: null })}
      />

      <QuickReplacePanel
        open={quickReplaceOpen}
        onClose={() => {
          setQuickReplaceOpen(false);
          setQuickReplaceSelection(null);
        }}
        sectionId={sectionId}
        serviceId={effectiveServiceId}
        scheduleRole={scheduleRole}
        year={year}
        month={month0 + 1}
        onAssigned={async () => {
          const dateToMark = quickReplaceSelection?.date;
          await refreshRemote();
          if (dateToMark) {
            setSwappedDates((prev) => new Set([...prev, dateToMark]));
          }
        }}
        initialSelection={quickReplaceSelection}
        preferredPerson={selectedPerson ? { id: selectedPerson.id, name: selectedPerson.name } : null}
        preferredAssignments={displaySummaryAssignments}
      />
    </div>

    {/* ─── BASKIYA ÖZEL: A4 Yatay — Ekranla birebir takvim ızgarası ─── */}
    <style>{`
      @media screen { .person-print-layout { display: none !important; } }
      @media print {
        @page { size: A4 landscape; margin: 6mm 8mm; }
        html, body { background: #fff !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .person-screen-only { display: none !important; }
        .person-print-layout {
          display: block !important; width: 100%;
          font-family: 'Inter', 'Helvetica Neue', Helvetica, Arial, sans-serif;
          color: #0f172a;
        }
        /* ── Başlık ── */
        .ppl-header {
          display: flex; align-items: flex-start; justify-content: space-between;
          padding-bottom: 2.5mm; margin-bottom: 2.5mm; border-bottom: 1.5px solid #e2e8f0;
        }
        .ppl-header-donem { font-size: 7pt; color: #94a3b8; font-weight: 500; margin-bottom: 0.5mm; letter-spacing: 0.04em; }
        .ppl-header-month { font-size: 13pt; font-weight: 800; color: #0f172a; line-height: 1.1; }
        .ppl-header-right { text-align: right; }
        .ppl-header-plbl { font-size: 7pt; color: #94a3b8; font-weight: 500; margin-bottom: 0.5mm; letter-spacing: 0.04em; }
        .ppl-header-pname { font-size: 12pt; font-weight: 800; color: #0f172a; letter-spacing: 0.01em; }
        /* ── Haftanın Günleri Başlık ── */
        .ppl-weekdays {
          display: grid; grid-template-columns: repeat(7, 1fr); margin-bottom: 0;
        }
        .ppl-weekday {
          text-align: center; font-size: 7.5pt; font-weight: 700; color: #475569;
          padding: 1.5mm 0; border-bottom: 1.5px solid #334155; letter-spacing: 0.05em;
        }
        .ppl-weekday.wknd { color: #94a3b8; }
        /* ── Takvim Izgarası ── */
        .ppl-grid {
          display: grid; grid-template-columns: repeat(7, 1fr);
          border-top: 1px solid #e2e8f0; border-left: 1px solid #e2e8f0;
          margin-bottom: 2.5mm;
        }
        .ppl-cell {
          border-right: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0;
          min-height: 22mm; padding: 1.5mm 1.5mm 1mm;
          background: #fff; position: relative;
        }
        .ppl-cell.outside  { background: #f8fafc; }
        .ppl-cell.is-wknd  { background: #f8fafc; }
        .ppl-cell.is-hol   { background: #fff7ed; }
        .ppl-cell.has-assg { background: #f0f9ff; }
        .ppl-cell.has-leave { background: #fff1f2; }
        .ppl-cell.has-conflict { background: #fffbeb; }
        /* ── Hücre üst satır: gün no + arife/tatil rozet ── */
        .ppl-cell-top {
          display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 0.5mm;
        }
        .ppl-cell-dayinfo { display: flex; align-items: baseline; gap: 1mm; }
        .ppl-cell-num { font-size: 8.5pt; font-weight: 700; color: #1e293b; line-height: 1; }
        .ppl-cell.outside .ppl-cell-num { color: #cbd5e1; }
        .ppl-cell.is-wknd .ppl-cell-num { color: #94a3b8; }
        .ppl-cell.is-hol .ppl-cell-num  { color: #c2410c; }
        .ppl-cell-day { font-size: 5.5pt; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; }
        /* TATİL / ARİFE rozet */
        .ppl-hbadge {
          font-size: 4.5pt; font-weight: 800; letter-spacing: 0.06em;
          padding: 0.3mm 1.5mm; border-radius: 8px;
          background: #fed7aa; color: #c2410c; white-space: nowrap;
        }
        .ppl-hbadge.arife { background: #fef08a; color: #92400e; }
        /* Tatil adı */
        .ppl-hname {
          font-size: 5pt; color: #c2410c; font-weight: 500;
          line-height: 1.3; margin-bottom: 0.8mm;
          overflow: hidden; display: -webkit-box;
          -webkit-line-clamp: 2; -webkit-box-orient: vertical;
        }
        /* ── Nöbet pill (mavi) ── */
        .ppl-shift-pill {
          display: flex; align-items: center; gap: 1.5mm;
          background: #eff6ff; border: 0.5px solid #bfdbfe;
          border-radius: 1.5mm; padding: 0.7mm 1.5mm; margin-top: 1mm;
        }
        .ppl-shift-code { font-size: 8pt; font-weight: 800; color: #1d4ed8; letter-spacing: 0.02em; }
        .ppl-shift-role { font-size: 5.5pt; color: #3b82f6; font-weight: 600; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; max-width: 26mm; }
        /* ── İzin kodu ── */
        .ppl-leave-val { font-size: 10pt; font-weight: 800; color: #be123c; line-height: 1; margin-top: 2mm; display: block; }
        /* ── Çakışma nokta ── */
        .ppl-conflict-dot { position: absolute; top: 1.5mm; right: 1.5mm; width: 2.5mm; height: 2.5mm; border-radius: 50%; background: #f59e0b; }
        /* ── Özet Bölümü ── */
        .ppl-summary-wrap {
          border: 1px solid #e2e8f0; border-radius: 2mm; padding: 2mm 0;
          background: #f8fafc; margin-bottom: 2mm;
        }
        .ppl-summary-row { display: flex; justify-content: space-around; align-items: flex-start; }
        .ppl-summary-item { text-align: left; padding: 0 3mm; }
        .ppl-summary-lbl { font-size: 6pt; color: #64748b; margin-bottom: 0.5mm; letter-spacing: 0.03em; }
        .ppl-summary-val { font-size: 14pt; font-weight: 800; color: #0f172a; line-height: 1.1; }
        .ppl-summary-val .unit { font-size: 7pt; font-weight: 500; color: #94a3b8; }
        .ppl-summary-val.pos { color: #0f766e; }
        .ppl-summary-val.neg { color: #be123c; }
        /* ── Görev/Alan Dağılımı ── */
        .ppl-areas {
          display: flex; flex-wrap: wrap; gap: 1mm 4mm; align-items: center;
          border: 1px solid #e2e8f0; border-radius: 2mm; padding: 1.5mm 3mm;
          background: #f8fafc; margin-bottom: 2mm;
        }
        .ppl-areas-title { font-size: 6pt; font-weight: 700; color: #475569; margin-right: 2mm; }
        .ppl-area-item { font-size: 6.5pt; color: #1e293b; }
        .ppl-area-item b { color: #0369a1; }
        /* ── Legend ── */
        .ppl-legend { display: flex; gap: 3.5mm; flex-wrap: wrap; margin-bottom: 1.5mm; }
        .ppl-legend-item { display: flex; align-items: center; gap: 1mm; font-size: 5.5pt; color: #64748b; }
        .ppl-legend-dot { width: 2.5mm; height: 2.5mm; border-radius: 0.5mm; flex-shrink: 0; border: 0.5px solid #e2e8f0; }
        /* ── Altbilgi ── */
        .ppl-footer { display: flex; justify-content: space-between; font-size: 6pt; color: #94a3b8; }
      }
    `}</style>

    <div className="person-print-layout" aria-hidden="true">
      {/* Başlık */}
      <div className="ppl-header">
        <div>
          <div className="ppl-header-donem">Dönem</div>
          <div className="ppl-header-month">{monthLabel}</div>
        </div>
        <div className="ppl-header-right">
          <div className="ppl-header-plbl">Personel</div>
          <div className="ppl-header-pname">{selectedPerson?.name || '—'}</div>
        </div>
      </div>

      {/* Haftanın Günleri */}
      <div className="ppl-weekdays">
        {['Pzt','Sal','Çar','Per','Cum','Cmt','Paz'].map((d, i) => (
          <div key={d} className={`ppl-weekday${i >= 5 ? ' wknd' : ''}`}>{d}</div>
        ))}
      </div>

      {/* Takvim Izgarası */}
      <div className="ppl-grid">
        {(() => {
          const WD_ABR = ['Paz','Pzt','Sal','Çar','Per','Cum','Cmt'];
          return displayCells.map(({ date: dt, inMonth }, idx) => {
            if (!inMonth) {
              const outsideNum = dt.getDate();
              const outsideWd  = dt.getDay();
              return (
                <div key={`out-${idx}`} className={`ppl-cell outside${outsideWd === 0 || outsideWd === 6 ? ' is-wknd' : ''}`}>
                  <div className="ppl-cell-top">
                    <div className="ppl-cell-dayinfo">
                      <span className="ppl-cell-num">{outsideNum}</span>
                      <span className="ppl-cell-day">{WD_ABR[outsideWd]}</span>
                    </div>
                  </div>
                </div>
              );
            }

            const dayNum  = dt.getDate();
            const wd      = dt.getDay();
            const dateStr = `${year}-${pad2(month0 + 1)}-${pad2(dayNum)}`;
            const cellAssignments = assignmentsByDay.get(dayNum) || [];
            const leaveRaw   = leavesForPerson[String(dayNum)] || leavesForPerson[dateStr];
            const leaveCode  = leaveRaw ? formatLeaveValue(leaveRaw) : '';
            const holiday    = holidayMap[dateStr] || null;
            const isWknd     = wd === 0 || wd === 6;
            const hasAssg    = cellAssignments.length > 0;
            const hasConflict = hasAssg && !!leaveCode;
            const holidayKind = String(holiday?.kind || '').toLowerCase();
            const isArife    = holidayKind === 'arife' || holidayKind === 'half';

            let cls = 'ppl-cell';
            if (isWknd) cls += ' is-wknd';
            if (holiday) cls += ' is-hol';
            if (hasConflict) cls += ' has-conflict';
            else if (hasAssg) cls += ' has-assg';
            else if (leaveCode) cls += ' has-leave';

            return (
              <div key={dateStr} className={cls}>
                {hasConflict && <div className="ppl-conflict-dot" />}
                <div className="ppl-cell-top">
                  <div className="ppl-cell-dayinfo">
                    <span className="ppl-cell-num">{dayNum}</span>
                    <span className="ppl-cell-day">{WD_ABR[wd]}</span>
                  </div>
                  {holiday && (
                    <span className={`ppl-hbadge${isArife ? ' arife' : ''}`}>
                      {isArife ? 'ARİFE' : 'TATİL'}
                    </span>
                  )}
                </div>
                {holiday && <div className="ppl-hname">{holiday.name}</div>}
                {leaveCode && <span className="ppl-leave-val">{leaveCode}</span>}
                {cellAssignments.map((a, ai) => {
                  const tok  = displayShiftToken(a);
                  const role = String(a?.roleLabel || a?.rowLabel || '').trim();
                  const showR = role && role !== tok;
                  return (
                    <div key={ai} className="ppl-shift-pill">
                      <span className="ppl-shift-code">{tok || 'NÖBET'}</span>
                      {showR && <span className="ppl-shift-role">{role}</span>}
                    </div>
                  );
                })}
              </div>
            );
          });
        })()}
      </div>

      {/* Özet */}
      {selectedPerson && (() => {
        const totalShifts = [...assignmentsByDay.values()].reduce((s, a) => s + a.length, 0);
        const stats = [
          { lbl: 'Toplam Nöbet',     val: String(totalShifts), unit: '',  cls: '' },
          { lbl: 'Aylık Gereken',    val: overtimeStats?.requiredBase  != null ? String(overtimeStats.requiredBase)  : '—', unit: 's', cls: '' },
          { lbl: 'İzin',             val: overtimeStats?.leaveCredit   != null ? String(overtimeStats.leaveCredit)   : '—', unit: 's', cls: '' },
          { lbl: 'Kişinin Gerekeni', val: overtimeStats?.requiredFinal != null ? String(overtimeStats.requiredFinal) : '—', unit: 's', cls: '' },
          { lbl: 'Çalıştığı Toplam', val: overtimeStats?.worked        != null ? String(overtimeStats.worked)        : '—', unit: 's', cls: '' },
          {
            lbl: 'Fazla Mesai',
            val: overtimeStats?.overtime != null ? `${overtimeStats.overtime >= 0 ? '+' : ''}${overtimeStats.overtime}` : '—',
            unit: overtimeStats?.overtime != null ? 's' : '',
            cls: overtimeStats?.overtime != null ? (overtimeStats.overtime >= 0 ? ' pos' : ' neg') : '',
          },
        ];
        return (
          <div className="ppl-summary-wrap">
            <div className="ppl-summary-row">
              {stats.map(({ lbl, val, unit, cls }) => (
                <div key={lbl} className="ppl-summary-item">
                  <div className="ppl-summary-lbl">{lbl}</div>
                  <div className={`ppl-summary-val${cls}`}>
                    {val}{unit && <span className="unit"> {unit}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Görev/Alan Dağılımı */}
      {(() => {
        const amap = {};
        for (const list of assignmentsByDay.values()) {
          for (const a of list) {
            const k = String(a?.roleLabel || a?.rowLabel || a?.shiftCode || '?').trim();
            if (!amap[k]) amap[k] = { count: 0, hours: 0 };
            amap[k].count++;
            amap[k].hours += Number(a?.hours || 0);
          }
        }
        const entries = Object.entries(amap).sort((a, b) => b[1].count - a[1].count);
        if (!entries.length) return null;
        return (
          <div className="ppl-areas">
            <span className="ppl-areas-title">Görev/Alan Dağılımı</span>
            {entries.map(([area, { count, hours }]) => (
              <span key={area} className="ppl-area-item">
                <b>{area}</b> ({count} nöbet{hours > 0 ? `, ${hours}s` : ''})
              </span>
            ))}
          </div>
        );
      })()}

      {/* Legend */}
      <div className="ppl-legend">
        {[
          { bg: '#fff1f2', border: '#fecdd3', lbl: 'İzin kayıtları (Toplu İzin Listesi)' },
          { bg: '#eff6ff', border: '#bfdbfe', lbl: 'Nöbet atamaları (son plan / içe aktarılan görevler)' },
          { bg: '#fffbeb', border: '#fde68a', lbl: 'İzin + Vardiya çakışması (aynı günde her ikisi de mevcut)' },
          { bg: '#fff7ed', border: '#fed7aa', lbl: 'Resmi tatil (Türkiye)' },
        ].map(({ bg, border, lbl }) => (
          <div key={lbl} className="ppl-legend-item">
            <div className="ppl-legend-dot" style={{ background: bg, borderColor: border }} />
            {lbl}
          </div>
        ))}
      </div>

      <div className="ppl-footer">
        <span>Hastane Nöbet Sistemi — Otomatik oluşturuldu</span>
        <span>{new Date().toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric' })}</span>
      </div>
    </div>
    </>
  );
});

export default PersonScheduleCalendar;
