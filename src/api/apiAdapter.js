// src/api/apiAdapter.js
// G6'DA KULLANDIĞIN ENDPOINTLERİ BURAYA AYNI ŞEKİLDE UYARLA

import { getToken } from "../lib/api.js";
import { getApiBase, assertProdWriteAllowed } from "../lib/apiConfig.js";
import { LS } from "../utils/storage.js";

const API_BASE = (() => {
  if (typeof window !== "undefined" && window.__API_BASE__) return window.__API_BASE__;
  return getApiBase();
})();

const makeUrl = (pathAndQuery) => {
  if (!API_BASE || /^https?:\/\//i.test(pathAndQuery)) return pathAndQuery;
  const base = API_BASE.replace(/\/+$/, "");
  const path = pathAndQuery.startsWith("/") ? pathAndQuery : `/${pathAndQuery}`;
  return `${base}${path}`;
};

async function httpRequest(pathAndQuery, { method = "GET", body, token, headers } = {}) {
  assertProdWriteAllowed(pathAndQuery, method);
  const finalHeaders = { ...(headers || {}) };
  const authToken = token || getToken();
  if (authToken && !finalHeaders.Authorization) finalHeaders.Authorization = `Bearer ${authToken}`;
  if (body != null && !finalHeaders["Content-Type"]) finalHeaders["Content-Type"] = "application/json";

  const res = await fetch(makeUrl(pathAndQuery), {
    method,
    credentials: "include",
    headers: finalHeaders,
    body: body == null
      ? undefined
      : typeof body === "string"
        ? body
        : JSON.stringify(body),
  });

  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }

  if (!res.ok) {
    const err = new Error((data && (data.message || data.error)) || `HTTP ${res.status}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }

  return data;
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
    return items.map((p) => ({
      id: p.id,
      fullName: p.fullName ?? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim(),
      title: p.title ?? p.title_name ?? "",
      role: p.role ?? p.departmentRole ?? "",
      service: p.service ?? p.department ?? "",
      phone: p.phone || "",
      email: p.email || "",
    }));
  } catch (err) {
    if (err?.status !== 404) console.error("fetchPersonnel err:", err);
    return [];
  }
}

/* ================= Monthly Schedule (vardiya) ================= */
// Dönüş beklenen: [{ date:"YYYY-MM-DD", hours: number }, ...]
export async function fetchMonthlySchedule({ personId, year, month, token } = {}) {
  try {
    // TODO: G6'da kullandığın endpoint ile değiştir
    // ör: /api/schedule/monthly?personId=&y=&m=
    const qs = new URLSearchParams({ personId, y: String(year), m: String(month) });
    const data = await httpRequest(`/api/schedule/monthly?${qs.toString()}`, { token });

    // Şemaya göre map et
    // ör: {items:[{date:"2025-09-01", hours:8}, ...]}
    const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
    return items.map((x) => ({ date: x.date, hours: Number(x.hours || 0) }));
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
// Dönüş beklenen: [{ date:"YYYY-MM-DD", kind:"full"|"arife"|"half", name?:string }]
export async function fetchHolidayCalendar({ year, month, token } = {}) {
  try {
    // TODO: G6'da tatil/arife nereden geliyorsa burayla değiştir
    const qs = new URLSearchParams({ y: String(year) });
    if (month != null) qs.append("m", String(month));
    const data = await httpRequest(`/api/holidays?${qs.toString()}`, { token });

    const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
    const mapped = items.map((h) => ({
      date: h.date,
      kind: h.kind === "arife" ? "arife" : h.kind === "half" ? "half" : "full",
      name: h.name,
    }));
    if (mapped.length) return mapped;
    const local = LS.get("holidayCalendarV1", []);
    return (local || []).filter((h) => (h.date || "").startsWith(`${year}-${String(month).padStart(2, "0")}`));
  } catch (err) {
    if (err?.status !== 404) console.error("fetchHolidayCalendar err:", err);
    const local = LS.get("holidayCalendarV1", []);
    return (local || []).filter((h) => (h.date || "").startsWith(`${year}-${String(month).padStart(2, "0")}`));
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
  return payload?.schedule || null;
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
  const data = await httpRequest(`/api/duty-rules`, {
    method: "PUT",
    body,
    token,
  });
  return data;
}
