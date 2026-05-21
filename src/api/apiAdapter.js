// src/api/apiAdapter.js

import { http } from "../lib/api.js";
import { LS } from "../utils/storage.js";
import { invalidateScheduleCache } from "../store/monthlyScheduleModel.js";

// Thin wrapper: api.js'nin retry + token-refresh mantığını kullanır,
// eski httpRequest hata şeklini (err.body, err.details) korur.
async function httpRequest(pathAndQuery, { method = "GET", body, token, headers, signal } = {}) {
  try {
    return await http.req(pathAndQuery, {
      method,
      body,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(headers || {}),
      },
      signal,
      credentials: "include",
    });
  } catch (err) {
    if (err.data && !err.body) {
      err.body = err.data;
      err.details = Array.isArray(err.data?.details)
        ? err.data.details.map((item) => item?.message).filter(Boolean)
        : [];
    }
    throw err;
  }
}

function buildScheduleMutationDetail({ sectionId, serviceId = "", role = "", date = "", year, month }) {
  const resolvedYear = Number.isFinite(Number(year)) ? Number(year) : parseInt(String(date || "").slice(0, 4), 10);
  const resolvedMonth = Number.isFinite(Number(month)) ? Number(month) : parseInt(String(date || "").slice(5, 7), 10);
  return {
    sectionId: String(sectionId || "").trim(),
    serviceId: String(serviceId || "").trim(),
    role: String(role || "").trim(),
    year: Number.isFinite(resolvedYear) ? resolvedYear : null,
    month: Number.isFinite(resolvedMonth) ? resolvedMonth : null,
    ts: Date.now(),
  };
}

function emitScheduleMutation(detail) {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent("schedule:saved", { detail }));
    window.dispatchEvent(new Event("planner:changed"));
    localStorage.setItem("scheduleLastSaved", JSON.stringify(detail));
  } catch {}
}

function normalizeSwapSuggestionPayload(payload = {}) {
  const slot = payload?.slot && typeof payload.slot === "object" ? payload.slot : {};
  const currentPerson =
    payload?.currentPerson && typeof payload.currentPerson === "object"
      ? payload.currentPerson
      : {};
  const legacySuggestions = Array.isArray(payload?.suggestions) ? payload.suggestions : [];
  const candidates = Array.isArray(payload?.candidates)
    ? payload.candidates
    : legacySuggestions.map((item) => ({
        id: String(item?.personId || "").trim(),
        name: String(item?.personName || "").trim(),
        title: "",
        service: "",
        monthlyShiftCount: Number(item?.shiftCount || 0) || 0,
        eligible: item?.eligible !== false,
        warnings: Array.isArray(item?.warnings) ? item.warnings : [],
      }));
  const recommendedCandidates = Array.isArray(payload?.recommendedCandidates)
    ? payload.recommendedCandidates
    : candidates.filter((item) => item?.eligible !== false);
  const samePositionAlternatives = Array.isArray(payload?.samePositionAlternatives)
    ? payload.samePositionAlternatives
    : candidates.filter((item) => item?.recommendationTier === "same_position_blocked");

  const normalizeCandidate = (item = {}) => ({
    id: String(item?.id || item?.personId || "").trim(),
    name: String(item?.name || item?.personName || "").trim(),
    title: String(item?.title || "").trim(),
    service: String(item?.service || item?.serviceId || "").trim(),
    monthlyShiftCount: Number(item?.monthlyShiftCount ?? item?.shiftCount ?? 0) || 0,
    eligible: item?.eligible !== false,
    warnings: Array.isArray(item?.warnings) ? item.warnings : [],
    recommendationTier: String(item?.recommendationTier || (item?.eligible === false ? "mismatch" : "recommended")).trim(),
    samePositionFit: item?.samePositionFit !== false,
  });

  return {
    ok: payload?.ok !== false,
    slot: {
      date: String(slot?.date || payload?.date || "").slice(0, 10),
      taskLabel: String(slot?.taskLabel || "").trim(),
      shiftCode: String(slot?.shiftCode || payload?.shiftId || "").trim(),
      rowId: String(slot?.rowId || "").trim(),
      serviceId: String(slot?.serviceId || "").trim(),
    },
    currentPerson: {
      id: String(currentPerson?.id || "").trim(),
      name: String(currentPerson?.name || "").trim(),
    },
    candidates: candidates.map(normalizeCandidate),
    recommendedCandidates: recommendedCandidates.map(normalizeCandidate),
    samePositionAlternatives: samePositionAlternatives.map(normalizeCandidate),
    recommendationText: String(payload?.recommendationText || "").trim(),
    message: String(payload?.message || "").trim(),
  };
}

/* ================= Personnel ================= */
export async function fetchPersonnel({
  unitId,
  active = true,
  search = "",
  page = 1,
  size = 500,
  token,
} = {}) {
  try {
    const qs = new URLSearchParams();
    // ÖNEMLİ: boşsa parametreyi göndermiyoruz (backend 0 kayıt döndürebilir)
    if (unitId && String(unitId).trim() !== "") qs.append("unitId", String(unitId));
    qs.append("active", String(active));
    if (search) qs.append("q", search);
    qs.append("page", String(page));
    qs.append("size", String(size));

    const data = await httpRequest(`/api/personnel?${qs.toString()}`, { token });
    // G6 şemasına göre map et (items veya dizi)
    const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
    return items.map((p) => {
      const fullName = p.fullName ?? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim();
      // serviceId her zaman string olarak normalize edilir (number/string karışıklığını önler)
      const serviceId = String(p.serviceId ?? p.service ?? p.department ?? p.meta?.serviceId ?? p.meta?.service ?? "").trim();
      return {
        id: String(p.id || p._id || p.personId || "").trim(),
        name: p.name ?? fullName,
        fullName,
        title: p.title ?? p.title_name ?? "",
        role: p.role ?? p.departmentRole ?? p.meta?.role ?? p.meta?.unvan ?? p.meta?.title ?? "",
        service: serviceId,
        serviceId,
        active: p.active ?? p.isActive ?? p.meta?.active ?? p.meta?.isActive ?? null,
        isActive: p.isActive ?? p.active ?? p.meta?.isActive ?? p.meta?.active ?? null,
        status: p.status ?? p.meta?.status ?? null,
        stats: p.stats ?? p.meta?.stats ?? null,
        areas: p.areas ?? p.meta?.areas ?? p.workAreas ?? p.meta?.workAreas ?? [],
        workAreaIds: p.workAreaIds ?? p.meta?.workAreaIds ?? [],
        shiftCodes: p.shiftCodes ?? p.meta?.shiftCodes ?? p.meta?.shifts ?? [],
        meta: p.meta ?? {},
        phone: p.phone || "",
        email: p.email || "",
      };
    });
  } catch (err) {
    if (err?.status !== 404) console.error("fetchPersonnel err:", err);
    return [];
  }
}

/* ================= Monthly Schedule (vardiya) ================= */
// Dönüş beklenen: [{ date:"YYYY-MM-DD", hours: number }, ...]
export async function fetchMonthlySchedule({ personId, year, month, token } = {}) {
  try {
    const qs = new URLSearchParams({
      sectionId: "calisma-cizelgesi",
      year: String(year),
      month: String(month),
    });
    // MonthlySchedule is keyed by section/service/role/month on the backend.
    // Keep personId here only as a client-side assignment filter for consumers
    // like overtime reporting; do not send a misleading no-op query param.
    const payload = await httpRequest(`/api/schedules/monthly?${qs.toString()}`, { token });

    const data = payload?.schedule?.data || {};
    const assignments = Array.isArray(data?.assignments) ? data.assignments : [];
    const shiftOptions = Array.isArray(data?.shiftOptions) ? data.shiftOptions : [];

    const hoursByShift = new Map();
    for (const s of shiftOptions) {
      const key = String(s?.code || s?.id || "").trim();
      const h = Number(s?.hours);
      if (key && Number.isFinite(h)) hoursByShift.set(key, h);
    }

    const byDate = new Map();
    for (const a of assignments) {
      const pid = String(a?.personId || "").trim();
      if (!pid || String(personId) !== pid) continue;
      const date = String(a?.date || a?.day || "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

      const explicitHours = Number(a?.hours);
      const shiftKey = String(a?.shiftCode || a?.shiftId || a?.shift || a?.code || "").trim();
      const inferredHours = hoursByShift.get(shiftKey);
      const hours = Number.isFinite(explicitHours)
        ? explicitHours
        : Number.isFinite(inferredHours)
          ? inferredHours
          : 0;

      byDate.set(date, (byDate.get(date) || 0) + hours);
    }

    return Array.from(byDate.entries())
      .map(([date, hours]) => ({ date, hours }))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  } catch (err) {
    if (err?.status !== 404) console.error("fetchMonthlySchedule err:", err);
    return [];
  }
}

/* ================= Scheduler (backend) ================= */
// Dönüş beklenen: { ok:true, data:{ assignments, issues, ... } }
export async function generateSchedulerPlan(payload = {}, { token } = {}) {
  const data = await httpRequest(`/api/scheduler/generate`, {
    method: "POST",
    body: payload,
    token,
  });
  return data;
}

/* ================= Holidays (resmî tatil / arife / yarım gün) ================= */

// Türkiye sabit milli tatilleri — her yıl aynı tarihte
const TR_FIXED_HOLIDAYS = [
  { mm: "01", dd: "01", name: "Yılbaşı" },
  { mm: "04", dd: "23", name: "Ulusal Egemenlik ve Çocuk Bayramı" },
  { mm: "05", dd: "01", name: "Emek ve Dayanışma Bayramı" },
  { mm: "05", dd: "19", name: "Atatürk'ü Anma, Gençlik ve Spor Bayramı" },
  { mm: "07", dd: "15", name: "Demokrasi ve Millî Birlik Günü" },
  { mm: "08", dd: "30", name: "Zafer Bayramı" },
  { mm: "10", dd: "28", name: "Cumhuriyet Bayramı Arifesi", kind: "arife" },
  { mm: "10", dd: "29", name: "Cumhuriyet Bayramı" },
];

// Dini bayramlar — hicri takvime bağlı, yıl bazlı sabit liste (2024-2028)
// Arife 1 gün önce, bayram günleri "full" olarak işaretlendi.
const TR_RELIGIOUS_HOLIDAYS = {
  2024: [
    { date: "2024-04-09", kind: "arife", name: "Ramazan Bayramı Arifesi" },
    { date: "2024-04-10", kind: "full",  name: "Ramazan Bayramı 1. Gün" },
    { date: "2024-04-11", kind: "full",  name: "Ramazan Bayramı 2. Gün" },
    { date: "2024-04-12", kind: "full",  name: "Ramazan Bayramı 3. Gün" },
    { date: "2024-06-16", kind: "arife", name: "Kurban Bayramı Arifesi" },
    { date: "2024-06-17", kind: "full",  name: "Kurban Bayramı 1. Gün" },
    { date: "2024-06-18", kind: "full",  name: "Kurban Bayramı 2. Gün" },
    { date: "2024-06-19", kind: "full",  name: "Kurban Bayramı 3. Gün" },
    { date: "2024-06-20", kind: "full",  name: "Kurban Bayramı 4. Gün" },
  ],
  2025: [
    { date: "2025-03-29", kind: "arife", name: "Ramazan Bayramı Arifesi" },
    { date: "2025-03-30", kind: "full",  name: "Ramazan Bayramı 1. Gün" },
    { date: "2025-03-31", kind: "full",  name: "Ramazan Bayramı 2. Gün" },
    { date: "2025-04-01", kind: "full",  name: "Ramazan Bayramı 3. Gün" },
    { date: "2025-06-05", kind: "arife", name: "Kurban Bayramı Arifesi" },
    { date: "2025-06-06", kind: "full",  name: "Kurban Bayramı 1. Gün" },
    { date: "2025-06-07", kind: "full",  name: "Kurban Bayramı 2. Gün" },
    { date: "2025-06-08", kind: "full",  name: "Kurban Bayramı 3. Gün" },
    { date: "2025-06-09", kind: "full",  name: "Kurban Bayramı 4. Gün" },
  ],
  2026: [
    { date: "2026-03-18", kind: "arife", name: "Ramazan Bayramı Arifesi" },
    { date: "2026-03-19", kind: "full",  name: "Ramazan Bayramı 1. Gün" },
    { date: "2026-03-20", kind: "full",  name: "Ramazan Bayramı 2. Gün" },
    { date: "2026-03-21", kind: "full",  name: "Ramazan Bayramı 3. Gün" },
    { date: "2026-05-26", kind: "arife", name: "Kurban Bayramı Arifesi" },
    { date: "2026-05-27", kind: "full",  name: "Kurban Bayramı 1. Gün" },
    { date: "2026-05-28", kind: "full",  name: "Kurban Bayramı 2. Gün" },
    { date: "2026-05-29", kind: "full",  name: "Kurban Bayramı 3. Gün" },
    { date: "2026-05-30", kind: "full",  name: "Kurban Bayramı 4. Gün" },
  ],
  2027: [
    { date: "2027-03-07", kind: "arife", name: "Ramazan Bayramı Arifesi" },
    { date: "2027-03-08", kind: "full",  name: "Ramazan Bayramı 1. Gün" },
    { date: "2027-03-09", kind: "full",  name: "Ramazan Bayramı 2. Gün" },
    { date: "2027-03-10", kind: "full",  name: "Ramazan Bayramı 3. Gün" },
    { date: "2027-05-15", kind: "arife", name: "Kurban Bayramı Arifesi" },
    { date: "2027-05-16", kind: "full",  name: "Kurban Bayramı 1. Gün" },
    { date: "2027-05-17", kind: "full",  name: "Kurban Bayramı 2. Gün" },
    { date: "2027-05-18", kind: "full",  name: "Kurban Bayramı 3. Gün" },
    { date: "2027-05-19", kind: "full",  name: "Kurban Bayramı 4. Gün" },
  ],
  2028: [
    { date: "2028-02-24", kind: "arife", name: "Ramazan Bayramı Arifesi" },
    { date: "2028-02-25", kind: "full",  name: "Ramazan Bayramı 1. Gün" },
    { date: "2028-02-26", kind: "full",  name: "Ramazan Bayramı 2. Gün" },
    { date: "2028-02-27", kind: "full",  name: "Ramazan Bayramı 3. Gün" },
    { date: "2028-05-03", kind: "arife", name: "Kurban Bayramı Arifesi" },
    { date: "2028-05-04", kind: "full",  name: "Kurban Bayramı 1. Gün" },
    { date: "2028-05-05", kind: "full",  name: "Kurban Bayramı 2. Gün" },
    { date: "2028-05-06", kind: "full",  name: "Kurban Bayramı 3. Gün" },
    { date: "2028-05-07", kind: "full",  name: "Kurban Bayramı 4. Gün" },
  ],
};

function trFixedHolidaysForYear(year) {
  const fixed = TR_FIXED_HOLIDAYS.map((h) => ({
    date: `${year}-${h.mm}-${h.dd}`,
    kind: h.kind || "full",
    name: h.name,
    _builtin: true,
  }));
  const religious = (TR_RELIGIOUS_HOLIDAYS[year] || []).map((h) => ({ ...h, _builtin: true }));
  return [...fixed, ...religious];
}

function mergeHolidays(builtins, userDefined) {
  const map = new Map(builtins.map((h) => [h.date, h]));
  for (const h of userDefined || []) {
    if (h?.date) map.set(h.date, { ...map.get(h.date), ...h, _builtin: false });
  }
  return Array.from(map.values());
}

// Dönüş beklenen: [{ date:"YYYY-MM-DD", kind:"full"|"arife"|"half", name?:string }]
export async function fetchHolidayCalendar({ year, month, token } = {}) {
  const pad = (n) => String(n).padStart(2, "0");
  const prefix = month != null ? `${year}-${pad(month)}` : null;
  const builtins = trFixedHolidaysForYear(year);
  const local = LS.get("holidayCalendarV1", []);

  try {
    const qs = new URLSearchParams({ y: String(year) });
    if (month != null) qs.append("m", String(month));
    const data = await httpRequest(`/api/holidays?${qs.toString()}`, { token });
    const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
    const remote = items.map((h) => ({
      date: h.date,
      kind: h.kind === "arife" ? "arife" : h.kind === "half" ? "half" : "full",
      name: h.name,
    }));
    const merged = mergeHolidays(builtins, [...(local || []), ...remote]);
    return prefix ? merged.filter((h) => (h.date || "").startsWith(prefix)) : merged;
  } catch (err) {
    if (err?.status !== 404) console.error("fetchHolidayCalendar err:", err);
    const merged = mergeHolidays(builtins, local || []);
    return prefix ? merged.filter((h) => (h.date || "").startsWith(prefix)) : merged;
  }
}

/* ================= Leaves (Toplu İzin) ================= */
// Dönüş beklenen: [{ start:"YYYY-MM-DD", end:"YYYY-MM-DD", type:"annual|...", partial:"none|half_am|half_pm|hours", hours?:number }]
export async function fetchLeaves({ personId, year, month, token } = {}) {
  try {
    // TODO: G6'da izinleri nereden çekiyorsan aynı endpoint
    const qs = new URLSearchParams({ personId, y: String(year), m: String(month) });
    const data = await httpRequest(`/api/leaves?${qs.toString()}`, { token });

    const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
    return items.map((lv) => ({
      start: lv.start,
      end: lv.end ?? lv.start,
      type: lv.type ?? "annual",
      partial: (lv.partial ?? "none").toLowerCase(), // none | half_am | half_pm | hours
      hours: lv.hours != null ? Number(lv.hours) : null,
    }));
  } catch (err) {
    if (err?.status !== 404) console.error("fetchLeaves err:", err);
    return [];
  }
}

/* ================= Monthly Schedule Storage ================= */
// MonthlySchedule remains the operational read model for editable roster/snapshot data.
export async function getMonthlySchedule({
  sectionId,
  serviceId = "",
  role = "",
  year,
  month,
} = {}) {
  if (!sectionId) throw new Error("sectionId gerekli");
  const qs = new URLSearchParams({
    sectionId,
    year: String(year),
    month: String(month),
  });
  if (serviceId !== undefined && serviceId !== null) qs.append("serviceId", String(serviceId));
  if (role !== undefined && role !== null) qs.append("role", String(role));

  const payload = await httpRequest(`/api/schedules/monthly?${qs.toString()}`);
  return payload?.schedule || null;
}

export async function getGeneratedSchedule({
  sectionId,
  serviceId = "",
  role = "",
  year,
  month,
} = {}) {
  if (!sectionId) throw new Error("sectionId gerekli");
  const qs = new URLSearchParams({ sectionId });
  if (year != null) qs.append("year", String(year));
  if (month != null) qs.append("month", String(month));
  if (serviceId !== undefined && serviceId !== null) qs.append("serviceId", String(serviceId));
  if (role !== undefined && role !== null) qs.append("role", String(role));

  // GeneratedSchedule is the authoritative explainability/full scheduler output read path.
  const payload = await httpRequest(`/api/schedules/generated?${qs.toString()}`);
  return payload?.data || null;
}

/**
 * Assignment koleksiyonundan aylık atama listesi döner.
 * scheduleTruth.js için SSOT okuma ucu.
 */
export async function getAssignmentsForMonth({
  sectionId,
  serviceId = "",
  role = "",
  year,
  month,
} = {}) {
  if (!sectionId) throw new Error("sectionId gerekli");
  const qs = new URLSearchParams({
    sectionId,
    year: String(year),
    month: String(month),
  });
  if (serviceId != null) qs.append("serviceId", String(serviceId));
  if (role != null && role !== "") qs.append("role", String(role));
  const payload = await httpRequest(`/api/schedules/assignments?${qs.toString()}`);
  return Array.isArray(payload?.assignments) ? payload.assignments : [];
}

export async function saveMonthlySchedule({
  sectionId,
  serviceId = "",
  role = "",
  year,
  month,
  data,
  meta,
} = {}) {
  if (!sectionId) throw new Error("sectionId gerekli");
  const body = {
    sectionId,
    serviceId,
    role,
    year,
    month,
    data: data ?? {},
    meta: meta ?? {},
  };
  const payload = await httpRequest("/api/schedules/monthly", {
    method: "PUT",
    body,
  });
  invalidateScheduleCache(year, month);
  if (typeof window !== "undefined") {
    try {
      const detail = { sectionId, serviceId, role, year, month, ts: Date.now() };
      window.dispatchEvent(new CustomEvent("schedule:saved", { detail }));
      localStorage.setItem("scheduleLastSaved", JSON.stringify(detail));
    } catch {}
  }
  return payload?.schedule || null;
}

/* ================= Manual Assignments ================= */
export async function assignSchedule({
  sectionId,
  serviceId = "",
  role = "",
  date,
  rowId,
  shiftId,
  shiftCode,
  previousShiftId,
  replacePersonId,
  replacePersonName,
  replaceShiftId,
  replaceShiftCode,
  replaceRoleLabel,
  personId,
  personName,
  roleLabel,
  note,
  pinned,
  force = false,
  overrideReason = "",
} = {}) {
  if (!sectionId) throw new Error("sectionId gerekli");
  if (!date) throw new Error("date gerekli");
  if (!shiftId && !shiftCode) throw new Error("shiftId gerekli");
  if (!personId) throw new Error("personId gerekli");
  const body = {
    sectionId,
    serviceId,
    role,
    date,
    ...(rowId ? { rowId } : {}),
    shiftId: shiftId || shiftCode,
    shiftCode,
    ...(previousShiftId ? { previousShiftId } : {}),
    ...(replacePersonId ? { replacePersonId } : {}),
    ...(replacePersonName ? { replacePersonName } : {}),
    ...(replaceShiftId ? { replaceShiftId } : {}),
    ...(replaceShiftCode ? { replaceShiftCode } : {}),
    ...(replaceRoleLabel ? { replaceRoleLabel } : {}),
    personId,
    personName,
    roleLabel,
    note,
    ...(pinned !== undefined ? { pinned } : {}),
    ...(force ? { force: true, overrideReason: overrideReason || "" } : {}),
  };
  const result = await httpRequest("/api/schedules/assign", { method: "POST", body });
  const detail = buildScheduleMutationDetail({ sectionId, serviceId, role, date });
  if (detail.year && detail.month) invalidateScheduleCache(detail.year, detail.month);
  emitScheduleMutation(detail);
  return result;
}

export async function unassignSchedule({
  sectionId,
  serviceId = "",
  role = "",
  date,
  shiftId,
  shiftCode,
  personId,
  personName,
} = {}) {
  if (!sectionId) throw new Error("sectionId gerekli");
  if (!date) throw new Error("date gerekli");
  if (!shiftId && !shiftCode) throw new Error("shiftId gerekli");
  if (!personId) throw new Error("personId gerekli");
  const body = {
    sectionId,
    serviceId,
    role,
    date,
    shiftId: shiftId || shiftCode,
    shiftCode,
    personId,
    ...(personName ? { personName } : {}),
  };
  const result = await httpRequest("/api/schedules/assign", { method: "DELETE", body });
  const detail = buildScheduleMutationDetail({ sectionId, serviceId, role, date });
  if (detail.year && detail.month) invalidateScheduleCache(detail.year, detail.month);
  emitScheduleMutation(detail);
  return result;
}

/* ================= Duty Rules ================= */
export async function fetchDutyRules({
  sectionId,
  serviceId = "",
  role = "",
  token,
} = {}) {
  if (!sectionId) throw new Error("sectionId gerekli");
  const qs = new URLSearchParams({ sectionId });
  if (serviceId !== undefined && serviceId !== null) qs.append("serviceId", String(serviceId));
  if (role !== undefined && role !== null) qs.append("role", String(role));
  const data = await httpRequest(`/api/duty-rules?${qs.toString()}`, { token });
  return data;
}

export async function saveDutyRules({
  sectionId,
  serviceId = "",
  role = "",
  rules = {},
  weights = {},
  enabled = true,
  departman,
  description,
  basicRules,
  leaveRules,
  shiftRules,
  taskRequirements,
  personnelRules,
  metadata,
  token,
} = {}) {
  if (!sectionId) throw new Error("sectionId gerekli");
  const body = {
    sectionId,
    serviceId,
    role,
    rules,
    weights,
    enabled,
  };
  if (departman !== undefined) body.departman = departman;
  if (description !== undefined) body.description = description;
  if (basicRules !== undefined) body.basicRules = basicRules;
  if (leaveRules !== undefined) body.leaveRules = leaveRules;
  if (shiftRules !== undefined) body.shiftRules = shiftRules;
  if (taskRequirements !== undefined) body.taskRequirements = taskRequirements;
  if (personnelRules !== undefined) body.personnelRules = personnelRules;
  if (metadata !== undefined) body.metadata = metadata;
  const data = await httpRequest(`/api/duty-rules`, {
    method: "PUT",
    body,
    token,
  });
  return data;
}

export async function testDutyRules(payload = {}, { token } = {}) {
  return httpRequest(`/api/duty-rules/test`, {
    method: "POST",
    body: payload,
    token,
  });
}

export async function validateDutyShift(payload = {}, { token } = {}) {
  return httpRequest(`/api/duty-rules/validate-shift`, {
    method: "POST",
    body: payload,
    token,
  });
}

export async function checkDutyEligibility(payload = {}, { token } = {}) {
  return httpRequest(`/api/duty-rules/check-eligibility`, {
    method: "POST",
    body: payload,
    token,
  });
}

// ===== SWAP SUGGESTIONS =====
export async function validateBatchSchedule({ sectionId, serviceId, role, year, month, assignments } = {}) {
  if (!sectionId || !year || !month) throw new Error("sectionId, year, month gerekli");
  return httpRequest("/api/schedules/validate-batch", {
    method: "POST",
    body: { sectionId, serviceId: serviceId || "", role: role || "", year, month, assignments: assignments || [] },
  });
}

export async function getPersonCalendar({ personId, sectionId, year, month, serviceId, role } = {}) {
  if (!personId || !year || !month) throw new Error("personId, year, month gerekli");
  const qs = new URLSearchParams({ personId, year, month });
  if (sectionId) qs.set("sectionId", sectionId);
  if (serviceId != null) qs.set("serviceId", serviceId);
  if (role) qs.set("role", role);
  const payload = await httpRequest(`/api/schedules/person-calendar?${qs.toString()}`);
  return payload?.assignments || [];
}

export async function getSwapSuggestions({ personId, currentPersonName, date, shiftId, roleLabel, serviceId, role, sectionId, limit } = {}) {
  if ((!personId && !currentPersonName) || !date || !shiftId) {
    throw new Error("personId/currentPersonName, date, shiftId gerekli");
  }
  const payload = await httpRequest("/api/scheduler/swap-suggestions", {
    method: "POST",
    body: {
      ...(personId ? { personId } : {}),
      date, shiftId,
      ...(currentPersonName ? { currentPersonName } : {}),
      ...(roleLabel ? { roleLabel } : {}),
      ...(serviceId ? { serviceId } : {}),
      ...(role ? { role } : {}),
      ...(sectionId ? { sectionId } : {}),
      ...(limit ? { limit } : {}),
    },
  });
  return normalizeSwapSuggestionPayload(payload);
}

// ===== REQUESTS =====
export async function getMyRequests() {
  return httpRequest('/api/requests');
}

export async function createRequest(payload = {}) {
  return httpRequest('/api/requests', { method: 'POST', body: payload });
}

export async function updateRequest(id, payload = {}) {
  return httpRequest(`/api/requests/${id}`, { method: 'PUT', body: payload });
}

export async function getUnreadRequestCount() {
  return httpRequest('/api/requests/unread-count');
}

// ─── PLANNINGS ──────────────────────────────────────────────────────────────

export async function getPlannings(params = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') qs.set(k, v);
  }
  const query = qs.toString() ? `?${qs}` : '';
  return httpRequest(`/api/plannings${query}`);
}

export async function getPlanning(id) {
  return httpRequest(`/api/plannings/${id}`);
}

export async function createPlanning(payload = {}) {
  return httpRequest('/api/plannings', { method: 'POST', body: payload });
}

export async function updatePlanning(id, payload = {}) {
  return httpRequest(`/api/plannings/${id}`, { method: 'PUT', body: payload });
}

export async function deletePlanning(id) {
  return httpRequest(`/api/plannings/${id}`, { method: 'DELETE' });
}

export async function getPlanningTasks(planningId) {
  return httpRequest(`/api/plannings/tasks/list?planningId=${planningId}`);
}

export async function createPlanningTask(payload = {}) {
  return httpRequest('/api/plannings/tasks', { method: 'POST', body: payload });
}

export async function updatePlanningTask(id, payload = {}) {
  return httpRequest(`/api/plannings/tasks/${id}`, { method: 'PUT', body: payload });
}

export async function patchPlanningTaskStatus(id, status) {
  return httpRequest(`/api/plannings/tasks/${id}/status`, { method: 'PATCH', body: { status } });
}

export async function deletePlanningTask(id) {
  return httpRequest(`/api/plannings/tasks/${id}`, { method: 'DELETE' });
}

export async function checkPlanningTaskConflicts(payload = {}) {
  return httpRequest('/api/plannings/tasks/check-conflicts', { method: 'POST', body: payload });
}

// ─── LEAVE BALANCES ─────────────────────────────────────────────────────────

export async function getLeaveBalances(params = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') qs.set(k, v);
  }
  const query = qs.toString() ? `?${qs}` : '';
  return httpRequest(`/api/leave-balances${query}`);
}

export async function createLeaveBalance(data) {
  return httpRequest('/api/leave-balances', { method: 'POST', body: data });
}

export async function updateLeaveBalance(id, data) {
  return httpRequest(`/api/leave-balances/${id}`, { method: 'PUT', body: data });
}

export async function patchLeaveBalanceUse(id, days) {
  return httpRequest(`/api/leave-balances/${id}/use`, { method: 'PATCH', body: { days } });
}

export async function deleteLeaveBalance(id) {
  return httpRequest(`/api/leave-balances/${id}`, { method: 'DELETE' });
}
