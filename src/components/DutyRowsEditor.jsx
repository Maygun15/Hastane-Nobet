// src/components/DutyRowsEditor.jsx
import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from "react";
import * as XLSX from "xlsx";
import { ArrowUp, ArrowDown, Trash2, Copy, Settings } from "lucide-react";
import { LS } from "../utils/storage.js";
import { generateRoster, STAFF_KEY } from "../engine/rosterEngine.js";
import { generateAutoSchedule } from "../engine/autoPlanner.js";
import SupervisorSetup from "./SupervisorSetup.jsx";
import PinningModal from "./PinningModal.jsx";
import JusticeAnalyzerModal from "./JusticeAnalyzerModal.jsx";

import useCrudModel from "../hooks/useCrudModel.js";
import { parseAssignmentsFile } from "../lib/importExcel.js";
import { getPeople, getAreas, getShifts, buildPeopleFromLeaves } from "../lib/dataResolver.js";
import {
  getAllLeaves,
  leavesToUnavailable as leavesToUnavailableByPid,
  buildNameUnavailability,
  loadLeavesFromBackend,
} from "../lib/leaves.js";
import {
  getMonthlySchedule,
  getGeneratedSchedule,
  saveMonthlySchedule,
  generateSchedulerPlan,
  fetchPersonnel,
  validateBatchSchedule,
} from "../api/apiAdapter.js";
import { namedToAssignments, assignmentsToNamed } from "../utils/scheduleAdapter.js";
import { createPlanWorkHourResolver } from "../utils/planWorkCalculator.js";
import { runPlannerOnce } from "../lib/runPlannerOnce.js";
import OverrideDialog from "./OverrideDialog.jsx";
import { toast } from "sonner";

/* ===== Toaster (opsiyonel) ===== */
let toastSafe = toast;

/* ======================= yardımcılar ======================= */
const WD_TR = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];
const HEAD_TR = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];
const MONTHS_TR = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const DUTY_RULES_LS_KEY = "dutyRulesV2";
const norm = (s) => (s || "").toString().trim().toLocaleUpperCase("tr-TR");
const stripDiacritics = (str) =>
  (str || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/Ğ/g, "G").replace(/Ü/g, "U").replace(/Ş/g, "S").replace(/İ/g, "I")
    .replace(/Ö/g, "O").replace(/Ç/g, "C")
    .replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ş/g, "s").replace(/ı/g, "i")
    .replace(/ö/g, "o").replace(/ç/g, "c");
const canonName = (s) => stripDiacritics(norm(s)).replace(/\s+/g, " ").trim();
const isPlainLowercaseName = (s = "") => {
  const raw = String(s || "").trim();
  if (!raw) return false;
  const letters = stripDiacritics(raw).replace(/[^A-Za-z]/g, "");
  if (!letters) return false;
  return letters === letters.toLowerCase() && letters !== letters.toUpperCase();
};
const choosePreferredDisplayName = (current, candidate) => {
  if (!current) return candidate;
  if (!candidate) return current;
  if (isPlainLowercaseName(current) && !isPlainLowercaseName(candidate)) return candidate;
  return current;
};
const mergeDisplayNameLists = (base = [], addon = []) => {
  const merged = new Map();
  const pushName = (nm) => {
    if (!nm || isGroupLabel(nm)) return;
    const canon = canonName(nm);
    if (!canon) return;
    const chosen = choosePreferredDisplayName(merged.get(canon), String(nm).trim());
    merged.set(canon, chosen);
  };
  (Array.isArray(base) ? base : []).forEach(pushName);
  (Array.isArray(addon) ? addon : []).forEach(pushName);
  return Array.from(merged.values());
};
const keepSingleAssignee = (names = []) => {
  const merged = mergeDisplayNameLists([], names);
  return merged.length ? [merged[0]] : [];
};
const normalizeRosterNamedAssignments = (namedAssignments) => {
  const source = namedAssignments && typeof namedAssignments === "object" ? namedAssignments : {};
  const normalized = {};
  Object.entries(source).forEach(([dayKey, byRow]) => {
    if (!byRow || typeof byRow !== "object") return;
    normalized[dayKey] = {};
    Object.entries(byRow).forEach(([rowId, list]) => {
      normalized[dayKey][rowId] = keepSingleAssignee(list);
    });
  });
  return normalized;
};
const normalizeRosterData = (roster) => {
  if (!roster || typeof roster !== "object") return roster || null;
  return {
    ...roster,
    namedAssignments: normalizeRosterNamedAssignments(roster.namedAssignments),
  };
};
const rosterCellKey = (rowId, day) => `${String(rowId || "").trim()}::${Number(day) || 0}`;
const firstRosterName = (roster, day, rowId) => {
  const list = roster?.namedAssignments?.[day]?.[rowId];
  return keepSingleAssignee(Array.isArray(list) ? list : [])[0] || "";
};
const buildRosterDiffMeta = ({ currentRoster, baselineRoster, rows = [], daysInMonth = 31 }) => {
  const cellMap = new Map();
  const changedRows = new Set();
  let count = 0;

  if (!baselineRoster?.namedAssignments || !currentRoster?.namedAssignments) {
    return { count: 0, cellMap, changedRows: [], sample: [] };
  }

  for (const row of Array.isArray(rows) ? rows : []) {
    const rowId = String(row?.id || "").trim();
    if (!rowId) continue;
    for (let day = 1; day <= daysInMonth; day += 1) {
      const before = String(firstRosterName(baselineRoster, day, rowId) || "").trim();
      const after = String(firstRosterName(currentRoster, day, rowId) || "").trim();
      if (canonName(before) === canonName(after)) continue;
      count += 1;
      changedRows.add(rowId);
      cellMap.set(rosterCellKey(rowId, day), {
        before,
        after,
        day,
        rowId,
        rowLabel: String(row?.label || rowId),
      });
    }
  }

  const sample = Array.from(cellMap.values()).slice(0, 5);
  return { count, cellMap, changedRows: Array.from(changedRows.values()), sample };
};
const monIndex = (wdSun0) => (wdSun0 + 6) % 7;
const pad2 = (n) => String(n).padStart(2, "0");
function normalizeMonthAnyBase(value, { preferOneBased } = { preferOneBased: true }) {
  const n = Number(value);
  if (!Number.isFinite(n)) return new Date().getMonth();
  const norm = Math.trunc(n);
  if (preferOneBased) {
    if (norm >= 1 && norm <= 12) return norm - 1;
    if (norm >= 0 && norm <= 11) return norm;
  } else {
    if (norm >= 0 && norm <= 11) return norm;
    if (norm >= 1 && norm <= 12) return norm - 1;
  }
  return ((norm % 12) + 12) % 12;
}
const isWeekendCol = (i) => i === 5 || i === 6;
const isGroupLabel = (nm) =>
  !!nm &&
  /^(hemşire(ler)?|hemsire(ler)?|doktor(lar)?|personel|nurses?|doctors?)$/i.test(
    String(nm).trim()
  );
const compactRosterDisplayName = (name) => {
  const raw = String(name || "").trim();
  if (!raw) return "";
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return raw;
  const first = parts[0];
  const last = parts[parts.length - 1];
  const compact = `${first} ${last.charAt(0)}.`;
  return compact.length < raw.length ? compact : raw;
};
const clampSingleSlotCount = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return 1;
};
const formatDateTime = (iso) => {
  if (!iso) return null;
  const dt = new Date(iso);
  return Number.isNaN(dt.getTime()) ? null : dt.toLocaleString("tr-TR");
};
function normalizeDutyDefsAndOverrides(defs = [], overrides = {}) {
  const nextDefs = [];
  const nextOverrides = {};
  for (const row of Array.isArray(defs) ? defs : []) {
    const rowId = String(row?.id ?? row?.rowId ?? "").trim();
    const normalizedPattern = Array.isArray(row?.pattern)
      ? row.pattern.map((value) => clampSingleSlotCount(value))
      : Array(7).fill(clampSingleSlotCount(row?.defaultCount || 0));
    const normalizedDefaultCount = clampSingleSlotCount(row?.defaultCount || 0);
    const normalizedRow = {
      ...row,
      defaultCount: normalizedDefaultCount,
      pattern: normalizedPattern,
    };
    nextDefs.push(normalizedRow);
    if (!rowId) continue;
    const source = overrides?.[rowId] || {};
    const normalizedDays = {};
    for (const [day, value] of Object.entries(source)) {
      normalizedDays[day] = clampSingleSlotCount(value);
    }
    if (Object.keys(normalizedDays).length) {
      nextOverrides[rowId] = normalizedDays;
    }
  }

  return { defs: nextDefs, overrides: nextOverrides };
}

function mapRulesToBackend(list) {
  const arr = Array.isArray(list) ? list : [];
  const findById = (id) => arr.find((r) => r?.id === id);
  const findAny = (ids) => ids.map(findById).find(Boolean);
  const findEnabled = (ids) => ids.map(findById).find((r) => r && r.enabled);

  const boolRule = (ids) => {
    const any = findAny(ids);
    if (!any) return undefined;
    const enabled = !!findEnabled(ids);
    return enabled;
  };
  const numRule = (ids, fallback) => {
    const any = findAny(ids);
    if (!any) return undefined;
    const r = findEnabled(ids);
    if (!r) return 0;
    const n = Number(r.value);
    return Number.isFinite(n) ? n : fallback;
  };

  const out = {};
  const v1 = boolRule(["ONE_SHIFT_PER_DAY", "NO_MULTIPLE_ASSIGNMENTS_PER_DAY"]);
  if (v1 !== undefined) out.ONE_SHIFT_PER_DAY = v1;

  const v2 = boolRule(["LEAVE_BLOCK_GENERIC"]);
  if (v2 !== undefined) out.LEAVE_BLOCK = v2;

  const v3 = numRule(["MAX_CONSECUTIVE_6D"], 6);
  if (v3 !== undefined) out.MAX_CONSECUTIVE_DAYS = v3;

  const v4 = numRule(["MIN_GAP_12H", "MIN_REST_11H"], 11);
  if (v4 !== undefined) out.MIN_REST_HOURS = v4;

  const v5 = boolRule(["NIGHT_NEXT_DAY_OFF"]);
  if (v5 !== undefined) out.NIGHT_NEXT_DAY_OFF = v5;

  const v6 = numRule(["WEEKLY_MAX_SHIFTS", "WEEKLY_MAX_DUTIES", "WEEKLY_MAX_SHIFTS_PER_PERSON"], 0);
  if (v6 !== undefined) out.MAX_SHIFTS_PER_WEEK = v6;

  const v7 = numRule(["MAX_TASK_PER_PERSON", "MAX_SAME_TASK_PER_PERSON"], 0);
  if (v7 !== undefined) out.MAX_TASK_PER_PERSON = v7;

  return out;
}

function readDutyRulesFromLS() {
  try {
    const raw = JSON.parse(localStorage.getItem(DUTY_RULES_LS_KEY) || "[]");
    const out = mapRulesToBackend(raw);
    // ONE_SHIFT_PER_DAY kapalı gelirse backend defaultuna bırak
    if (out?.ONE_SHIFT_PER_DAY === false) delete out.ONE_SHIFT_PER_DAY;
    return out;
  } catch {
    return {};
  }
}

function buildLeavesByPersonForMonth(year, month1, people = []) {
  const all = getAllLeaves();
  const ym = `${year}-${pad2(month1)}`;
  const out = {};
  const ensure = (pid) => {
    const key = String(pid);
    out[key] ??= new Set();
    return out[key];
  };
  const addDay = (pid, dayNum) => {
    if (!pid) return;
    const d = Number(dayNum);
    if (!Number.isFinite(d) || d < 1 || d > 31) return;
    ensure(pid).add(`${year}-${pad2(month1)}-${pad2(d)}`);
  };
  for (const [pid, byYm] of Object.entries(all || {})) {
    const bucket = byYm?.[ym];
    if (!bucket) continue;
    for (const dKey of Object.keys(bucket || {})) {
      addDay(pid, dKey);
    }
  }

  if (Array.isArray(people) && people.length) {
    const nameMap = buildNameUnavailability(people, year, month1);
    for (const p of people) {
      const pid = String(p?.id ?? "");
      if (!pid) continue;
      const canon = canonName(p?.name || p?.fullName || "");
      if (!canon) continue;
      const days = nameMap.get(canon);
      if (!days || !days.size) continue;
      for (const d of days) addDay(pid, d);
    }
  }

  const normalized = {};
  for (const [pid, set] of Object.entries(out)) {
    const arr = Array.from(set.values());
    if (arr.length) normalized[pid] = arr;
  }
  return normalized;
}

function buildWeekGrid(y, m0) {
  const daysInMonth = new Date(y, m0 + 1, 0).getDate();
  const dowSun0 = new Date(y, m0, 1).getDay();
  const dowMon0 = monIndex(dowSun0);
  const weeks = Math.ceil((dowMon0 + daysInMonth) / 7);
  const matrix = Array.from({ length: weeks }, () => Array(7).fill(null));
  let d = 1;
  for (let w = 0; w < weeks; w++) {
    for (let i = 0; i < 7; i++) {
      const idx = w * 7 + i;
      if (idx >= dowMon0 && d <= daysInMonth) matrix[w][i] = d++;
    }
  }
  return { weeks, matrix, daysInMonth };
}

function dayFromAny(dateLike, year, month0) {
  if (dateLike == null || dateLike === "") return null;

  if (typeof dateLike === "number" && Number.isFinite(dateLike)) {
    const excelEpoch = new Date(1899, 11, 30);
    const dt = new Date(excelEpoch.getTime() + dateLike * 86400000);
    if (!Number.isNaN(dt.getTime()) && dt.getFullYear() === year && dt.getMonth() === month0) {
      return dt.getDate();
    }
  }
  const s = String(dateLike).trim();
  const d1 = new Date(s);
  if (!Number.isNaN(d1.getTime()) && d1.getFullYear() === year && d1.getMonth() === month0) {
    return d1.getDate();
  }
  const m = s.match(/^(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{2,4})$/);
  if (m) {
    const dd = +m[1];
    const MM = +m[2] - 1;
    let yyyy = +m[3];
    if (yyyy < 100) yyyy += 2000;
    if (yyyy === year && MM === month0) return dd;
  }
  const m2 = s.match(/^(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})$/);
  if (m2) {
    const yyyy = +m2[1],
      MM = +m2[2] - 1,
      dd = +m2[3];
    if (yyyy === year && MM === month0) return dd;
  }
  return null;
}

function buildUnavailableByDay(year, month0) {
  try {
    const all = getAllLeaves();
    const byPid = leavesToUnavailableByPid(all, year, month0 + 1);
    const idNameMap = buildIdToNameMap();
    const out = {};
    for (const [pid, daysObj] of Object.entries(byPid || {})) {
      const canon = idNameMap.has(pid) ? canonName(idNameMap.get(pid)) : null;
      for (const dStr of Object.keys(daysObj || {})) {
        const d = Number(dStr);
        if (!Number.isFinite(d) || d < 1) continue;
        const bucket = (out[d] ??= { ids: new Set(), canon: new Set() });
        bucket.ids.add(String(pid));
        if (canon) bucket.canon.add(canon);
      }
    }
    return out;
  } catch (e) {
    console.warn("buildUnavailableByDay error:", e);
    return {};
  }
}

function pickDefaultShiftCode(area, shifts) {
  return (
    area?.defaultShift ||
    (shifts || []).find((s) => s.code === "M")?.code ||
    (shifts || [])[0]?.code ||
    "M"
  );
}

function createEmptyExplainability() {
  return {
    generatedId: null,
    sourceScheduleId: null,
    generatedCreatedAt: null,
    generatedUpdatedAt: null,
    monthlyWriteBack: null,
    candidateAudit: [],
    shadowAudit: null,
    selectedPolicyBreakdowns: [],
    isStale: false,
    staleReasons: [],
  };
}

const ISSUE_REASON_LABELS = {
  SERVICE_MATCH: "servis uyumsuz",
  ROLE_ELIGIBILITY: "rol uygun değil",
  SECTION_ELIGIBILITY: "birim uygun değil",
  ACTIVE_REQUIRED: "aktif personel değil",
  REST_AFTER_NIGHT: "gece sonrası dinlenme",
  MAX_WEEKLY_SHIFTS: "haftalık limit",
  MAX_CONSECUTIVE_DAYS: "ardışık gün limiti",
  ONE_SHIFT_PER_DAY: "aynı gün tek vardiya",
  LEAVE_BLOCK: "izin çakışması",
};

function formatIssueReason(code) {
  const normalized = String(code || "").trim().toUpperCase();
  return ISSUE_REASON_LABELS[normalized] || normalized || null;
}

function summarizeIssueAudit(audits = []) {
  if (!Array.isArray(audits) || !audits.length) return null;

  const blockers = new Map();
  let inputStaffCount = 0;
  let candidateBuilderEligibleCount = 0;
  let postConstraintCount = 0;

  const addBlockers = (src) => {
    Object.entries(src || {}).forEach(([code, count]) => {
      const normalized = String(code || "").trim().toUpperCase();
      if (!normalized) return;
      blockers.set(normalized, Number(blockers.get(normalized) || 0) + (Number(count || 0) || 0));
    });
  };

  audits.forEach((audit) => {
    inputStaffCount = Math.max(inputStaffCount, Number(audit?.inputStaffCount || 0));
    candidateBuilderEligibleCount = Math.max(
      candidateBuilderEligibleCount,
      Number((audit?.candidateBuilderEligibleCount ?? audit?.eligibleCount) || 0)
    );
    postConstraintCount = Math.max(postConstraintCount, Number(audit?.postConstraintCount || 0));
    addBlockers(audit?.hardFilteredBlockingRules);
    addBlockers(audit?.runtimeGuardBlockingRules);

    (Array.isArray(audit?.rejected) ? audit.rejected : []).forEach((item) => {
      (Array.isArray(item?.failedRuleCodes) ? item.failedRuleCodes : []).forEach((code) => {
        const normalized = String(code || "").trim().toUpperCase();
        if (!normalized) return;
        blockers.set(normalized, Number(blockers.get(normalized) || 0) + 1);
      });
      (Array.isArray(item?.reasonCodes) ? item.reasonCodes : []).forEach((code) => {
        const normalized = String(code || "")
          .trim()
          .toUpperCase()
          .replace(/_EXCEEDED$/, "");
        if (!normalized) return;
        blockers.set(normalized, Number(blockers.get(normalized) || 0) + 1);
      });
    });
  });

  const topBlockers = Array.from(blockers.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([code, count]) => `${formatIssueReason(code)} x${count}`);

  const pipeline = `havuz ${inputStaffCount} -> builder ${candidateBuilderEligibleCount} -> runtime ${postConstraintCount}`;
  return topBlockers.length ? `${pipeline}; engeller: ${topBlockers.join(", ")}` : pipeline;
}

function summarizeIssueDiagnostic(diagnostic = null) {
  if (!diagnostic || typeof diagnostic !== "object") return null;
  const inputStaffCount = Number(diagnostic?.inputStaffCount || 0);
  const candidateBuilderEligibleCount = Number(diagnostic?.candidateBuilderEligibleCount || 0);
  const postConstraintCount = Number(diagnostic?.postConstraintCount || 0);
  const topBlockers = Array.isArray(diagnostic?.topBlockers)
    ? diagnostic.topBlockers
        .map((item) => {
          const label = formatIssueReason(item?.code);
          const count = Number(item?.count || 0);
          return label && count > 0 ? `${label} x${count}` : null;
        })
        .filter(Boolean)
        .slice(0, 3)
    : [];
  const pipeline = `havuz ${inputStaffCount} -> builder ${candidateBuilderEligibleCount} -> runtime ${postConstraintCount}`;
  return topBlockers.length ? `${pipeline}; engeller: ${topBlockers.join(", ")}` : pipeline;
}

function extractGeneratedExplainability(scheduleDoc) {
  const data = scheduleDoc?.data && typeof scheduleDoc.data === "object" ? scheduleDoc.data : {};
  const candidateAudit = Array.isArray(data.candidateAudit) ? data.candidateAudit : [];
  const shadowAudit = data.shadowAudit && typeof data.shadowAudit === "object" ? data.shadowAudit : null;
  const selectedPolicyBreakdowns = candidateAudit
    .map((entry) => ({
      selectedCandidateId: entry?.selectedCandidateId || null,
      selectionReason: entry?.selectionReason || null,
      breakdown: Array.isArray(entry?.selectedPolicyBreakdown) ? entry.selectedPolicyBreakdown : [],
    }))
    .filter((entry) => entry.breakdown.length > 0);

  return {
    generatedId: scheduleDoc?.id || (scheduleDoc?._id ? String(scheduleDoc._id) : null),
    sourceScheduleId: scheduleDoc?.sourceScheduleId ? String(scheduleDoc.sourceScheduleId) : null,
    generatedCreatedAt: scheduleDoc?.createdAt || null,
    generatedUpdatedAt: scheduleDoc?.updatedAt || null,
    monthlyWriteBack:
      data?.debug?.monthlyWriteBack && typeof data.debug.monthlyWriteBack === "object"
        ? data.debug.monthlyWriteBack
        : null,
    candidateAudit,
    shadowAudit,
    selectedPolicyBreakdowns,
    isStale: false,
    staleReasons: [],
  };
}

function parseTimestamp(value) {
  if (!value) return null;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : null;
}

function getExplainabilityStaleReasons({
  explainability = null,
  monthlyReadModel = null,
  autoSaveStatus = "idle",
} = {}) {
  const reasons = [];
  if (!explainability?.generatedId) return reasons;

  if (explainability?.monthlyWriteBack?.ok === false) {
    reasons.push("MONTHLY_WRITE_BACK_FAILED");
  }

  const monthlyScheduleId = monthlyReadModel?.scheduleId ? String(monthlyReadModel.scheduleId) : null;
  const sourceScheduleId = explainability?.sourceScheduleId ? String(explainability.sourceScheduleId) : null;
  if (monthlyScheduleId && sourceScheduleId && monthlyScheduleId !== sourceScheduleId) {
    reasons.push("SOURCE_SCHEDULE_MISMATCH");
  }

  const monthlyGeneratedAtTs = parseTimestamp(monthlyReadModel?.generatedAt);
  const generatedCreatedAtTs = parseTimestamp(explainability?.generatedCreatedAt);
  if (monthlyGeneratedAtTs != null && generatedCreatedAtTs != null) {
    const skewMs = Math.abs(monthlyGeneratedAtTs - generatedCreatedAtTs);
    if (skewMs > 60 * 1000) {
      reasons.push("GENERATED_RUN_TIMESTAMP_MISMATCH");
    }
  }

  const monthlyUpdatedAtTs = parseTimestamp(monthlyReadModel?.updatedAt);
  if (monthlyUpdatedAtTs != null && monthlyGeneratedAtTs != null && monthlyUpdatedAtTs > monthlyGeneratedAtTs + 1000) {
    reasons.push("MONTHLY_UPDATED_AFTER_GENERATION");
  }

  if (autoSaveStatus === "dirty" || autoSaveStatus === "saving" || autoSaveStatus === "error") {
    reasons.push("EDITOR_HAS_LOCAL_CHANGES");
  }

  return Array.from(new Set(reasons));
}

function applyExplainabilityGuard({
  explainability = null,
  monthlyReadModel = null,
  autoSaveStatus = "idle",
} = {}) {
  const base = explainability && typeof explainability === "object"
    ? explainability
    : createEmptyExplainability();
  const staleReasons = getExplainabilityStaleReasons({
    explainability: base,
    monthlyReadModel,
    autoSaveStatus,
  });
  return {
    ...base,
    isStale: staleReasons.length > 0,
    staleReasons,
  };
}

/* ===== personel normalize ===== */
function normalizeRoleHint(rawRole, fallbackRole = null) {
  const value = String(rawRole || "").trim().toLocaleLowerCase("tr-TR");
  if (!value) return fallbackRole;
  if (
    value === "doctor" ||
    value === "doktor" ||
    value.includes("doktor")
  ) {
    return "Doctor";
  }
  if (
    value === "nurse" ||
    value === "hemşire" ||
    value === "hemsire" ||
    value.includes("hemşire") ||
    value.includes("hemsire")
  ) {
    return "Nurse";
  }
  return fallbackRole;
}

function normalizeFromParamTable(x, role) {
  const name = x?.fullName || x?.name || x?.["AD SOYAD"];
  if (!name || isGroupLabel(name)) return null;
  const id = x?.id ?? x?.pid ?? x?.tc ?? x?.tcNo ?? x?.code ?? name;
  const serviceIdRaw =
    x?.serviceId ??
    x?.service ??
    x?.department ??
    x?.departmentId ??
    x?.sectionId ??
    x?.meta?.serviceId ??
    x?.meta?.service ??
    "";
  const areasText = x?.areas || x?.workAreas || x?.["ÇALIŞMA ALANLARI"] || "";
  const shiftsText =
    x?.shiftCodes ||
    x?.codes ||
    x?.shifts ||
    x?.["VARDİYE KODLARI"] ||
    x?.["VARDIYE KODLARI"] ||
    x?.meta?.shiftCodes ||
    x?.meta?.shifts ||
    "";
  const areas =
    typeof areasText === "string"
      ? areasText
          .split(/[;,/-]/)
          .map((s) => s.trim())
          .filter(Boolean)
      : Array.isArray(areasText)
      ? areasText
      : [];
  const shiftCodes =
    typeof shiftsText === "string"
      ? shiftsText
          .split(/[;,/-]/)
          .map((s) => s.trim())
          .filter(Boolean)
      : Array.isArray(shiftsText)
      ? shiftsText
      : [];
  return {
    id: String(id),
    name: String(name),
    role: normalizeRoleHint(
      x?.role || x?.title || x?.departmentRole || x?.meta?.role || x?.meta?.title || x?.meta?.unvan,
      role === "Doctor" ? "Doctor" : "Nurse"
    ),
    serviceId: String(serviceIdRaw || ""),
    areas,
    shiftCodes,
    weekendOff: !!x?.weekendOff,
    nightAllowed: !(x?.nightAllowed === false || x?.geceYasak === true),
    dailyMax: 1,
    monthlyMax: 31,
    maxConsecutive: 5,
    weight: 1,
  };
}

function ensureStaffInEngineStore(activeRole) {
  const roleKey = activeRole === "Doctor" ? "doctors" : "nurses";
  const specific = LS.get(roleKey, []) || [];
  const canonicalV2 = LS.get("peopleV2", []) || [];

  let sourceUsed = "role-specific-backend-sync";
  let fallbackUsed = false;
  let raw = Array.isArray(specific) ? specific : [];

  if (!raw.length && Array.isArray(canonicalV2) && canonicalV2.length) {
    raw = canonicalV2.filter(
      (item) =>
        normalizeRoleHint(
          item?.role || item?.title || item?.departmentRole || item?.meta?.role || item?.meta?.title || item?.meta?.unvan,
          null
        ) === activeRole
    );
    if (raw.length) sourceUsed = "peopleV2-role-filter";
  }

  if (!raw.length) {
    raw = getPeople(activeRole) || [];
    sourceUsed = "general-fallback";
    fallbackUsed = true;
  }

  let staff = raw.map((x) => normalizeFromParamTable(x, activeRole)).filter(Boolean);

  // Eğer hala boşsa diğer kaynaklara bak (kartlar, izinler)
  if (!staff.length) {
    const cards = LS.get(STAFF_KEY, []) || [];
    staff = cards.filter((c) => c?.name && !isGroupLabel(c.name));
    if (staff.length) {
      sourceUsed = "engine-store-fallback";
      fallbackUsed = true;
    } else {
      staff = buildPeopleFromLeaves(activeRole);
      if (staff.length) {
        sourceUsed = "leaves-fallback";
        fallbackUsed = true;
      }
    }
  }
  
  // Dedupe (ID bazlı mükerrer kayıtları temizle)
  const seen = new Set();
  staff = staff.filter(p => {
    if (!p.id || seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });

  staff = (staff || []).filter((s) => s?.name && !isGroupLabel(s.name));
  // Alfabetik sıralama
  staff.sort((a, b) => (a.name || "").localeCompare(b.name || "", "tr"));
  LS.set(STAFF_KEY, staff);
  return { staff, sourceUsed, fallbackUsed };
}

function buildIdToNameMap(preferredPeople = null) {
  const mp = new Map();
  if (Array.isArray(preferredPeople) && preferredPeople.length) {
    for (const p of preferredPeople) {
      const id = p?.id ?? p?.pid ?? p?.tc ?? p?.tcNo ?? p?.code ?? (p?.["AD SOYAD"] || p?.fullName || p?.name);
      const name = p?.fullName || p?.name || p?.displayName || p?.["AD SOYAD"];
      if (!id || !name || isGroupLabel(name)) continue;
      mp.set(String(id), String(name));
    }
    return mp;
  }
  const nurses = LS.get("nurses", []) || [];
  const doctors = LS.get("doctors", []) || [];
  for (const p of [...nurses, ...doctors]) {
    const id =
      p?.id ?? p?.pid ?? p?.tc ?? p?.tcNo ?? p?.code ?? (p?.["AD SOYAD"] || p?.fullName || p?.name);
    const name = p?.fullName || p?.name || p?.["AD SOYAD"];
    if (!id || !name || isGroupLabel(name)) continue;
    mp.set(String(id), String(name));
  }
  const ppl = getPeople() || [];
  for (const p of ppl) {
    const id = p?.id;
    const nm = p?.fullName || p?.name || p?.displayName || p?.code;
    if (!id || !nm || isGroupLabel(nm) || mp.has(id)) continue;
    mp.set(id, nm);
  }
  const cards = LS.get(STAFF_KEY, []) || [];
  for (const p of cards) {
    const id = p?.id;
    const nm = p?.name || p?.fullName || p?.displayName;
    if (!id || !nm || isGroupLabel(nm) || mp.has(id)) continue;
    mp.set(String(id), String(nm));
  }
  return mp;
}

function readAiPlanFallback(year, month0) {
  const saved = LS.get("scheduleRowsV2");
  if (saved && saved.year === year && saved.month === month0 + 1) return saved;
  return null;
}

/* ======================= bileşen ======================= */
const DutyRowsEditor = forwardRef(function DutyRowsEditor(
  {
    year: yearProp,
    month: monthProp,
    setYear: setYearProp,
    setMonth: setMonthProp,
    sectionId = "calisma-cizelgesi",
    serviceId = "",
    role: roleProp,
    workAreas: workAreasProp,
    peopleAll = [],
    workingHours: workingHoursProp,
    personLeaves = {},
  },
  ref
) {
  /* Yıl/Ay (controlled/uncontrolled) */
  const today = new Date();
  const [yState, setYState] = useState(
    parseInt(localStorage.getItem("plannerYear") || String(today.getFullYear()), 10)
  );
  const [mState, setMState] = useState(
    parseInt(localStorage.getItem("plannerMonth") ?? String(today.getMonth()), 10)
  );

  const hasExternalYM = Number.isInteger(yearProp) && Number.isInteger(monthProp);

  const year = hasExternalYM ? Number(yearProp) : yState;
  const month0 = hasExternalYM
    ? normalizeMonthAnyBase(monthProp, { preferOneBased: true })
    : normalizeMonthAnyBase(mState, { preferOneBased: false });
  const setYear = typeof setYearProp === "function" ? setYearProp : setYState;
  const setMonth =
    typeof setMonthProp === "function"
      ? (v) => setMonthProp(Number(v))
      : (v) => setMState(normalizeMonthAnyBase(v, { preferOneBased: false }));

  const [isJusticeModalOpen, setIsJusticeModalOpen] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem("plannerYear", String(year));
      localStorage.setItem("plannerMonth", String(month0));
      localStorage.setItem("plannerMonth1", String(month0 + 1));
    } catch (err) {
      console.warn("plannerMonth write failed:", err);
    }
  }, [year, month0]);

  const { weeks: weekCount, matrix: weekMatrix, daysInMonth } = buildWeekGrid(year, month0);
  const month1 = month0 + 1;

  /* Rol & Seçenekler */
  const role = roleProp ?? LS.get("activeRole", "Nurse");
  const roleLabel = role === "Doctor" ? "Doktorlar" : "Hemşireler";
  const workAreas = useMemo(
    () => (Array.isArray(workAreasProp) ? workAreasProp : getAreas()),
    [workAreasProp]
  );
  const workingHours = Array.isArray(workingHoursProp) && workingHoursProp.length > 0 ? workingHoursProp : getShifts();
  const areaOptions = useMemo(
    () => (workAreas || []).map((a) => a.name).filter(Boolean),
    [workAreas]
  );
  const shiftOptions = workingHours || [];

  /* Satır Tanımları */
  const DEF_KEY = "dutyRowDefs";
  const lsKeyForRole = `${DEF_KEY}_${role}`;
  const {
    items: defs,
    create: createDef,
    update: updateDef,
    remove: removeDef,
    replaceAll: replaceAllDefs,
  } = useCrudModel(lsKeyForRole, "id");

  /* Overrides */
  const OVR_KEY = "dutyMonthOverrides";
  const ymKey = `${year}-${String(month0 + 1).padStart(2, "0")}`;
  const [overrides, setOverrides] = useState(() => {
    const all = LS.get(OVR_KEY, {});
    return all?.[role]?.[ymKey] || {};
  });
  useEffect(() => {
    const all = LS.get(OVR_KEY, {});
    const byRole = all[role] || {};
    byRole[ymKey] = overrides;
    all[role] = byRole;
    LS.set(OVR_KEY, all);
  }, [overrides, role, ymKey]);
  useEffect(() => {
    const all = LS.get(OVR_KEY, {});
    setOverrides(all?.[role]?.[ymKey] || {});
  }, [role, ymKey]);

  const rows = defs;
  const [loadingRemote, setLoadingRemote] = useState(false);
  const [remoteRevision, setRemoteRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const [lastSavedInfo, setLastSavedInfo] = useState(null);
  const [overrideDialog, setOverrideDialog] = useState({ open: false, errors: [], pendingPayload: null });
  const [rawGeneratedExplainability, setRawGeneratedExplainability] = useState(() => createEmptyExplainability());
  const [monthlyReadModelState, setMonthlyReadModelState] = useState(() => ({
    scheduleId: null,
    updatedAt: null,
    generatedAt: null,
  }));

  useEffect(() => {
    const bumpRemote = () => setRemoteRevision((v) => v + 1);
    const onStorage = (ev) => {
      if (ev?.key === "scheduleLastSaved" || ev?.key === "scheduleBuildTrigger" || !ev?.key) {
        bumpRemote();
      }
    };
    window.addEventListener("planner:changed", bumpRemote);
    window.addEventListener("schedule:saved", bumpRemote);
    window.addEventListener("schedule:built", bumpRemote);
    window.addEventListener("schedule:invalidated", bumpRemote);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("planner:changed", bumpRemote);
      window.removeEventListener("schedule:saved", bumpRemote);
      window.removeEventListener("schedule:built", bumpRemote);
      window.removeEventListener("schedule:invalidated", bumpRemote);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  const serviceKey = serviceId == null ? "" : String(serviceId);
  const autoSaveTimerRef = useRef(null);
  const lastSavedSignatureRef = useRef(null);
  const [autoSaveStatus, setAutoSaveStatus] = useState("idle");
  const [autoSaveError, setAutoSaveError] = useState(null);
  const [staffLoading, setStaffLoading] = useState(true);
  const [staffRevision, setStaffRevision] = useState(0);
  const [buildLoading, setBuildLoading] = useState(false);
  const savedAssignmentsRef = useRef([]);

  const normalizeOverridesForSignature = useCallback((ovr) => {
    return Object.fromEntries(
      Object.entries(ovr || {})
        .map(([rowId, days]) => [
          rowId,
          Object.fromEntries(
            Object.entries(days || {})
              .sort((a, b) => Number(a[0]) - Number(b[0]))
          ),
        ])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    );
  }, []);
  const makeSignature = useCallback(
    (defsData, overridesData, rosterData, previewData, aiPlanData, pinsData, rulesData) =>
      JSON.stringify({
        defs: defsData || [],
        overrides: normalizeOverridesForSignature(overridesData),
        roster: rosterData || null,
        preview: previewData || null,
        aiPlan: aiPlanData || null,
        pins: pinsData || [],
        rules: rulesData || [],
      }),
    [normalizeOverridesForSignature]
  );
  const [preview, setPreview] = useState(null);
  const [roster, setRoster] = useState(null);
  const [rosterBaseline, setRosterBaseline] = useState(null);
  /* AI Plan: backend varsa backend, local sadece fallback */
  const [aiPlan, setAiPlan] = useState(null);
  const shiftMetaByCode = useMemo(() => {
    const map = new Map();
    for (const item of shiftOptions || []) {
      const code = String(item?.code || item?.id || "").trim();
      if (!code) continue;
      map.set(code, item);
    }
    return map;
  }, [shiftOptions]);
  const rosterDisplayRows = useMemo(() => {
    return (rows || []).map((row) => {
      const namesByDay = Array.from({ length: daysInMonth }, (_x, idx) =>
        (roster?.namedAssignments?.[idx + 1]?.[row.id] || [])
          .filter((nm) => !isGroupLabel(nm))
          .sort((a, b) => a.localeCompare(b, "tr"))
      );
      const depth = Math.max(1, ...namesByDay.map((names) => names.length));
      const shiftMeta = shiftMetaByCode.get(String(row?.shiftCode || "").trim()) || null;
      return {
        ...row,
        namesByDay,
        depth,
        shiftHoursText: shiftMeta ? `${shiftMeta.start || ""} - ${shiftMeta.end || ""}`.trim() : "",
      };
    });
  }, [rows, roster, daysInMonth, shiftMetaByCode]);
  const rosterDiffMeta = useMemo(
    () => buildRosterDiffMeta({ currentRoster: roster, baselineRoster: rosterBaseline, rows, daysInMonth }),
    [roster, rosterBaseline, rows, daysInMonth]
  );

  /* Pinler (Sabitlenenler) */
  const [pins, setPins] = useState([]);

  /* Kurallar (Backend + LS Sync) */
  const [rules, setRules] = useState(() => LS.get("dutyRulesV2", []) || []);

  const loadGeneratedExplainability = useCallback(async () => {
    if (!sectionId) {
      setRawGeneratedExplainability(createEmptyExplainability());
      return createEmptyExplainability();
    }

    try {
      const generated = await getGeneratedSchedule({
        sectionId,
        serviceId: serviceKey,
        role,
        year,
        month: month1,
      });
      const next = generated ? extractGeneratedExplainability(generated) : createEmptyExplainability();
      setRawGeneratedExplainability(next);
      return next;
    } catch (err) {
      if (err?.status !== 404) {
        console.error("[DutyRowsEditor] getGeneratedSchedule err:", err);
      }
      const empty = createEmptyExplainability();
      setRawGeneratedExplainability(empty);
      return empty;
    }
  }, [sectionId, serviceKey, role, year, month1]);

  const generatedExplainability = useMemo(
    () =>
      applyExplainabilityGuard({
        explainability: rawGeneratedExplainability,
        monthlyReadModel: monthlyReadModelState,
        autoSaveStatus,
      }),
    [rawGeneratedExplainability, monthlyReadModelState, autoSaveStatus]
  );

  const computeSignature = useCallback(
    () => makeSignature(rows, overrides, roster, preview, aiPlan, pins, rules),
    [rows, overrides, roster, preview, aiPlan, pins, rules, makeSignature]
  );

  /* Local UI state */
  const [editorRowId, setEditorRowId] = useState(null);
  const [supOpen, setSupOpen] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);

  /* Basit toast */
  const note = useCallback((msg, type = "info") => {
    const message = String(msg || "").trim() || "İşlem tamamlandı.";
    const title =
      type === "error"
        ? "Hata"
        : type === "success"
          ? "Başarılı"
          : type === "warning"
            ? "Uyarı"
            : "Bilgi";
    if (toastSafe && typeof toastSafe[type] === "function") {
      toastSafe[type](title, { description: message });
    } else if (typeof toastSafe === "function") {
      toastSafe(title, { description: message });
    } else {
      alert(`${title}: ${message}`);
    }
  }, []);

  /* setCount */
  const setCount = (rowId, day, val) => {
    setOverrides((prev) => {
      const n = val === "" ? null : clampSingleSlotCount(val);
      const curr = { ...(prev[rowId] || {}) };
      if (n == null) delete curr[day];
      else curr[day] = n;
      return { ...prev, [rowId]: curr };
    });
  };

  const fillRowAllDays = useCallback(
    (rowId, n) => {
      const row = rows.find((r) => r.id === rowId);
      if (!row) return;
      const val = clampSingleSlotCount(n);
      setOverrides((prev) => {
        const next = { ...(prev[rowId] || {}) };
        for (let d = 1; d <= daysInMonth; d++) {
          const wd = new Date(year, month0, d).getDay();
          const weekend = wd === 0 || wd === 6;
          next[d] = row.weekendOff && weekend ? 0 : val;
        }
        return { ...prev, [rowId]: next };
      });
    },
    [rows, daysInMonth, year, month0]
  );

  /* Yeni Satır */
  const [form, setForm] = useState({ label: "", shiftCode: "", defaultCount: 0 });
  const addRow = () => {
    if (!form.label) return note("Görev (Çalışma Alanı) seçin.", "info");
    if (!form.shiftCode) return note("Vardiya seçin.", "info");
    const base = clampSingleSlotCount(form.defaultCount || 0);
    const id = Date.now();
    const newDef = {
      id,
      label: form.label,
      shiftCode: form.shiftCode,
      defaultCount: base,
      pattern: [base, base, base, base, base, base, base],
      weekendOff: false,
      holidayPolicy: 'none',
    };
    createDef(newDef);
    fillRowAllDays(id, base);
    setForm({ label: "", shiftCode: "", defaultCount: 0 });
  };

  /* sıra/kopya/sil */
  const moveRow = (rowId, dir) => {
    const idx = defs.findIndex((r) => r.id === rowId);
    if (idx < 0) return;
    const j = dir === "up" ? idx - 1 : idx + 1;
    if (j < 0 || j >= defs.length) return;
    const next = [...defs];
    const [it] = next.splice(idx, 1);
    next.splice(j, 0, it);
    replaceAllDefs(next);
  };
  const deleteRow = (rowId) => {
    removeDef(rowId);
    setOverrides((prev) => {
      const { [rowId]: _drop, ...rest } = prev;
      return rest;
    });
  };
  const duplicateRow = (rowId) => {
    const idx = defs.findIndex((r) => r.id === rowId);
    if (idx < 0) return;
    const o = defs[idx];
    const copyId = Date.now();
    const copy = { ...o, id: copyId, label: `${o.label} (kopya)` };
    const next = [...defs];
    next.splice(idx + 1, 0, copy);
    replaceAllDefs(next);
    setOverrides((prev) => ({ ...prev, [copyId]: { ...(prev[o.id] || {}) } }));
  };

  const setPatternValue = (rowId, colIndex, value) => {
    const target = defs.find((r) => r.id === rowId);
    if (!target) return;
    const pat =
      Array.isArray(target.pattern) && target.pattern.length === 7
        ? [...target.pattern]
        : Array(7).fill(target.defaultCount || 0);
    pat[colIndex] = Math.max(0, Number(value || 0));
    updateDef(rowId, { pattern: pat });
  };

  /* Toplu Uygula */
  const [bulkVal, setBulkVal] = useState(0);
  const [bulkTarget, setBulkTarget] = useState("all");
  const applyBulkToMonth = (rowId) => {
    const n = Math.max(0, Number(bulkVal || 0));
    setOverrides((prev) => {
      const row = rows.find((r) => r.id === rowId);
      const curr = { ...(prev[rowId] || {}) };
      if (bulkTarget === "all") {
        for (let d = 1; d <= daysInMonth; d++) {
          const wd = new Date(year, month0, d).getDay();
          const weekend = wd === 0 || wd === 6;
          curr[d] = row?.weekendOff && weekend ? 0 : n;
        }
      } else {
        const i = Number(bulkTarget);
        for (let w = 0; w < weekMatrix.length; w++) {
          const day = weekMatrix[w][i];
          if (!day) continue;
          const wd = new Date(year, month0, day).getDay();
          const weekend = wd === 0 || wd === 6;
          curr[day] = row?.weekendOff && weekend ? 0 : n;
        }
      }
      return { ...prev, [rowId]: curr };
    });
  };

  /* Önizleme/sonuç */
  const makeHeader = () => {
    const header = ["Görev", "Vardiya", "Görevli Kişi (varsayılan)"];
    for (let d = 1; d <= daysInMonth; d++) {
      const wd = new Date(year, month0, d).getDay();
      header.push(`${String(d).padStart(2, "0")} (${WD_TR[wd]})`);
    }
    return header;
  };

  const buildCommitThisMonth = async (opts = {}) => {
    const { generateLocalRoster = true } = opts;
    const header = makeHeader();
    const aoa = [header];
    const committed = {};

    for (const r of rows) {
      const ovr = overrides[r.id] || {};
      const line = [r.label, r.shiftCode, r.defaultCount || 0];
      committed[r.id] = {};
      for (let d = 1; d <= daysInMonth; d++) {
        const wd = new Date(year, month0, d).getDay();
        const i = monIndex(wd);
        const pat = Array.isArray(r.pattern) ? r.pattern : Array(7).fill(r.defaultCount || 0);
        let v = ovr[d];
        if (v == null) v = pat[i] ?? (r.defaultCount || 0);
        if (r.weekendOff && (wd === 0 || wd === 6)) v = 0;
        v = Math.max(0, Number(v) || 0);
        committed[r.id][d] = v;
        line.push(v);
      }
      aoa.push(line);
    }

    const previewData = { header, rows: aoa.slice(1) };
    setOverrides(committed);
    setPreview(previewData);

    if (!generateLocalRoster) {
      setRoster(null);
      return { committedOverrides: committed, previewData, roster: null };
    }

    // personel yoksa yalnızca sayı listesi
    const staff = staffForRole;
    if (!staff.length) {
      setRoster(null);
      return { committedOverrides: committed, previewData, roster: null };
    }

    // izinler
    const unavailableSets = buildUnavailableByDay(year, month0);
    const unavailable = Object.fromEntries(
      Object.entries(unavailableSets).map(([d, pack]) => [
        Number(d),
        Array.from(pack?.ids || []),
      ])
    );

    // Pinleri hazırla: { personId, day: "YYYY-MM-DD", roleLabel, shiftCode }
    const pinnedAssignments = pins.map(p => {
      const r = rows.find(row => String(row.id) === String(p.rowId));
      if (!r) return null;
      return {
        personId: String(p.personId),
        day: `${year}-${String(month0 + 1).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`,
        roleLabel: r.label,
        shiftCode: r.shiftCode,
        rowId: r.id,
        dayNum: Number(p.day)
      };
    }).filter(Boolean);

    // runPlannerOnce için taskLines'ı oluştur.
    const taskLines = rows.map(r => {
      const counts = {};
      for (let d = 1; d <= daysInMonth; d++) {
        counts[d] = committed[r.id][d] || 0;
      }
      return { ...r, counts };
    });

    toastSafe.loading("Gelişmiş kural motoru çalışıyor...", { id: "rosterEngine" });

    // runPlannerOnce çağrısı
    const plannerRes = await runPlannerOnce({
      year,
      month: month0,
      activeServiceId: serviceId,
      activeRole: role,
      nurses: role === "Doctor" ? [] : staff,
      doctors: role === "Doctor" ? staff : [],
      workingHours: workingHours || [],
      personLeaves: personLeaves || {},
      taskLines,
      dpRules: rules
    });

    toastSafe.success("Çizelge başarıyla oluşturuldu!", { id: "rosterEngine" });

    const assignmentsArray = plannerRes?.dpResult?.assignments || [];
    
    // Flat assignments array'ini namedAssignments formatına çevir
    const namedBase = assignmentsToNamed(assignmentsArray, rows);

    const rosterRes = {
      namedAssignments: namedBase,
      issues: plannerRes?.dpResult?.issues || []
    };

    const rowMeta = new Map((rows || []).map((r) => [String(r.id), r]));
    const idNameMap = buildIdToNameMap();
    const canonToId = new Map();
    for (const [pid, name] of idNameMap.entries()) {
      const canon = canonName(name);
      if (!canon) continue;
      if (!canonToId.has(canon)) canonToId.set(canon, []);
      canonToId.get(canon).push(String(pid));
    }

    const flatAssignments = [];
    const monthKey = `${year}-${String(month0 + 1).padStart(2, "0")}`;
    const invalidPreviewAssignments = [];
    if (rosterRes?.namedAssignments) {
      for (const [dayKey, byRow] of Object.entries(rosterRes.namedAssignments)) {
        const dayNum = Number(dayKey);
        if (!Number.isFinite(dayNum) || dayNum < 1) continue;
        const dateStr = `${year}-${String(month0 + 1).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
        for (const [rowId, names] of Object.entries(byRow || {})) {
          const row = rowMeta.get(String(rowId));
          const roleLabel = row?.label || String(rowId);
          const shiftCode = row?.shiftCode || "";
          const validNames = [];
          for (const nm of names || []) {
            if (!nm || isGroupLabel(nm)) continue;
            const canon = canonName(nm);
            const ids = canon ? canonToId.get(canon) : null;
            if (!ids?.[0]) {
              invalidPreviewAssignments.push({
                day: dayNum,
                label: roleLabel,
                reason: "INVALID_ASSIGNEE",
                detail: "RAW_LABEL",
                invalidAssigneeDetected: true,
                personName: nm,
              });
              continue;
            }
            validNames.push(nm);
            flatAssignments.push({
              date: dateStr,
              day: dayNum,
              monthKey,
              role,
              rowId,
              roleLabel,
              shiftCode,
              personName: nm,
              personId: ids[0],
              source: "rosterPreview",
            });
          }
          rosterRes.namedAssignments[dayKey][rowId] = validNames;
        }
      }
    }

    if (rosterRes && invalidPreviewAssignments.length) {
      rosterRes.issues = [...(Array.isArray(rosterRes.issues) ? rosterRes.issues : []), ...invalidPreviewAssignments];
    }

    // izindekileri çıkar + issue yaz
    if (rosterRes && rosterRes.assignments) {
      const issues = rosterRes.issues ? [...rosterRes.issues] : [];
      const named = rosterRes.namedAssignments || {};
      const idMap = buildIdToNameMap();
      const canonMap = new Map();
      for (const [id, name] of idMap.entries()) canonMap.set(String(id), canonName(name));

      for (const [dayStr, byRow] of Object.entries(rosterRes.assignments)) {
        const day = Number(dayStr);
        const banPack = unavailableSets?.[day];
        if (!banPack) continue;
        const banIds = banPack.ids || new Set();
        const banCanon = banPack.canon || new Set();

        for (const [rowId, personIds] of Object.entries(byRow)) {
          const keep = [];
          const removed = [];
          for (const pid of personIds || []) {
            const pidStr = String(pid);
            const canon = canonMap.get(pidStr);
            if (banIds.has(pidStr) || (canon && banCanon.has(canon))) removed.push(pid);
            else keep.push(pid);
          }
          if (removed.length) {
            rosterRes.assignments[day][rowId] = keep;
            if (!named[day]) named[day] = {};
            const oldNames = named[day][rowId] || [];
            const remNames = removed
              .map((pid) => idMap.get(String(pid)))
              .filter((nm) => nm && !isGroupLabel(nm));
            named[day][rowId] = oldNames.filter((nm) => {
              const canon = canonName(nm);
              return !remNames.includes(nm) && !banCanon.has(canon);
            });
            const label = rows.find((r) => r.id == rowId)?.label || rowId;
            issues.push({ day, label, reason: "İzin çakışması" });
          }
        }
      }
      rosterRes.namedAssignments = named;
      rosterRes.issues = issues;
    }

    setRoster(rosterRes);
    setRosterBaseline(normalizeRosterData(rosterRes));

    // LS'ye yaz
    const STORE_KEY = "generatedRoster";
    const all = LS.get(STORE_KEY, {});
    const byRole = all[role] || {};
    byRole[`${year}-${String(month0 + 1).padStart(2, "0")}`] = rosterRes;
    all[role] = byRole;
    LS.set(STORE_KEY, all);

    const FLAT_KEY = "generatedRosterFlat";
    const flatAll = LS.get(FLAT_KEY, {});
    const flatByRole = flatAll[role] || {};
    flatByRole[monthKey] = flatAssignments.map((a) => ({ ...a, _draft: true }));
    flatAll[role] = flatByRole;
    LS.set(FLAT_KEY, flatAll);
    try {
      window.dispatchEvent(new Event("planner:changed"));
    } catch {}
    try {
      LS.set("scheduleBuildTrigger", { ym: monthKey, ts: Date.now() });
      window.dispatchEvent(new Event("schedule:built"));
    } catch {}
    return {
      committedOverrides: committed,
      previewData,
      roster: rosterRes,
      rosterBaseline: normalizeRosterData(rosterRes),
    };
  };

  const exportXlsx = () => {
    try {
      if (!rows.length) return note("Dışa aktarmak için önce en az bir satır ekleyin.", "info");

      const header = makeHeader();
      const aoaNumbers = [header];

      for (const r of rows) {
        const defShift = (shiftOptions || []).find((s) => norm(s.code) === norm(r.shiftCode));
        const shiftText = defShift ? `${defShift.code} ${defShift.start}–${defShift.end}` : r.shiftCode || "";
        const pat = Array.isArray(r.pattern) ? r.pattern : Array(7).fill(r.defaultCount || 0);
        const ovr = overrides[r.id] || {};
        const line = [r.label, shiftText, r.defaultCount || 0];

        for (let d = 1; d <= daysInMonth; d++) {
          const wd = new Date(year, month0, d).getDay();
          let val = ovr[d];
          if (val == null) {
            const i = monIndex(wd);
            val = pat[i] ?? 0;
          }
          if (r.weekendOff && (wd === 0 || wd === 6)) val = 0;
          line.push(Math.max(0, Number(val) || 0));
        }
        aoaNumbers.push(line);
      }

      const rosterOut = roster;
      const aoaAssign = [["Görev", "Vardiya", ...Array.from({ length: daysInMonth }, (_, i) => String(i + 1))]];
      if (rosterOut && rosterOut.namedAssignments) {
        for (const r of rows) {
          const line = [r.label, r.shiftCode];
          for (let d = 1; d <= daysInMonth; d++) {
            const names = (rosterOut.namedAssignments?.[d]?.[r.id] || []).filter((nm) => !isGroupLabel(nm));
            line.push(names.join("\n"));
          }
          aoaAssign.push(line);
        }
      } else {
        aoaAssign.push(["(Not)", "Personel listesi bulunamadı — Parametreler > Personel'den ekleyin."]);
      }

      const aoaIssues = [["Gün", "Görev", "Not"]];
      if (rosterOut && Array.isArray(rosterOut.issues) && rosterOut.issues.length) {
        rosterOut.issues.forEach((x) =>
          aoaIssues.push([x.day, x.label, x.reason ? `Yeterli aday bulunamadı (${x.reason})` : "Yeterli aday bulunamadı"])
        );
      } else {
        aoaIssues.push(["-", "-", "Uyarı yok"]);
      }

      const wb = XLSX.utils.book_new();
      const ws1 = XLSX.utils.aoa_to_sheet(aoaNumbers);
      const ws2 = XLSX.utils.aoa_to_sheet(aoaAssign);
      const ws3 = XLSX.utils.aoa_to_sheet(aoaIssues);

      ws1["!cols"] = [{ wch: 24 }, { wch: 16 }, { wch: 20 }, ...Array.from({ length: daysInMonth }, () => ({ wch: 6 }))];
      ws2["!cols"] = [{ wch: 24 }, { wch: 12 }, ...Array.from({ length: daysInMonth }, () => ({ wch: 18 }))];
      ws3["!cols"] = [{ wch: 8 }, { wch: 24 }, { wch: 28 }];

      XLSX.utils.book_append_sheet(wb, ws1, "Cizelge-Sayı");
      XLSX.utils.book_append_sheet(wb, ws2, "Cizelge-Atama");
      XLSX.utils.book_append_sheet(wb, ws3, "Uyarılar");

      const fileName = `nobet_cizelgesi_${roleLabel.toLowerCase()}_${year}-${String(month0 + 1).padStart(2, "0")}.xlsx`;
      XLSX.writeFile(wb, fileName);
    } catch (e) {
      note(`Excel'e aktarma sırasında hata: ${e.message || e}`, "error");
    }
  };

  /* Satır-bazlı (G1) import */
  const assignmentRef = useRef(null);
  const askAssignmentImport = () => assignmentRef.current?.click();

  function applyAssignmentsToGrid(parsedRows) {
    if (!Array.isArray(parsedRows) || parsedRows.length === 0) {
      note("İçe aktarılan satır bulunamadı.", "info");
      return;
    }
    const byKey = new Map();
    (defs || []).forEach((r) => {
      const key = `${norm(r.label)}|${norm(r.shiftCode)}`;
      const bucket = byKey.get(key) || [];
      bucket.push(r);
      byKey.set(key, bucket);
    });

    const nextOverrides = { ...(overrides || {}) };
    let createdCount = 0,
      appliedCount = 0;
    const skipped = [];

    for (const row of parsedRows) {
      const service = String(row.service ?? "").trim();
      const shiftCode = String(row.shiftCode ?? "").trim();
      const day = dayFromAny(row.date, year, month0);

      if (!service || !shiftCode || !day) {
        skipped.push(row);
        continue;
      }

      const key = `${norm(service)}|${norm(shiftCode)}`;
      let bucket = byKey.get(key) || [];
      let target = bucket.find((candidate) => {
        const dayVal = Number(nextOverrides?.[candidate.id]?.[day] || 0);
        return dayVal < 1;
      });

      if (!target) {
        const id = Date.now() + Math.floor(Math.random() * 100000);
        const base = 0;
        const newDef = {
          id,
          label: service,
          shiftCode,
          defaultCount: base,
          pattern: [base, base, base, base, base, base, base],
          weekendOff: false,
          holidayPolicy: 'none',
        };
        createDef(newDef);
        bucket = [...bucket, newDef];
        byKey.set(key, bucket);
        target = newDef;
        createdCount++;
      }

      if (!nextOverrides[target.id]) nextOverrides[target.id] = {};
      nextOverrides[target.id][day] = 1;
      appliedCount++;
    }

    setOverrides(nextOverrides);
    const parts = [];
    if (appliedCount) parts.push(`${appliedCount} atama işlendi`);
    if (createdCount) parts.push(`${createdCount} yeni satır eklendi`);
    if (skipped.length) parts.push(`${skipped.length} satır atlandı (eksik servis/vardiya/tarih)`);
    note(parts.join(" • ") || "İçe aktarma tamamlandı.", "success");

    try {
      window.dispatchEvent(new Event("planner:changed"));
    } catch {}
  }

  const onAssignmentFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsed = await parseAssignmentsFile(file, { year, month0 });
      applyAssignmentsToGrid(parsed);
    } catch (err) {
      const details = err && err.details ? err.details.join("\n") : err?.message || "Bilinmeyen hata";
      note(details, "error");
    } finally {
      e.target.value = "";
    }
  };

  /* Şablondan import (toolbar ref ile) */
  const importFromTemplate = async (file) => {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      if (!ws) throw new Error("Çalışma sayfası bulunamadı.");
      const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false });
      if (!aoa?.length) throw new Error("Sayfa boş görünüyor.");

      const header = aoa[0].map((x) => (x ?? "").toString().trim());
      const up = header.map(norm);
      const idxLabel = up.findIndex((h) => h.includes("GÖREV") || h.includes("GOREV"));
      const idxShift = up.findIndex((h) => h.includes("VARDIYA") || h.includes("VARDİYA"));
      const idxDef = up.findIndex((h) => /G[ÖO]REVL[İI]|VARSAYILAN|K[İI]S[İI]|G[ÜU]NL[ÜU]K/.test(h));
      if (idxLabel < 0 || idxShift < 0) throw new Error("Başlıklar bulunamadı (Görev/Vardiya).");

      const dayCols = [];
      for (let col = 0; col < header.length; col++) {
        const m = String(header[col] ?? "").trim().match(/^(\d{1,2})/);
        if (!m) continue;
        const d = parseInt(m[1], 10);
        if (d >= 1 && d <= 31) dayCols.push({ col, day: d });
      }
      if (!dayCols.length) throw new Error("Gün sütunları (1..31) bulunamadı.");

      const newDefs = [];
      const newOverrides = {};
      for (let r = 1; r < aoa.length; r++) {
        const row = aoa[r];
        if (!row || row.length === 0) continue;
        const label = (row[idxLabel] ?? "").toString().trim();
        const shiftText = (row[idxShift] ?? "").toString().trim();
        const defCount = idxDef >= 0 ? clampSingleSlotCount(row[idxDef] ?? 0) : 0;
        if (!label && !shiftText && !defCount) continue;

        const id = Date.now() + r;
        const shiftCode = (shiftText.split(/\s+/)[0] || shiftText).trim();
        const ovr = {};
        const bucket = [[], [], [], [], [], [], []];
        for (const { col, day } of dayCols) {
          const v = row[col];
          if (v === "" || v == null) continue;
          const n = Number(v);
          if (!Number.isFinite(n) || n < 0) continue;
          ovr[day] = clampSingleSlotCount(n);
          const wd = new Date(year, month0, day).getDay();
          const i = monIndex(wd);
          bucket[i].push(n);
        }
        const pattern = bucket.map((arr) => (arr.length ? clampSingleSlotCount(arr[0]) : defCount));
        newDefs.push({ id, label, shiftCode, defaultCount: defCount, pattern, weekendOff: false, holidayPolicy: 'none' });
        newOverrides[id] = ovr;
      }
      if (!newDefs.length) throw new Error("İçe aktarılacak satır bulunamadı.");

      replaceAllDefs(newDefs);
      setOverrides(newOverrides);
      setPreview(null);
      setRoster(null);
      note(`Şablondan ${newDefs.length} satır içe aktarıldı.`, "success");
    } catch (e) {
      note(`Şablondan yükleme başarısız: ${e.message || e}`, "error");
    }
  };

  /* JSON yedek/geri yükle */
  const overridesFileRef = useRef(null);
  function exportOverridesJSON() {
    try {
      const payload = { version: 1, role, year, month0, ymKey, overrides, exportedAt: new Date().toISOString() };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const fname = `overrides_${role}_${year}-${String(month0 + 1).padStart(2, "0")}.json`;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = fname;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      note(`JSON dışa aktarma hatası: ${e.message || e}`, "error");
    }
  }
  async function onOverridesJsonFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data || typeof data !== "object") throw new Error("Geçersiz JSON.");
      if (data.role !== role) throw new Error(`Rol uyuşmuyor (beklenen: ${role}, dosya: ${data.role}).`);
      if (data.year !== year || data.month0 !== month0 || data.ymKey !== ymKey) throw new Error("Yıl/Ay uyuşmuyor.");
      if (!data.overrides || typeof data.overrides !== "object") throw new Error("overrides alanı bulunamadı.");
      setOverrides(data.overrides);
      note("JSON içe aktarıldı ve uygulandı.", "success");
    } catch (e2) {
      note(`JSON içe aktarma hatası: ${e2.message || e2}`, "error");
    } finally {
      e.target.value = "";
    }
  }
  const [peopleNameMap, setPeopleNameMap] = useState(() => buildIdToNameMap());
  const emitPlannerChanged = useCallback(() => {
    try {
      window.dispatchEvent(new Event("planner:changed"));
    } catch {
      /* noop */
    }
  }, []);
  const refreshAiPlan = useCallback(() => {
    if (monthlyReadModelState.scheduleId) {
      setAiPlan((prev) => prev || null);
    } else {
      setAiPlan(readAiPlanFallback(year, month0));
    }
    setPeopleNameMap(buildIdToNameMap());
    emitPlannerChanged();
  }, [year, month0, emitPlannerChanged, monthlyReadModelState.scheduleId]);
  useEffect(() => {
    refreshAiPlan();
  }, [year, month0, refreshAiPlan]);

  function hydrateAiNamesInLS() {
    const saved = LS.get("scheduleRowsV2");
    if (!saved || !Array.isArray(saved.rows)) {
      note("Kaydedilmiş otomatik plan bulunamadı.", "info");
      return;
    }
    if (saved.year !== year || saved.month !== month0 + 1) {
      note("Seçili yıl/ay için kayıtlı plan yok.", "info");
      return;
    }
    const id2name = buildIdToNameMap();
    let patched = 0;
    const newRows = saved.rows.map((r) => {
      if (r.personId && (!r.personName || r.personName === "")) {
        const nm = id2name.get(r.personId);
        if (nm && !isGroupLabel(nm)) {
          patched++;
          return { ...r, personName: nm };
        }
      }
      return r;
    });
    if (patched === 0) {
      note("Eksik isim bulunamadı (zaten dolu).", "info");
      return;
    }
    const updated = { ...saved, rows: newRows };
    LS.set("scheduleRowsV2", updated);
    setAiPlan(updated);
    emitPlannerAiPlan();
    note(`${patched} satırın ismi dolduruldu.`, "success");
  }

  useEffect(() => {
    let cancelled = false;
    if (!sectionId) return () => { cancelled = true; };
    (async () => {
      setLoadingRemote(true);
      try {
        const schedule = await getMonthlySchedule({
          sectionId,
          serviceId: serviceKey,
          role,
          year,
          month: month1,
        });
        if (cancelled) return;
        if (schedule && schedule.data) {
          const data = schedule.data || {};
          const remoteDefs = Array.isArray(data.defs) ? data.defs : [];
          const remoteAssignments = Array.isArray(data.assignments) ? data.assignments : [];
          savedAssignmentsRef.current = remoteAssignments;
          const normalizedRemote = normalizeDutyDefsAndOverrides(
            remoteDefs,
            data.overrides && typeof data.overrides === "object" ? data.overrides : {}
          );
          const defsForUI = normalizedRemote.defs;
          if (Array.isArray(defsForUI)) replaceAllDefs(defsForUI);
          if ("overrides" in data) {
            const nextOverrides = normalizedRemote.overrides;
            setOverrides(nextOverrides);
          }
          if ("preview" in data) setPreview(data.preview || null);
          const rosterFromData = "roster" in data ? normalizeRosterData(data.roster || null) : null;
          const rosterBaselineFromData =
            "rosterBaseline" in data
              ? normalizeRosterData(data.rosterBaseline || null)
              : rosterFromData;
          const rosterFromAssignments = remoteAssignments.length
            ? buildRosterFromBackend(remoteAssignments, data.issues, defsForUI, data.candidateAudit, data.issueDiagnostics)
            : null;
          const rosterForUI = rosterFromAssignments || rosterFromData;
          if (rosterForUI) setRoster(rosterForUI);
          else if ("roster" in data) setRoster(null);
          setRosterBaseline(rosterBaselineFromData || null);
          setAiPlan("aiPlan" in data ? (data.aiPlan || null) : null);
          if ("pins" in data) setPins(data.pins || []);
          if ("rules" in data) {
            const r = data.rules || [];
            setRules(r);
            LS.set("dutyRulesV2", r); // Solver için LS'yi güncelle
          }
          setLastSavedInfo({
            updatedAt: schedule.updatedAt || schedule.createdAt || null,
            updatedBy: schedule.updatedBy || schedule.createdBy || null,
          });
          setMonthlyReadModelState({
            scheduleId: schedule.id || null,
            updatedAt: schedule.updatedAt || schedule.createdAt || null,
            generatedAt: data.generatedAt || null,
          });
          if (autoSaveTimerRef.current) {
            clearTimeout(autoSaveTimerRef.current);
            autoSaveTimerRef.current = null;
          }
          lastSavedSignatureRef.current = makeSignature(
            Array.isArray(defsForUI) ? defsForUI : data.rows || [],
            normalizedRemote.overrides || {},
            rosterForUI ?? null,
            data.preview ?? null,
            data.aiPlan ?? null,
            data.pins ?? [],
            data.rules ?? []
          );
          setAutoSaveStatus("idle");
          setAutoSaveError(null);
        } else {
          savedAssignmentsRef.current = [];
          setLastSavedInfo(null);
          setMonthlyReadModelState({ scheduleId: null, updatedAt: null, generatedAt: null });
          setRoster(null);
          setRosterBaseline(null);
          setAiPlan(readAiPlanFallback(year, month0));
          if (autoSaveTimerRef.current) {
            clearTimeout(autoSaveTimerRef.current);
            autoSaveTimerRef.current = null;
          }
          lastSavedSignatureRef.current = null;
          setAutoSaveStatus("dirty");
          setAutoSaveError(null);
        }
      } catch (err) {
        if (cancelled) return;
        if (err?.status === 404) {
          savedAssignmentsRef.current = [];
          setLastSavedInfo(null);
          setMonthlyReadModelState({ scheduleId: null, updatedAt: null, generatedAt: null });
          setRoster(null);
          setRosterBaseline(null);
          setAiPlan(readAiPlanFallback(year, month0));
          if (autoSaveTimerRef.current) {
            clearTimeout(autoSaveTimerRef.current);
            autoSaveTimerRef.current = null;
          }
          lastSavedSignatureRef.current = null;
          setAutoSaveStatus("dirty");
          setAutoSaveError(null);
        } else {
          console.error("[DutyRowsEditor] getMonthlySchedule err:", err);
          note(err?.message || "Sunucudan çizelge yüklenemedi.", "error");
          setAutoSaveStatus("error");
          setAutoSaveError(err?.message || "Sunucudan çizelge yüklenemedi.");
        }
      } finally {
        if (!cancelled) setLoadingRemote(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sectionId, serviceKey, role, year, month1, replaceAllDefs, note, remoteRevision]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!sectionId) {
        if (!cancelled) setRawGeneratedExplainability(createEmptyExplainability());
        return;
      }
      try {
        const generated = await getGeneratedSchedule({
          sectionId,
          serviceId: serviceKey,
          role,
          year,
          month: month1,
        });
        if (cancelled) return;
        setRawGeneratedExplainability(
          generated ? extractGeneratedExplainability(generated) : createEmptyExplainability()
        );
      } catch (err) {
        if (cancelled) return;
        if (err?.status !== 404) {
          console.error("[DutyRowsEditor] getGeneratedSchedule err:", err);
        }
        setRawGeneratedExplainability(createEmptyExplainability());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sectionId, serviceKey, role, year, month1]);
  // Backend personelini yerel motora (solver) tanıtmak için senkronizasyon
  useEffect(() => {
    let alive = true;
    async function syncStaffToLocal() {
      setStaffLoading(true);
      try {
        const staff = await fetchPersonnel({ active: true });
        if (!alive) return;
        const safe = Array.isArray(staff) ? staff : [];

        // Tüm personeli genel havuza kaydet
        localStorage.setItem("peopleV2", JSON.stringify(safe));

        // Solver'ın kullandığı anahtarlara (nurses/doctors) yazıyoruz
        const nurses = safe.filter((p) => {
          const r = (p.role || "").toLowerCase();
          const t = (p.title || "").toLowerCase();
          return r === "nurse" || r === "hemşire" || t === "hemşire" || t.includes("hemşire");
        });

        const doctors = safe.filter((p) => {
          const r = (p.role || "").toLowerCase();
          const t = (p.title || "").toLowerCase();
          return r === "doctor" || r === "doktor" || t === "doktor" || t.includes("doktor");
        });

        localStorage.setItem("nurses", JSON.stringify(nurses));
        localStorage.setItem("doctors", JSON.stringify(doctors));
        try { window.dispatchEvent(new Event("people:changed")); } catch {}
      } catch (e) {
        console.warn("Personel senkronizasyonu yapılamadı:", e);
      } finally {
        if (!alive) return;
        setStaffLoading(false);
        setStaffRevision((v) => v + 1);
      }
    }
    syncStaffToLocal();
    return () => {
      alive = false;
    };
  }, []);

  const canonicalStaffState = useMemo(
    () =>
      staffLoading
        ? { staff: [], sourceUsed: "loading", fallbackUsed: false }
        : ensureStaffInEngineStore(role),
    [role, staffLoading, staffRevision]
  );
  const staffAll = canonicalStaffState.staff;
  const staffForRole = useMemo(
    () => (staffAll || []).filter((s) => !s.role || s.role === role),
    [staffAll, role]
  );
  const canonicalIdNameMap = useMemo(() => buildIdToNameMap(staffForRole), [staffForRole]);

  const doSave = useCallback(async ({ silent = false, payloadOverride = null } = {}) => {
    if (!sectionId) {
      if (!silent) note("Sekme kimliği bulunamadı.", "error");
      else setAutoSaveStatus("error");
      return null;
    }
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    setSaving(true);
    try {
      // --- namedAssignments → assignments[] çevirisi ---
      // DutyRowsEditor namedAssignments üretiyor ama MonthlyHoursSheet ve
      // OvertimeTab assignments[] dizisine ihtiyaç duyuyor.
      // Kayıt sırasında her iki formatı da yazarak tüm alt sekmelerin
      // aynı veriyi okumasını sağlıyoruz.
      let mergedAssignments = Array.isArray(savedAssignmentsRef.current) ? [...savedAssignmentsRef.current] : [];
      const currentNamed = roster?.namedAssignments;
      if (currentNamed && typeof currentNamed === "object" && Object.keys(currentNamed).length > 0) {
        const fromNamed = namedToAssignments(currentNamed, rows, year, month1, {
          people: staffForRole,
          hoursForShift: createPlanWorkHourResolver(workingHours),
        });
        if (fromNamed.length > 0) {
          // namedAssignments'tan çevrilen veri daha güncel — onu kullan
          mergedAssignments = fromNamed;
        }
      }

      const payload = payloadOverride || {
        version: 1,
        defs: rows,
        overrides,
        assignments: mergedAssignments,
        roster,
        rosterBaseline: rosterBaseline || normalizeRosterData(roster),
        preview,
        aiPlan,
        pins,
        rules,
        generatedAt: new Date().toISOString(),
      };
      if (!payload.rosterBaseline) {
        payload.rosterBaseline = rosterBaseline || normalizeRosterData(payload.roster || roster);
      }

      // Pre-save validation (only on explicit saves, not silent auto-saves)
      if (!silent && !payload._forceOverride && mergedAssignments.length > 0) {
        try {
          const validation = await validateBatchSchedule({
            sectionId,
            serviceId: serviceKey,
            role,
            year,
            month: month1,
            assignments: mergedAssignments,
          });
          if (validation?.canForce && validation.violations?.length > 0) {
            const errorMessages = validation.violations.flatMap((v) =>
              v.errors.map((e) => `${v.personName || v.personId} (${v.date}): ${e}`)
            );
            setOverrideDialog({ open: true, errors: errorMessages, pendingPayload: { ...payload, _forceOverride: true } });
            setSaving(false);
            return null;
          }
        } catch { /* validation endpoint unavailable — proceed */ }
      }

      const meta = {
        role,
        daysInMonth,
        source: "DutyRowsEditor",
        ...(payload._forceOverride ? { forceOverride: true } : {}),
      };
      const saved = await saveMonthlySchedule({
        sectionId,
        serviceId: serviceKey,
        role,
        year,
        month: month1,
        data: payload,
        meta,
      });
      setLastSavedInfo({
        updatedAt: saved?.updatedAt || new Date().toISOString(),
        updatedBy: saved?.updatedBy || null,
      });
      lastSavedSignatureRef.current = makeSignature(
        payload.defs,
        payload.overrides,
        payload.roster,
        payload.preview,
        payload.aiPlan,
        payload.pins,
        payload.rules
      );
      // After successful backend save, evict draft localStorage entries for this month
      try {
        const mKey = `${year}-${String(month1).padStart(2, "0")}`;
        const flatAll = LS.get("generatedRosterFlat", {});
        const flatByRole = flatAll[role] || {};
        if (flatByRole[mKey]) {
          delete flatByRole[mKey];
          flatAll[role] = flatByRole;
          LS.set("generatedRosterFlat", flatAll);
        }
      } catch {}
      setAutoSaveStatus("saved");
      setAutoSaveError(null);
      if (!silent) note("Çizelge kaydedildi.", "success");
      return saved;
    } catch (err) {
      console.error("[DutyRowsEditor] saveMonthlySchedule err:", err);
      setAutoSaveStatus("error");
      setAutoSaveError(err?.message || "Çizelge kaydedilemedi.");
      if (!silent) note(err?.message || "Çizelge kaydedilemedi.", "error");
      throw err;
    } finally {
      setSaving(false);
    }
  }, [sectionId, serviceKey, role, year, month1, rows, overrides, roster, rosterBaseline, preview, aiPlan, pins, rules, daysInMonth, note, makeSignature]);

  useEffect(() => {
    if (autoSaveStatus !== "saved") return undefined;
    const timer = setTimeout(() => {
      setAutoSaveStatus("idle");
    }, 3000);
    return () => clearTimeout(timer);
  }, [autoSaveStatus]);

  useEffect(() => {
    if (!sectionId || loadingRemote) return;
    const sig = computeSignature();
    if (!sig) return;
    if (saving) return;
    if (sig === lastSavedSignatureRef.current) {
      if (autoSaveStatus === "dirty" || autoSaveStatus === "saving" || autoSaveStatus === "error") {
        setAutoSaveStatus("idle");
        setAutoSaveError(null);
      }
      return;
    }
    setAutoSaveStatus("dirty");
    setAutoSaveError(null);
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    autoSaveTimerRef.current = setTimeout(async () => {
      autoSaveTimerRef.current = null;
      setAutoSaveStatus("saving");
      try {
        await doSave({ silent: true });
      } catch {
        // doSave handles error state
      }
    }, 1200);

    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
  }, [sectionId, loadingRemote, saving, computeSignature, doSave, autoSaveStatus]);

  /* Parametrelerden satır üret (yoksa) */
  function ensureRowsFromParameters() {
    if (defs?.length) return 0;
    const areas = Array.isArray(workAreas) ? workAreas : [];
    const shifts = shiftOptions || [];
    if (!areas.length || !shifts.length) {
      note("Parametreler eksik: Çalışma Alanları / Çalışma Saatleri tanımlı olmalı.", "error");
      return 0;
    }
    const now = Date.now();
    const makeId = (i) => now + i + Math.floor(Math.random() * 1000);

    const newDefs = areas
      .map((a, i) => {
        const label = a?.name?.toString().trim();
        if (!label) return null;
        const defCount = clampSingleSlotCount(a?.required ?? 1);
        const code = pickDefaultShiftCode(a, shifts);
        return {
          id: makeId(i),
          label,
          shiftCode: code,
          defaultCount: defCount,
          pattern: [defCount, defCount, defCount, defCount, defCount, defCount, defCount],
          weekendOff: false,
          holidayPolicy: 'none',
        };
      })
      .filter(Boolean);

    if (!newDefs.length) {
      note("Parametrelerden satır türetilemedi (isimler boş).", "error");
      return 0;
    }
    replaceAllDefs(newDefs);

    setTimeout(() => {
      newDefs.forEach((r) => fillRowAllDays(r.id, r.defaultCount || 0));
    }, 0);

    return newDefs.length;
  }

  /* Imperative API (üst toolbar buradan çağıracak) */
  const doAi = () => doBuild();  // n8n/AI entegrasyonu sonra eklenecek
  const doAi_legacy = () => {
    try {
      generateAutoSchedule({ year, month1_12: month0 + 1, writeToLS: true });
      note("Otomatik Çalışma Çizelgesi oluşturuldu.", "success");
      refreshAiPlan();
    } catch (err) {
      note("Plan üretiminde hata: " + (err?.message || err), "error");
    }
  };
  const buildRosterFromBackend = useCallback((assignments, issues, defsSource = rows, candidateAudit = [], issueDiagnostics = []) => {
    const named = {};
    const defsList = Array.isArray(defsSource) ? defsSource : [];
    const knownPeople = staffForRole;
    const knownNameSet = new Set(
      (Array.isArray(knownPeople) ? knownPeople : [])
        .map((p) => canonName(p?.fullName || p?.name || ""))
        .filter(Boolean)
    );
    const rowLabelById = new Map(defsList.map((r) => [String(r.id), r.label || r.id]));
    const rowIdByLabel = new Map();
    defsList.forEach((r) => {
      const labelKey = norm(r?.label);
      if (labelKey && !rowIdByLabel.has(labelKey)) rowIdByLabel.set(labelKey, String(r?.id));
    });
    const rowIdByLabelShift = new Map(
      defsList.map((r) => [`${norm(r?.label)}|${norm(r?.shiftCode)}`, String(r?.id)])
    );
    (assignments || []).forEach((a) => {
      const date = a?.date || a?.day;
      if (!date) return;
      const day = Number(String(date).slice(8, 10));
      if (!Number.isFinite(day) || day < 1 || day > daysInMonth) return;
      const rawRowId = String(a.shiftId || a.rowId || "").trim();
      const shiftCode = String(a.shiftCode || a.shiftId || a.rowId || "").trim();
      const roleLabel = String(a.roleLabel || a.label || a.area || "").trim();
      const pairKey = `${norm(roleLabel)}|${norm(shiftCode)}`;
      const labelKey = norm(roleLabel);
      const rowId =
        (rawRowId && rowLabelById.has(rawRowId) ? rawRowId : "") ||
        rowIdByLabelShift.get(pairKey) ||
        rowIdByLabel.get(labelKey) ||
        String(a.shiftId || a.rowId || a.shiftCode || "");
      if (!rowId) return;
      if (!named[day]) named[day] = {};
      if (!named[day][rowId]) named[day][rowId] = [];
      const nm = a.personName || a.name || "";
      const canon = canonName(nm);
      if (
        nm &&
        !isGroupLabel(nm) &&
        canon &&
        (!knownNameSet.size || knownNameSet.has(canon))
      ) {
        named[day][rowId] = keepSingleAssignee([...named[day][rowId], nm]);
      }
    });

    const issueAuditMap = new Map();
    (Array.isArray(candidateAudit) ? candidateAudit : []).forEach((entry) => {
      const key = `${String(entry?.date || "")}|${String(entry?.shiftId || "")}`;
      if (!issueAuditMap.has(key)) issueAuditMap.set(key, []);
      issueAuditMap.get(key).push(entry);
    });
    const issueDiagnosticMap = new Map();
    (Array.isArray(issueDiagnostics) ? issueDiagnostics : []).forEach((entry) => {
      const key = `${String(entry?.date || "")}|${String(entry?.shiftId || "")}`;
      issueDiagnosticMap.set(key, entry);
    });

    const issueList = (issues || []).map((it) => {
      const date = it?.date || "";
      const day = Number(String(date).slice(8, 10));
      const rowId = String(it.shiftId || it.rowId || it.shiftCode || "");
      const label = rowLabelById.get(rowId) || rowId || "-";
      const reason = it.reason || (it.missing ? `Eksik ${it.missing}` : "");
      const issueKey = `${date}|${rowId}`;
      const auditSummary =
        summarizeIssueDiagnostic(issueDiagnosticMap.get(issueKey))
        || summarizeIssueAudit(issueAuditMap.get(issueKey) || []);
      return { day: day || 0, label, reason, auditSummary };
    });

    return { namedAssignments: named, issues: issueList };
  }, [rows, daysInMonth, role, staffForRole]);

  const mergeRosterNamedAssignments = useCallback((baseRoster, addonRoster) => {
    const normalizedBase = normalizeRosterData(baseRoster);
    const base = normalizedBase && typeof normalizedBase === "object" ? { ...normalizedBase } : {};
    const namedBase = base?.namedAssignments && typeof base.namedAssignments === "object"
      ? { ...base.namedAssignments }
      : {};
    const namedAddon = addonRoster?.namedAssignments && typeof addonRoster.namedAssignments === "object"
      ? addonRoster.namedAssignments
      : {};

    Object.entries(namedAddon).forEach(([dayKey, byRow]) => {
      if (!namedBase[dayKey] || typeof namedBase[dayKey] !== "object") namedBase[dayKey] = {};
      Object.entries(byRow || {}).forEach(([rowId, list]) => {
        const prev = Array.isArray(namedBase[dayKey][rowId]) ? namedBase[dayKey][rowId] : [];
        namedBase[dayKey][rowId] = keepSingleAssignee([...prev, ...(Array.isArray(list) ? list : [])]);
      });
    });

    const issues = [
      ...(Array.isArray(base?.issues) ? base.issues : []),
      ...(Array.isArray(addonRoster?.issues) ? addonRoster.issues : []),
    ];

    return { ...base, namedAssignments: namedBase, issues };
  }, []);

  const doBuild = async () => {
    if (staffLoading) {
      note("Personel listesi yükleniyor. Lütfen birkaç saniye sonra tekrar deneyin.", "info");
      return;
    }
    setBuildLoading(true);
    // UI'yi bloklamamak için bir tick bekle
    await new Promise((r) => setTimeout(r, 0));
    try {
    // İzinler backend'den gelebiliyor → build öncesi senkronize et
    await loadLeavesFromBackend();
    const added = ensureRowsFromParameters();
    const commitResult = await buildCommitThisMonth({ generateLocalRoster: false });
    const effectiveRows = Array.isArray(rows) ? rows : [];
    const effectiveOverrides = commitResult?.committedOverrides || overrides;
    const effectivePreview = commitResult?.previewData || preview;
    await doSave({
      silent: true,
      payloadOverride: {
        version: 1,
        defs: effectiveRows,
        overrides: effectiveOverrides,
        assignments: Array.isArray(savedAssignmentsRef.current) ? [...savedAssignmentsRef.current] : [],
        roster: null,
        preview: effectivePreview,
        aiPlan,
        pins,
        rules,
        generatedAt: new Date().toISOString(),
      },
    });
    const staff = staffForRole;
    const hasStaff = staff.length > 0;
    const hasServiceInfo = staff.some((s) =>
      String(s.serviceId || s.meta?.serviceId || s.meta?.service || "").trim()
    );
    let scopedStaff = staff;
    if (serviceKey && hasServiceInfo) {
      const filtered = staff.filter(
        (s) => String(s.serviceId || s.meta?.serviceId || s.meta?.service || "") === serviceKey
      );
      if (filtered.length) scopedStaff = filtered;
      else note("Servise göre personel bulunamadı, tüm personel kullanılıyor.", "warning");
    }

    const staffPayload = scopedStaff.map((s) => {
      const areas = Array.isArray(s.areas) ? s.areas : [];
      const shiftCodes = Array.isArray(s.shiftCodes) ? s.shiftCodes : [];
      const meta = { ...(s.meta || {}) };
      const active = s.active ?? s.isActive ?? meta.active ?? meta.isActive ?? null;
      const isActive = s.isActive ?? s.active ?? meta.isActive ?? meta.active ?? null;
      const status = s.status ?? meta.status ?? null;
      const stats = s.stats ?? meta.stats ?? null;
      const resolvedName = s.name || s.fullName || "";
      if (!meta.areas && areas.length) meta.areas = areas;
      if (!meta.shiftCodes && shiftCodes.length) meta.shiftCodes = shiftCodes;
      if (!meta.role && s.role) meta.role = s.role;
      if (!meta.serviceId && s.serviceId) meta.serviceId = s.serviceId;
      if (meta.active == null && active != null) meta.active = active;
      if (meta.isActive == null && isActive != null) meta.isActive = isActive;
      if (meta.status == null && status != null) meta.status = status;
      if (meta.stats == null && stats != null) meta.stats = stats;
      return {
        id: String(s.id || ""),
        name: resolvedName,
        fullName: resolvedName,
        role: s.role || "",
        active,
        isActive,
        status,
        serviceId: s.serviceId || "",
        stats,
        areas,
        shiftCodes,
        meta,
      };
    }).filter((s) => s.id && s.name);

    const dutyRules = readDutyRulesFromLS();
    const leavesByPerson = buildLeavesByPersonForMonth(year, month1, staffPayload);
    const staffWithMetaCount = staffPayload.filter(
      (s) => (s.areas && s.areas.length) || (s.shiftCodes && s.shiftCodes.length)
    ).length;
    if (staffPayload.length && staffWithMetaCount === 0) {
      note("Personel kartlarında alan/vardiya kodu yok. Uygunluk kontrolü sınırlı çalışır.", "warning");
    }

    // Pinleri sunucu formatına hazırla
    const pinnedAssignments = pins.map(p => {
      const r = rows.find(row => String(row.id) === String(p.rowId));
      if (!r) return null;
      const dayNum = Number(p.day);
      const dayStr = `${year}-${String(month0 + 1).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
      return {
        personId: String(p.personId),
        day: dayStr,
        dayNum: Number.isFinite(dayNum) ? dayNum : undefined,
        rowId: String(r.id),
        roleLabel: r.label,
        shiftCode: r.shiftCode
      };
    }).filter(Boolean);
    const supervisorConfig = LS.get("supervisorConfig", null);
    const supervisorPool = LS.get("supervisorPool", null);

    try {
      const schedulerPayload = {
        sectionId,
        role,
        year,
        month: month1,
        sync: true,
        dryRun: false,
        defs: effectiveRows,
        overrides: effectiveOverrides,
        shiftOptions,
        pins: pinnedAssignments, // Pinleri sunucuya gönder
        ...(supervisorConfig ? { supervisorConfig } : {}),
        ...(Array.isArray(supervisorPool) && supervisorPool.length ? { supervisorPool } : {}),
        ...(staffPayload.length ? { staff: staffPayload } : {}),
        ...(Object.keys(dutyRules || {}).length ? { rules: dutyRules } : {}),
        ...(Object.keys(leavesByPerson || {}).length ? { leavesByPerson } : {}),
      };
      if (serviceKey) schedulerPayload.serviceId = serviceKey;

      const res = await generateSchedulerPlan(schedulerPayload);
      const data = res?.data || res;
      if (data?.assignments?.length) {
        savedAssignmentsRef.current = Array.isArray(data.assignments) ? data.assignments : [];
        const rosterFromServer = buildRosterFromBackend(
          data.assignments,
          data.issues,
          rows,
          data.candidateAudit,
          data.issueDiagnostics
        );
        setRoster(rosterFromServer);
        setRosterBaseline(normalizeRosterData(rosterFromServer));
        const payload = {
          version: 1,
          defs: effectiveRows,
          overrides: effectiveOverrides,
          roster: rosterFromServer,
          rosterBaseline: normalizeRosterData(rosterFromServer),
          assignments: Array.isArray(data.assignments) ? data.assignments : [],
          preview: effectivePreview,
          aiPlan,
          pins,
          rules,
          generatedAt: new Date().toISOString(),
        };
        await doSave({ silent: true, payloadOverride: payload });
        await loadGeneratedExplainability();
        try {
          const monthKey = `${year}-${String(month0 + 1).padStart(2, "0")}`;
          LS.set("scheduleBuildTrigger", { ym: monthKey, ts: Date.now() });
          window.dispatchEvent(new Event("schedule:built"));
        } catch {}
        note(`${added ? `${added} satır eklendi, ` : ""}Liste oluşturuldu (server).`, "success");
        return;
      }

      // EĞER atama yok ama uyarılar (issues) varsa, bunları göster ki kullanıcı nedenini anlasın
      if (data?.issues?.length) {
        const rosterFromServer = buildRosterFromBackend([], data.issues, rows, data.candidateAudit, data.issueDiagnostics);
        setRoster(rosterFromServer);
        note("Plan oluşturulamadı, ancak uyarılar mevcut. 'Kişilere Atama' panelini inceleyin.", "warning");
        return;
      }

      note("Sunucu planı boş döndü. Yerel önizleme korunuyor.", "warning");
    } catch (err) {
      const validationDetails = Array.isArray(err?.details) && err.details.length
        ? err.details.join("\n")
        : Array.isArray(err?.body?.details) && err.body.details.length
          ? err.body.details.map((item) => item?.message).filter(Boolean).join("\n")
          : "";
      const errorMessage = validationDetails || err?.message || err;
      note("Sunucu planlama hatası: " + errorMessage, "error");
    }

    if (!hasStaff)
      note(`${added ? `${added} satır eklendi, ` : ""}Personel bulunamadı: Sadece sayısal liste üretildi.`, "info");
    } finally {
      setBuildLoading(false);
    }
  };
  const doExport = () => exportXlsx();
  const doImport = (file) => file && importFromTemplate(file);
  const doReset = () => {
    setOverrides({});
    setPreview(null);
    setRoster(null);
  };

  useImperativeHandle(ref, () => ({
    ai: doAi,
    build: doBuild,
    exportExcel: doExport,
    importTemplate: doImport,
    reset: doReset,
    save: doSave,
    analyze: () => setIsJusticeModalOpen(true),
    isSaving: () => saving,
    setYear,
    setMonth,
  }));

  const hasLastSaved = !!lastSavedInfo?.updatedAt;
  const shadowObservationCount = Array.isArray(generatedExplainability?.shadowAudit?.observations)
    ? generatedExplainability.shadowAudit.observations.length
    : 0;
  const explainabilityReady =
    generatedExplainability.candidateAudit.length > 0 ||
    shadowObservationCount > 0 ||
    generatedExplainability.selectedPolicyBreakdowns.length > 0;
  const showStatusBar =
    loadingRemote ||
    saving ||
    autoSaveStatus !== "idle" ||
    hasLastSaved ||
    explainabilityReady ||
    generatedExplainability.isStale;

  /* ===================== ŞABLON YÖNETİMİ ===================== */
  const TEMPLATES_KEY = "dutyRowTemplates";
  const [templateModal, setTemplateModal] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const templates = useMemo(() => LS.get(TEMPLATES_KEY, {}), [templateModal]);

  const handleSaveTemplate = useCallback(() => {
    const name = templateName.trim();
    if (!name) return;
    const all = LS.get(TEMPLATES_KEY, {});
    all[name] = { defs: JSON.parse(JSON.stringify(defs || [])), role, savedAt: new Date().toISOString() };
    LS.set(TEMPLATES_KEY, all);
    setTemplateName("");
    setTemplateModal(false);
  }, [defs, role, templateName]);

  const handleLoadTemplate = useCallback((name) => {
    const all = LS.get(TEMPLATES_KEY, {});
    const tpl = all[name];
    if (!tpl) return;
    if (!window.confirm(`"${name}" şablonu yüklensin mi? Mevcut satırlar değiştirilecek.`)) return;
    replaceAllDefs(tpl.defs || []);
    setTemplateModal(false);
  }, [replaceAllDefs]);

  const handleDeleteTemplate = useCallback((name) => {
    const all = LS.get(TEMPLATES_KEY, {});
    delete all[name];
    LS.set(TEMPLATES_KEY, all);
    setTemplateModal((v) => !v); // force re-render
    setTimeout(() => setTemplateModal((v) => !v), 0);
  }, []);

  /* ===================== UNDO / REDO ===================== */
  const historyRef = useRef([]); // [{defs, overrides}, ...]
  const historyIdxRef = useRef(-1);
  const skipHistoryRef = useRef(false);
  const historyDebounceRef = useRef(null);

  // defs veya overrides değiştiğinde 600ms debounce ile snapshot al
  useEffect(() => {
    if (skipHistoryRef.current) return;
    clearTimeout(historyDebounceRef.current);
    historyDebounceRef.current = setTimeout(() => {
      const snapshot = {
        defs: JSON.parse(JSON.stringify(defs || [])),
        overrides: JSON.parse(JSON.stringify(overrides || {})),
      };
      // Mevcut pozisyondan sonrasını sil (redo branch'ini temizle)
      historyRef.current = historyRef.current.slice(0, historyIdxRef.current + 1);
      historyRef.current.push(snapshot);
      if (historyRef.current.length > 30) historyRef.current.shift();
      historyIdxRef.current = historyRef.current.length - 1;
    }, 600);
  }, [defs, overrides]);

  const canUndo = historyIdxRef.current > 0;
  const canRedo = historyIdxRef.current < historyRef.current.length - 1;

  const handleUndo = useCallback(() => {
    if (historyIdxRef.current <= 0) return;
    historyIdxRef.current -= 1;
    const snap = historyRef.current[historyIdxRef.current];
    if (!snap) return;
    skipHistoryRef.current = true;
    replaceAllDefs(snap.defs || []);
    setOverrides(snap.overrides || {});
    setTimeout(() => { skipHistoryRef.current = false; }, 100);
  }, [replaceAllDefs]);

  const handleRedo = useCallback(() => {
    if (historyIdxRef.current >= historyRef.current.length - 1) return;
    historyIdxRef.current += 1;
    const snap = historyRef.current[historyIdxRef.current];
    if (!snap) return;
    skipHistoryRef.current = true;
    replaceAllDefs(snap.defs || []);
    setOverrides(snap.overrides || {});
    setTimeout(() => { skipHistoryRef.current = false; }, 100);
  }, [replaceAllDefs]);

  // Klavye kısayolları: Ctrl+Z undo, Ctrl+Y / Ctrl+Shift+Z redo
  useEffect(() => {
    const handler = (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      if (e.key === "z" && !e.shiftKey) { e.preventDefault(); handleUndo(); }
      if (e.key === "y" || (e.key === "z" && e.shiftKey)) { e.preventDefault(); handleRedo(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleUndo, handleRedo]);

  /* Render (toolbar yok) */
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
        Çalışma Çizelgesi — {roleLabel}
      </div>
      {showStatusBar && (
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
          {buildLoading && <span className="text-slate-600">Liste oluşturuluyor…</span>}
          {loadingRemote && <span>Sunucudan çizelge yükleniyor…</span>}
          {(saving || autoSaveStatus === "saving") && (
            <span className="text-sky-600">Otomatik kaydediliyor…</span>
          )}
          {!loadingRemote && !saving && autoSaveStatus === "dirty" && (
            <span className="text-amber-600">Kaydedilmemiş değişiklikler var, otomatik kaydedilecek…</span>
          )}
          {!loadingRemote && !saving && autoSaveStatus === "error" && (
            <span className="text-rose-600">
              Kaydetme hatası: {autoSaveError || "Bilinmeyen hata"}
            </span>
          )}
          {!loadingRemote && !saving && autoSaveStatus === "saved" && hasLastSaved && (
            <span>
              Otomatik kaydedildi: {formatDateTime(lastSavedInfo.updatedAt) || "-"}
              {lastSavedInfo?.updatedBy ? ` (kullanıcı: ${lastSavedInfo.updatedBy})` : ""}
            </span>
          )}
          {!loadingRemote && !saving && autoSaveStatus !== "saved" && hasLastSaved && (
            <span>
              Son kayıt: {formatDateTime(lastSavedInfo.updatedAt) || "-"}
              {lastSavedInfo?.updatedBy ? ` (kullanıcı: ${lastSavedInfo.updatedBy})` : ""}
            </span>
          )}
          {!loadingRemote && !saving && !hasLastSaved && autoSaveStatus === "idle" && (
            <span>Otomatik kaydetme aktif. İlk kayıt için değişiklik yapın.</span>
          )}
          {!loadingRemote && explainabilityReady && (
            <span className="text-slate-600">
              Explainability: {generatedExplainability.candidateAudit.length} slot audit, {shadowObservationCount} shadow observation, {generatedExplainability.selectedPolicyBreakdowns.length} policy trace
            </span>
          )}
          {!loadingRemote && generatedExplainability.isStale && (
            <span className="text-amber-700">
              Explainability uyarısı: bu trace mevcut monthly revision ile tam eşleşmeyebilir
              {generatedExplainability.staleReasons.length
                ? ` (${generatedExplainability.staleReasons.join(", ")})`
                : ""}
            </span>
          )}
        </div>
      )}

      {/* Hızlı aksiyonlar */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Geri Al / Yinele */}
        <button
          onClick={handleUndo}
          disabled={!canUndo}
          title="Geri Al (Ctrl+Z)"
          className="px-3 py-2 rounded border text-sm disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50"
        >
          ↩ Geri Al
        </button>
        <button
          onClick={handleRedo}
          disabled={!canRedo}
          title="Yinele (Ctrl+Y)"
          className="px-3 py-2 rounded border text-sm disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50"
        >
          ↪ Yinele
        </button>

        <button onClick={() => setTemplateModal(true)} className="px-3 py-2 rounded bg-emerald-600 text-white text-sm">
          Şablon
        </button>

        <button onClick={() => setSupOpen(true)} className="px-3 py-2 rounded bg-violet-600 text-white text-sm">
          Sorumlu Ayarları
        </button>
        <button onClick={() => setPinOpen(true)} className="px-3 py-2 rounded bg-sky-600 text-white text-sm">
          Sabitle (Pin)
        </button>

        {/* Satır-bazlı içe aktarma (G1) */}
        <input ref={assignmentRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={onAssignmentFile} />
        <button onClick={askAssignmentImport} className="px-3 py-2 rounded border hover:bg-slate-50 text-sm">
          Satır Bazlı İçe Aktar (G1)
        </button>

        {/* Overrides JSON */}
        <button onClick={exportOverridesJSON} className="px-3 py-2 rounded border hover:bg-slate-50 text-sm">
          Ayın Üst-Yazmalarını İndir (JSON)
        </button>
        <input
          ref={overridesFileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={onOverridesJsonFile}
        />
        <button onClick={() => overridesFileRef.current?.click()} className="px-3 py-2 rounded border hover:bg-slate-50 text-sm">
          JSON’dan Geri Yükle
        </button>
      </div>

      {/* Otomatik Plan (AI) — Önizleme */}
      <div className="rounded-lg border bg-white p-3">
        <div className="mb-2 flex items-center gap-2">
          <div className="text-sm font-medium">Otomatik Plan (AI) — Önizleme</div>
          <button className="ml-auto text-sm px-2 h-8 rounded border hover:bg-slate-50" onClick={refreshAiPlan}>
            Yenile
          </button>
          <button className="text-sm px-2 h-8 rounded border hover:bg-slate-50" onClick={hydrateAiNamesInLS}>
            İsimleri Doldur
          </button>
        </div>

        {!aiPlan ? (
          <div className="text-sm text-slate-500">
            Henüz bu yıl/ay için otomatik plan yok. Üstteki <b>Yapay Zeka Destekli Liste</b> ile oluşturun.
          </div>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50">
                  <th className="p-2 text-left whitespace-nowrap">Tarih</th>
                  <th className="p-2 text-left whitespace-nowrap">Görev (Servis)</th>
                  <th className="p-2 text-left">Vardiya</th>
                  <th className="p-2 text-left">Personel</th>
                  <th className="p-2 text-left">Not</th>
                </tr>
              </thead>
              <tbody>
                {aiPlan.rows.map((r, i) => {
                  const resolved = r.personName || peopleNameMap.get(r.personId) || "";
                  const safe = resolved && !isGroupLabel(resolved) ? resolved : "";
                  return (
                    <tr key={i} className="border-t">
                      <td className="p-2 whitespace-nowrap">{r.date}</td>
                      <td className="p-2 whitespace-nowrap">{r.serviceId || "-"}</td>
                      <td className="p-2">{r.shiftCode || "-"}</td>
                      <td className="p-2">{safe || <em>BOŞ</em>}</td>
                      <td className="p-2 text-slate-500">{r.note || ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {aiPlan?.meta?.personHours && (
              <div className="mt-3 text-xs text-slate-600">
                <b>Kişi Saatleri (toplam):</b>{" "}
                {Object.entries(aiPlan.meta.personHours).map(([pid, h], idx) => (
                  <span key={pid}>{idx ? ", " : ""}{pid}: {h} saat</span>
                ))}
              </div>
            )}
          </div>
        )}
        <p className="mt-2 text-[11px] text-slate-500">
          Not: Bu tablo <code>people/peopleV2</code>, <code>leaves/leavesV2</code>, <code>workAreas/workAreasV2</code> vb. anahtarlardan okunur; sonuç <code>scheduleRowsV2</code>’ye kaydedilir.
        </p>
      </div>

      {/* Sayısal Önizleme */}
      {preview && (
        <div className="rounded-lg border bg-white p-3">
          <div className="mb-2 flex items-center gap-2">
            <div className="text-sm font-medium">Oluşturulan Liste — (Sayı) Önizleme</div>
            <button className="ml-auto text-sm px-2 h-8 rounded border hover:bg-slate-50" onClick={() => setPreview(null)}>
              Gizle
            </button>
          </div>
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50">
                  {makeHeader().map((h, i) => (
                    <th key={i} className="p-2 border-b text-left whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const line = [r.label, r.shiftCode, r.defaultCount || 0];
                  for (let d = 1; d <= daysInMonth; d++) {
                    const wd = new Date(year, month0, d).getDay();
                    const i = monIndex(wd);
                    const pat = Array.isArray(r.pattern) ? r.pattern : Array(7).fill(r.defaultCount || 0);
                    let v = (overrides[r.id] || {})[d];
                    if (v == null) v = pat[i] ?? (r.defaultCount || 0);
                    if (r.weekendOff && (wd === 0 || wd === 6)) v = 0;
                    line.push(v);
                  }
                  return (
                    <tr key={r.id} className="border-t">
                      {line.map((cell, cIdx) => (
                        <td key={cIdx} className={`p-2 ${cIdx >= 3 ? "text-center" : ""} whitespace-nowrap`}>
                          {cell}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Kişilere Atama Önizleme */}
      {roster && (
        <div className="rounded-lg border bg-white p-3">
          <div className="mb-2 flex items-center gap-3">
            <div className="text-sm font-medium">Kişilere Atama — Önizleme</div>
            <div className="text-xs text-slate-500">Dengesiz / Boş kalanlar “Uyarılar”da listelenir.</div>
            <button className="ml-auto text-sm px-2 h-8 rounded border hover:bg-slate-50" onClick={() => setRoster(null)}>
              Gizle
            </button>
          </div>

          {!!(roster.issues?.length) && (
            <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 p-2 text-sm">
              <div className="font-medium mb-1 flex flex-wrap justify-between gap-2">
                <span>Uyarılar</span>
                <span className="text-xs font-normal text-amber-800 bg-amber-100 px-2 py-0.5 rounded">
                  {(() => {
                    let needed = 0;
                    rows.forEach((r) => {
                      const pat = Array.isArray(r.pattern) ? r.pattern : Array(7).fill(r.defaultCount || 0);
                      const ovr = overrides[r.id] || {};
                      for (let d = 1; d <= daysInMonth; d++) {
                        const wd = new Date(year, month0, d).getDay();
                        const weekend = wd === 0 || wd === 6;
                        if (r.weekendOff && weekend) continue;
                        let v = ovr[d] ?? pat[monIndex(wd)] ?? r.defaultCount ?? 0;
                        needed += Math.max(0, Number(v) || 0);
                      }
                    });
                    const st = staffForRole.length;
                    if (staffLoading) {
                      return `Talep: ${needed} nöbet / Personel: yükleniyor...`;
                    }
                    return `Talep: ${needed} nöbet / Personel: ${st} kişi (Ort: ${(st ? needed / st : 0).toFixed(1)})`;
                  })()}
                </span>
              </div>
              <ul className="list-disc pl-5 max-h-60 overflow-auto">
                {roster.issues.map((x, i) => (
                  <li key={i}>
                    Gün {x.day}, “{x.label}” için yeterli aday bulunamadı{ x.reason ? ` (${x.reason})` : "" }.
                    {x.auditSummary ? (
                      <div className="text-xs text-amber-900/80">
                        Neden özeti: {x.auditSummary}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {rosterDiffMeta.count > 0 && (
            <div className="mb-3 rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
              <div className="font-medium">
                İlk oluşturulan plana göre {rosterDiffMeta.count} hücrede manuel değişiklik var.
              </div>
              <div className="mt-1 text-xs text-sky-800">
                Mavi vurgulu hücreler sonradan güncellenen atamalardır. Hücrenin üstüne gelince ilk plan ve güncel kişi bilgisini görebilirsiniz.
              </div>
              {!!rosterDiffMeta.sample.length && (
                <div className="mt-2 text-xs text-sky-800">
                  Örnek: {rosterDiffMeta.sample
                    .map((item) => `Gün ${item.day} ${item.rowLabel}: ${item.before || "Boş"} -> ${item.after || "Boş"}`)
                    .join(" | ")}
                </div>
              )}
            </div>
          )}

          <div className="overflow-auto">
            <table className="min-w-[1600px] border-separate border-spacing-0 text-[12px]">
              <thead>
                <tr>
                  <th colSpan={3} className="border border-slate-300 bg-white px-3 py-2 text-left text-sm font-semibold text-slate-700">
                    {MONTHS_TR[month0]} {year}
                  </th>
                  <th
                    colSpan={daysInMonth + 1}
                    className="border border-slate-300 bg-slate-50 px-3 py-2 text-left text-sm font-semibold text-slate-800"
                  >
                    Çalışma Çizelgesi Önizleme
                  </th>
                </tr>
                <tr>
                  <th className="sticky left-0 z-20 border border-slate-300 bg-slate-100 px-3 py-2 text-left font-semibold text-slate-700">
                    Görev
                  </th>
                  <th className="sticky left-[220px] z-20 border border-slate-300 bg-slate-100 px-3 py-2 text-left font-semibold text-slate-700">
                    Saat
                  </th>
                  <th className="sticky left-[360px] z-20 border border-slate-300 bg-slate-100 px-3 py-2 text-center font-semibold text-slate-700">
                    Kod
                  </th>
                  {Array.from({ length: daysInMonth }).map((_x, idx) => {
                    const day = idx + 1;
                    const weekday = new Date(year, month0, day).getDay();
                    const headLabel = WD_TR[weekday];
                    const isWeekend = weekday === 0 || weekday === 6;
                    return (
                      <th
                        key={`head-${day}`}
                        className={`min-w-[112px] border border-slate-300 px-2 py-2 text-center font-semibold ${
                          isWeekend ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-700"
                        }`}
                      >
                        <div>{day}</div>
                        <div className="text-[10px] font-medium">{headLabel}</div>
                      </th>
                    );
                  })}
                  <th className="border border-slate-300 bg-slate-100 px-3 py-2 text-center font-semibold text-slate-700">
                    Toplam
                  </th>
                </tr>
              </thead>
              <tbody>
                {rosterDisplayRows.map((row) =>
                  Array.from({ length: row.depth }).map((_slot, slotIdx) => (
                    <tr key={`${row.id}-${slotIdx}`}>
                      {slotIdx === 0 && (
                        <td
                          rowSpan={row.depth}
                          className="sticky left-0 z-10 border border-slate-300 bg-white px-3 py-2 align-middle font-semibold text-slate-800"
                          style={{ minWidth: 220 }}
                        >
                          {row.label}
                        </td>
                      )}
                      {slotIdx === 0 && (
                        <td
                          rowSpan={row.depth}
                          className="sticky left-[220px] z-10 border border-slate-300 bg-white px-3 py-2 align-middle text-slate-600"
                          style={{ minWidth: 140 }}
                        >
                          {row.shiftHoursText || "-"}
                        </td>
                      )}
                      {slotIdx === 0 && (
                        <td
                          rowSpan={row.depth}
                          className="sticky left-[360px] z-10 border border-slate-300 bg-white px-3 py-2 text-center align-middle font-semibold text-slate-700"
                          style={{ minWidth: 64 }}
                        >
                          {row.shiftCode || "-"}
                        </td>
                      )}
                      {row.namesByDay.map((names, dayIdx) => {
                        const day = dayIdx + 1;
                        const weekday = new Date(year, month0, day).getDay();
                        const isWeekend = weekday === 0 || weekday === 6;
                        const name = names[slotIdx] || "";
                        const changeMeta = rosterDiffMeta.cellMap.get(rosterCellKey(row.id, day));
                        const isChangedCell = !!changeMeta && slotIdx === 0;
                        const title = isChangedCell
                          ? `Manuel güncelleme\nİlk plan: ${changeMeta.before || "Boş"}\nGüncel: ${changeMeta.after || "Boş"}`
                          : (name || "");
                        return (
                          <td
                            key={`${row.id}-${slotIdx}-${day}`}
                            title={title}
                            className={`border border-slate-200 px-2 py-2 text-center align-middle ${
                              isChangedCell
                                ? "bg-sky-100 text-sky-950 ring-1 ring-inset ring-sky-300"
                                : isWeekend
                                  ? "bg-amber-50/40"
                                  : "bg-white"
                            } ${name ? "text-slate-700" : "text-slate-300"}`}
                          >
                            {name ? (
                              <div className="space-y-1">
                                <div>{compactRosterDisplayName(name)}</div>
                                {isChangedCell && (
                                  <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-sky-700">
                                    Güncellendi
                                  </div>
                                )}
                              </div>
                            ) : isChangedCell ? (
                              <div className="space-y-1">
                                <div className="text-slate-400">-</div>
                                <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-sky-700">
                                  Güncellendi
                                </div>
                              </div>
                            ) : ""}
                          </td>
                        );
                      })}
                      {slotIdx === 0 && (
                        <td
                          rowSpan={row.depth}
                          className="border border-slate-300 bg-slate-50 px-3 py-2 text-center align-middle text-xs font-semibold text-slate-600"
                        >
                          {row.namesByDay.reduce((sum, names) => sum + names.length, 0)}
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Yeni Satır Ekle */}
      <div className="rounded-lg border bg-white p-3 flex flex-wrap items-end gap-3 shadow-sm">
          <div className="flex-1 min-w-[200px]">
            <div className="text-[11px] text-slate-500 mb-1 ml-1">Görev (Çalışma Alanı)</div>
            <select
              value={form.label}
              onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
              className="w-full h-9 rounded-lg border-slate-300 text-sm focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
            >
              <option value="">Seçin…</option>
              {areaOptions.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <div className="text-[11px] text-slate-500 mb-1 ml-1">Vardiya</div>
            <select
              value={form.shiftCode}
              onChange={(e) => setForm((f) => ({ ...f, shiftCode: e.target.value }))}
              className="w-full h-9 rounded-lg border-slate-300 text-sm focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
            >
              <option value="">Seçin…</option>
              {(shiftOptions || []).map((v) => (
                <option key={v.id || v.code} value={v.code}>
                  {v.code} ({v.start}–{v.end})
                </option>
              ))}
            </select>
          </div>
          <div className="w-[100px]">
            <div className="text-[11px] text-slate-500 mb-1 ml-1">Kişi Sayısı</div>
            <input
              type="number"
              min={0}
              value={form.defaultCount}
              onChange={(e) => setForm((f) => ({ ...f, defaultCount: Number(e.target.value || 0) }))}
              className="w-full h-9 rounded-lg border-slate-300 text-sm text-center focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
            />
          </div>
          <button onClick={addRow} className="h-9 px-4 rounded-lg bg-sky-600 text-white text-sm font-medium hover:bg-sky-700 transition-colors shadow-sm">
            Ekle
          </button>
      </div>

      {/* Düzenleme Grid’i (Pzt→Paz) */}
      <div className="rounded-lg border bg-white">
        <div className="p-3 text-sm font-medium border-b">Ayın Günleri (Pzt→Paz)</div>
        <div className="w-full overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50">
                <th className="p-2 text-left w-[240px]">Görev</th>
                <th className="p-2 text-left w-[200px]">Vardiya</th>
                <th className="p-2 text-center w-[150px]">Görevli Kişi</th>
                {Array.from({ length: 7 }).map((_, i) => (
                  <th key={i} className="p-2 text-center">
                    {HEAD_TR[i]}
                  </th>
                ))}
                <th className="p-2 text-center w-[170px]">İşlem</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={11} className="p-3 text-slate-500">
                    Henüz satır yok. Yukarıdan görev + vardiya ekleyin veya Excel'den içe aktarın.
                  </td>
                </tr>
              )}
              {rows.map((r, idx) => {
                const shiftText = r.shiftCode || "";
                const pat = Array.isArray(r.pattern) ? r.pattern : Array(7).fill(r.defaultCount || 0);
                const ovr = overrides[r.id] || {};
                const isOpen = r.id === editorRowId;
                return (
                  <React.Fragment key={r.id}>
                    <tr className="border-t align-top relative hover:bg-slate-50/50 transition-colors">
                    <td className="p-2 font-medium">{r.label}</td>
                    <td className="p-2">{shiftText}</td>
                    <td className="p-2 text-center">
                      <input
                        type="number"
                        min={0}
                        className="w-20 h-8 rounded border px-2 text-center"
                        value={Number(r.defaultCount || 0)}
                        onChange={(e) => {
                          const n = clampSingleSlotCount(e.target.value || 0);
                          updateDef(r.id, { defaultCount: n, pattern: Array(7).fill(n) });
                          fillRowAllDays(r.id, n);
                        }}
                        title="Varsayılan kişi sayısını değiştirir ve ayın tüm günlerine uygular"
                      />
                    </td>

                    {Array.from({ length: 7 }).map((_, i) => (
                      <td key={i} className="p-2">
                        <div className="flex flex-col gap-1">
                          {Array.from({ length: weekCount }).map((_, w) => {
                            const day = weekMatrix[w][i];
                            const wd = day ? new Date(year, month0, day).getDay() : null;
                            const locked = r.weekendOff && wd != null && (wd === 0 || wd === 6);
                            const value = day ? ovr[day] ?? (locked ? 0 : pat[i] ?? 0) : "";
                            return (
                              <div key={w} className="flex items-center gap-1">
                                <span className="w-6 text-[10px] text-slate-500 text-right">{day ?? ""}</span>
                                {day ? (
                                  <input
                                    type="number"
                                    min={0}
                                    className={`w-14 h-7 rounded border text-center ${locked ? "bg-slate-50 text-slate-400" : ""}`}
                                    value={value}
                                    onChange={(e) => {
                                      if (!locked) setCount(r.id, day, e.target.value);
                                    }}
                                    disabled={locked}
                                    title={locked ? "Hafta sonu bu satır çalışmaz" : ""}
                                  />
                                ) : (
                                  <div className="w-14 h-7 rounded border border-dashed bg-slate-50/60" />
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </td>
                    ))}

                    <td className="p-2">
                      <div className="inline-flex items-center gap-1">
                        <button
                          onClick={() => moveRow(r.id, "up")}
                          disabled={idx === 0}
                          className="h-8 w-8 rounded border bg-white disabled:opacity-40"
                          title="Yukarı taşı"
                        >
                          <ArrowUp className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => moveRow(r.id, "down")}
                          disabled={idx === rows.length - 1}
                          className="h-8 w-8 rounded border bg-white disabled:opacity-40"
                          title="Aşağı taşı"
                        >
                          <ArrowDown className="w-4 h-4" />
                        </button>
                        <button className="h-8 w-8 rounded border bg-white" title="Kopyala" onClick={() => duplicateRow(r.id)}>
                          <Copy className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setEditorRowId(isOpen ? null : r.id)}
                          className={`h-8 w-8 rounded border ${isOpen ? "bg-slate-100" : "bg-white"}`}
                          title="Satırı Düzenle"
                        >
                          <Settings className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => deleteRow(r.id)}
                          className="h-8 w-8 rounded border bg-rose-50 text-rose-700"
                          title="Sil"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-slate-50 border-b">
                      <td colSpan={11} className="p-3">
                        <div className="rounded-lg border bg-white shadow-sm p-3">
                          <div className="text-xs font-semibold text-slate-700 mb-2">Satırı Düzenle</div>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="text-xs text-slate-500">Görev</label>
                              <select
                                className="w-full h-9 rounded border px-2 mt-1"
                                value={r.label}
                                onChange={(e) => updateDef(r.id, { label: e.target.value })}
                              >
                                <option value="">Seçin…</option>
                                {areaOptions.map((a) => (
                                  <option key={a} value={a}>
                                    {a}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="text-xs text-slate-500">Vardiya</label>
                              <select
                                className="w-full h-9 rounded border px-2 mt-1"
                                value={r.shiftCode}
                                onChange={(e) => updateDef(r.id, { shiftCode: e.target.value })}
                              >
                                <option value="">Seçin…</option>
                                {(shiftOptions || []).map((v) => (
                                  <option key={v.id || v.code} value={v.code}>
                                    {v.code} ({v.start}–{v.end})
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="text-xs text-slate-500">Görevli Kişi (varsayılan)</label>
                              <input
                                type="number"
                                min={0}
                                className="w-full h-9 rounded border px-2 mt-1"
                                value={Number(r.defaultCount || 0)}
                                onChange={(e) => {
                                  const n = clampSingleSlotCount(e.target.value || 0);
                                  updateDef(r.id, { defaultCount: n, pattern: Array(7).fill(n) });
                                  fillRowAllDays(r.id, n);
                                }}
                              />
                            </div>
                            <div className="col-span-2">
                              <label className="text-xs text-slate-500">Sütun Deseni (Pzt…Paz)</label>
                              <div className="mt-1 grid grid-cols-7 gap-1">
                                {(r.pattern || [0, 0, 0, 0, 0, 0, 0]).map((val, i) => (
                                  <input
                                    key={i}
                                    type="number"
                                    min={0}
                                    className="h-9 rounded border px-2 text-center"
                                    value={isWeekendCol(i) && r.weekendOff ? 0 : val}
                                    onChange={(e) => !(isWeekendCol(i) && r.weekendOff) && setPatternValue(r.id, i, e.target.value)}
                                    disabled={isWeekendCol(i) && r.weekendOff}
                                  />
                                ))}
                              </div>
                              <div className="mt-2 flex items-center gap-2">
                                <input
                                  id={`wk-${r.id}`}
                                  type="checkbox"
                                  className="h-4 w-4"
                                  checked={!!r.weekendOff}
                                  onChange={(e) => {
                                    updateDef(r.id, { weekendOff: e.target.checked });
                                    if (e.target.checked) fillRowAllDays(r.id, r.defaultCount || 0);
                                  }}
                                />
                                <label htmlFor={`wk-${r.id}`} className="text-sm">
                                  Hafta sonu çalışmaz (Cmt·Paz = 0)
                                </label>
                              </div>
                              <div className="mt-2 flex items-center gap-2">
                                <label className="text-sm text-slate-600 shrink-0">Tatil politikası:</label>
                                <select
                                  className="h-8 rounded border px-2 text-sm"
                                  value={r.holidayPolicy || 'none'}
                                  onChange={(e) => updateDef(r.id, { holidayPolicy: e.target.value })}
                                >
                                  <option value="none">Normal (tatilde de çalışır)</option>
                                  <option value="full_off">Resmi tatillerde çalışmaz</option>
                                  <option value="all_off">Tüm tatillerde çalışmaz (arife dahil)</option>
                                  <option value="supervisor">Servis sorumlusu (H.sonu+tatil=yok, arife=yarım)</option>
                                </select>
                              </div>
                            </div>
                          </div>
                          <div className="mt-4 pt-3 border-t flex items-center gap-2">
                            <input
                              type="number"
                              min={0}
                              className="w-20 h-9 rounded border px-2 text-center"
                              value={bulkVal}
                              onChange={(e) => setBulkVal(e.target.value)}
                            />
                            <button className="h-9 px-3 rounded bg-slate-800 text-white text-sm" onClick={() => applyBulkToMonth(r.id)}>
                              Bu Aya Uygula
                            </button>
                            <select className="h-9 rounded border px-2" value={bulkTarget} onChange={(e) => setBulkTarget(e.target.value)}>
                              <option value="all">Tüm günler</option>
                              <option value="0">Pzt</option>
                              <option value="1">Sal</option>
                              <option value="2">Çar</option>
                              <option value="3">Per</option>
                              <option value="4">Cum</option>
                              <option value="5">Cmt</option>
                              <option value="6">Paz</option>
                            </select>
                            <button className="ml-auto text-sm font-medium text-slate-500 hover:text-slate-800 px-3 py-1.5 rounded hover:bg-slate-100 transition-colors" onClick={() => setEditorRowId(null)}>
                              Kapat
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Sorumlu Ayarları Paneli */}
      <SupervisorSetup 
        open={supOpen} 
        onClose={() => setSupOpen(false)} 
        role={role} 
        currentRules={rules}
        onSave={(newRules) => {
          setRules(newRules);
          LS.set("dutyRulesV2", newRules); // Solver için LS'yi güncelle
        }}
      />
      
      {/* Pinleme Modalı */}
      <PinningModal 
        open={pinOpen} 
        onClose={() => setPinOpen(false)}
        pins={pins}
        onAdd={(p) => setPins([...pins, p])}
        onRemove={(id) => setPins(pins.filter(p => p.id !== id))}
        people={staffAll}
        loading={staffLoading}
        rows={rows}
        daysInMonth={daysInMonth}
      />

      {/* Şablon Modal */}
      {templateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setTemplateModal(false)}>
          <div className="bg-white rounded-xl shadow-xl p-5 w-full max-w-sm space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-slate-800">Görev Satırı Şablonları</h3>

            {/* Kaydet */}
            <div className="space-y-2">
              <label className="text-sm text-slate-600">Mevcut satırları şablon olarak kaydet:</label>
              <div className="flex gap-2">
                <input
                  className="flex-1 h-9 rounded border px-3 text-sm"
                  placeholder="Şablon adı…"
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSaveTemplate()}
                />
                <button
                  onClick={handleSaveTemplate}
                  disabled={!templateName.trim()}
                  className="px-3 h-9 rounded bg-emerald-600 text-white text-sm disabled:opacity-40"
                >
                  Kaydet
                </button>
              </div>
            </div>

            {/* Yüklü şablonlar */}
            <div className="space-y-1">
              <label className="text-sm text-slate-600">Kayıtlı şablonlar:</label>
              {Object.keys(templates).length === 0 ? (
                <div className="text-xs text-slate-400 py-2">Henüz kaydedilmiş şablon yok.</div>
              ) : (
                <ul className="space-y-1 max-h-48 overflow-y-auto">
                  {Object.entries(templates).map(([name, tpl]) => (
                    <li key={name} className="flex items-center justify-between gap-2 rounded border px-3 py-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-slate-800 truncate">{name}</div>
                        <div className="text-[10px] text-slate-400">{tpl.role || "?"} · {tpl.defs?.length || 0} satır · {tpl.savedAt ? new Date(tpl.savedAt).toLocaleDateString("tr-TR") : ""}</div>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <button onClick={() => handleLoadTemplate(name)} className="px-2 py-1 rounded bg-sky-600 text-white text-xs">Yükle</button>
                        <button onClick={() => handleDeleteTemplate(name)} className="px-2 py-1 rounded bg-rose-100 text-rose-700 text-xs">Sil</button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <button onClick={() => setTemplateModal(false)} className="w-full py-2 rounded border text-sm hover:bg-slate-50">Kapat</button>
          </div>
        </div>
      )}

      <OverrideDialog
        open={overrideDialog.open}
        title="Kayıt Öncesi Kural İhlali"
        errors={overrideDialog.errors}
        onConfirm={async (reason) => {
          setOverrideDialog({ open: false, errors: [], pendingPayload: null });
          if (overrideDialog.pendingPayload) {
            await doSave({ payloadOverride: { ...overrideDialog.pendingPayload, overrideReason: reason } });
          }
        }}
        onCancel={() => setOverrideDialog({ open: false, errors: [], pendingPayload: null })}
      />
    </div>
  );
});

export default DutyRowsEditor;
