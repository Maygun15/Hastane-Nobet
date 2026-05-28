// src/components/DutyRowsEditor.utils.js
// DutyRowsEditor.jsx'ten ayıklanan saf yardımcı fonksiyonlar ve sabitler

import { LS } from "../utils/storage.js";
import { STAFF_KEY } from "../engine/rosterEngine.js";
import { getPeople, buildPeopleFromLeaves } from "../lib/dataResolver.js";
import {
  getAllLeaves,
  leavesToUnavailable as leavesToUnavailableByPid,
  buildNameUnavailability,
} from "../lib/leaves.js";

/* ===== Görsel sabitler ===== */
export const WD_TR = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];
export const HEAD_TR = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];
export const MONTHS_TR = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
export const DUTY_RULES_LS_KEY = "dutyRulesV2";

/* ===== İsim normalizasyonu ===== */
export const norm = (s) => (s || "").toString().trim().toLocaleUpperCase("tr-TR");
export const stripDiacritics = (str) =>
  (str || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/Ğ/g, "G").replace(/Ü/g, "U").replace(/Ş/g, "S").replace(/İ/g, "I")
    .replace(/Ö/g, "O").replace(/Ç/g, "C")
    .replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ş/g, "s").replace(/ı/g, "i")
    .replace(/ö/g, "o").replace(/ç/g, "c");
export const canonName = (s) =>
  stripDiacritics((s || "").toString())
    .toLocaleLowerCase("tr-TR")
    .replace(/\s+/g, " ")
    .trim();

export const isPlainLowercaseName = (s = "") => {
  const raw = String(s || "").trim();
  if (!raw) return false;
  const letters = stripDiacritics(raw).replace(/[^A-Za-z]/g, "");
  if (!letters) return false;
  return letters === letters.toLowerCase() && letters !== letters.toUpperCase();
};
export const choosePreferredDisplayName = (current, candidate) => {
  if (!current) return candidate;
  if (!candidate) return current;
  if (isPlainLowercaseName(current) && !isPlainLowercaseName(candidate)) return candidate;
  return current;
};
export const mergeDisplayNameLists = (base = [], addon = []) => {
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
export const keepSingleAssignee = (names = []) => {
  const merged = mergeDisplayNameLists([], names);
  return merged.length ? [merged[0]] : [];
};

/* ===== Roster normalize ===== */
export const normalizeRosterNamedAssignments = (namedAssignments) => {
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
export const normalizeRosterData = (roster) => {
  if (!roster || typeof roster !== "object") return roster || null;
  return {
    ...roster,
    namedAssignments: normalizeRosterNamedAssignments(roster.namedAssignments),
  };
};

/* ===== Tarih yardımcıları ===== */
export const monIndex = (wdSun0) => (wdSun0 + 6) % 7;
export const pad2 = (n) => String(n).padStart(2, "0");

export function normalizeMonthAnyBase(value, { preferOneBased } = { preferOneBased: true }) {
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

export const isWeekendCol = (i) => i === 5 || i === 6;
export const isGroupLabel = (nm) =>
  !!nm &&
  /^(hemşire(ler)?|hemsire(ler)?|doktor(lar)?|personel|nurses?|doctors?)$/i.test(
    String(nm).trim()
  );
export const compactRosterDisplayName = (name) => {
  const raw = String(name || "").trim();
  if (!raw) return "";
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return raw;
  const first = parts[0];
  const last = parts[parts.length - 1];
  const compact = `${first} ${last.charAt(0)}.`;
  return compact.length < raw.length ? compact : raw;
};
export const clampSingleSlotCount = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return 1;
};
export const formatDateTime = (iso) => {
  if (!iso) return null;
  const dt = new Date(iso);
  return Number.isNaN(dt.getTime()) ? null : dt.toLocaleString("tr-TR");
};

/* ===== Duty def normalize ===== */
export function normalizeDutyDefsAndOverrides(defs = [], overrides = {}) {
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

/* ===== Kural normalize ===== */
export function mapRulesToBackend(list) {
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

export function readDutyRulesFromLS() {
  try {
    const raw = JSON.parse(localStorage.getItem(DUTY_RULES_LS_KEY) || "[]");
    const out = mapRulesToBackend(raw);
    if (out?.ONE_SHIFT_PER_DAY === false) delete out.ONE_SHIFT_PER_DAY;
    return out;
  } catch {
    return {};
  }
}

/* ===== İzin yardımcıları ===== */
export function buildLeavesByPersonForMonth(year, month1, people = []) {
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

/* ===== Takvim grid ===== */
export function buildWeekGrid(y, m0) {
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

export function dayFromAny(dateLike, year, month0) {
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
    const dd = +m[1], MM = +m[2] - 1;
    let yyyy = +m[3];
    if (yyyy < 100) yyyy += 2000;
    if (yyyy === year && MM === month0) return dd;
  }
  const m2 = s.match(/^(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})$/);
  if (m2) {
    const yyyy = +m2[1], MM = +m2[2] - 1, dd = +m2[3];
    if (yyyy === year && MM === month0) return dd;
  }
  return null;
}

export function buildUnavailableByDay(year, month0) {
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

/* ===== Vardiya yardımcıları ===== */
export function pickDefaultShiftCode(area, shifts) {
  return (
    area?.defaultShift ||
    (shifts || []).find((s) => s.code === "M")?.code ||
    (shifts || [])[0]?.code ||
    "M"
  );
}

/* ===== Açıklanabilirlik ===== */
export function createEmptyExplainability() {
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

export const ISSUE_REASON_LABELS = {
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

export function formatIssueReason(code) {
  const normalized = String(code || "").trim().toUpperCase();
  return ISSUE_REASON_LABELS[normalized] || normalized || null;
}

export function summarizeIssueAudit(audits = []) {
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
        const normalized = String(code || "").trim().toUpperCase().replace(/_EXCEEDED$/, "");
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

export function summarizeIssueDiagnostic(diagnostic = null) {
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

export function extractGeneratedExplainability(scheduleDoc) {
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

export function parseTimestamp(value) {
  if (!value) return null;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : null;
}

export function getExplainabilityStaleReasons({
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
    if (skewMs > 60 * 1000) reasons.push("GENERATED_RUN_TIMESTAMP_MISMATCH");
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

export function applyExplainabilityGuard({
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
  return { ...base, isStale: staleReasons.length > 0, staleReasons };
}

/* ===== Personel normalize ===== */
export function normalizeRoleHint(rawRole, fallbackRole = null) {
  const value = String(rawRole || "").trim().toLocaleLowerCase("tr-TR");
  if (!value) return fallbackRole;
  if (value === "doctor" || value === "doktor" || value.includes("doktor")) return "Doctor";
  if (
    value === "nurse" || value === "hemşire" || value === "hemsire" ||
    value.includes("hemşire") || value.includes("hemsire")
  ) return "Nurse";
  return fallbackRole;
}

export function normalizeFromParamTable(x, role) {
  const name = x?.fullName || x?.name || x?.["AD SOYAD"];
  if (!name || isGroupLabel(name)) return null;
  const id = x?.id ?? x?.pid ?? x?.tc ?? x?.tcNo ?? x?.code ?? name;
  const serviceIdRaw =
    x?.serviceId ?? x?.service ?? x?.department ?? x?.departmentId ?? x?.sectionId ??
    x?.meta?.serviceId ?? x?.meta?.service ?? "";
  const areasText = x?.areas || x?.workAreas || x?.["ÇALIŞMA ALANLARI"] || "";
  const shiftsText =
    x?.shiftCodes || x?.codes || x?.shifts || x?.["VARDİYE KODLARI"] || x?.["VARDIYE KODLARI"] ||
    x?.meta?.shiftCodes || x?.meta?.shifts || "";
  const areas = typeof areasText === "string"
    ? areasText.split(/[;,/-]/).map((s) => s.trim()).filter(Boolean)
    : Array.isArray(areasText) ? areasText : [];
  const shiftCodes = typeof shiftsText === "string"
    ? shiftsText.split(/[;,/-]/).map((s) => s.trim()).filter(Boolean)
    : Array.isArray(shiftsText) ? shiftsText : [];
  return {
    id: String(id),
    name: String(name),
    role: normalizeRoleHint(
      x?.role || x?.title || x?.departmentRole || x?.meta?.role || x?.meta?.title || x?.meta?.unvan,
      role === "Doctor" ? "Doctor" : "Nurse"
    ),
    serviceId: String(serviceIdRaw || ""),
    service: String(serviceIdRaw || ""),  // runPlannerOnce uyumluluğu için alias
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

export function ensureStaffInEngineStore(activeRole) {
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
    if (raw.length) sourceUsed = "canonicalV2-filtered";
  }

  let staff = raw
    .map((x) => normalizeFromParamTable(x, activeRole))
    .filter(Boolean);

  if (!staff.length) {
    const ppl = getPeople() || [];
    staff = ppl
      .filter((p) => {
        if (!p.name && !p.fullName) return false;
        const r = normalizeRoleHint(
          p?.role || p?.title || p?.departmentRole || p?.meta?.role || p?.meta?.title || p?.meta?.unvan,
          null
        );
        return !r || r === activeRole;
      })
      .map((p) => normalizeFromParamTable(p, activeRole))
      .filter(Boolean);
    if (staff.length) sourceUsed = "getPeople-fallback";
  }

  if (!staff.length) {
    try {
      const all = getAllLeaves();
      const peopleLeaveFallback = buildPeopleFromLeaves(all, activeRole);
      staff = peopleLeaveFallback.map((p) => normalizeFromParamTable(p, activeRole)).filter(Boolean);
      if (staff.length) {
        sourceUsed = "leaves-fallback";
        fallbackUsed = true;
      }
    } catch {}
  }

  const seen = new Set();
  staff = staff.filter((p) => {
    if (!p.id || seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
  staff = (staff || []).filter((s) => s?.name && !isGroupLabel(s.name));
  staff.sort((a, b) => (a.name || "").localeCompare(b.name || "", "tr"));
  LS.set(STAFF_KEY, staff);
  return { staff, sourceUsed, fallbackUsed };
}

export function buildIdToNameMap(preferredPeople = null) {
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
    const id = p?.id ?? p?.pid ?? p?.tc ?? p?.tcNo ?? p?.code ?? (p?.["AD SOYAD"] || p?.fullName || p?.name);
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

export function readAiPlanFallback(year, month0) {
  const saved = LS.get("scheduleRowsV2");
  if (saved && saved.year === year && saved.month === month0 + 1) return saved;
  return null;
}
