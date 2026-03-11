// src/tabs/PlanTab.jsx
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useAuth } from "../auth/AuthContext.jsx";
import useServiceScope from "../hooks/useServiceScope.js";
import useActiveYM from "../hooks/useActiveYM.js";
import { getAllLeaves } from "../lib/leaves.js";
import ScheduleToolbar from "../components/ScheduleToolbar.jsx";
import PersonScheduleCalendar from "../components/PersonScheduleCalendar.jsx";
import { API } from "../lib/api.js";
import { runPlannerOnce } from "../lib/runPlannerOnce.js";
import { saveMonthlySchedule } from "../api/apiAdapter.js";
import { services as STATIC_SERVICES } from "../constants/enums.js";

const MONTH_LABEL = (year, month) =>
  `${Intl.DateTimeFormat("tr-TR", { month: "long" }).format(new Date(year, month - 1, 1))} ${year}`;

function stripDiacritics(str = "") {
  return str.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}
function canonName(str = "") {
  return stripDiacritics(str).toLocaleUpperCase("tr-TR").replace(/\s+/g, " ").trim();
}
function canonService(str = "") {
  return stripDiacritics(String(str || "")).toLocaleUpperCase("tr-TR").replace(/\s+/g, " ").trim();
}

function normalizePersonRecord(p, index) {
  if (!p) return null;
  const idCandidates = [
    p.id,
    p.personId,
    p.pid,
    p.tc,
    p.tcNo,
    p.tcno,
    p.TCKN,
    p.kod,
    p.code,
  ]
    .map((v) => (v == null ? "" : String(v).trim()))
    .filter(Boolean);
  const id = idCandidates[0] || String(index + 1);
  const nameCandidates = [
    p.fullName,
    p.name,
    p.displayName,
    p.personName,
    [p.firstName, p.lastName].filter(Boolean).join(" "),
    p["Ad Soyad"],
    p["AD SOYAD"],
    p["ad soyad"],
  ]
    .map((v) => (v == null ? "" : String(v).trim()))
    .filter(Boolean);
  const name = nameCandidates[0] || id;
  const service = String(
    p.service ??
      p.serviceId ??
      p.department ??
      p.departmentId ??
      p.sectionId ??
      p.servis ??
      p.Servis ??
      ""
  ).trim();
  return {
    id,
    name,
    canon: canonName(name),
    raw: p,
    service,
  };
}

function splitByRole(items) {
  const nurses = [];
  const doctors = [];
  const seenNurses = new Map();
  const seenDoctors = new Map();
  (items || []).forEach((p, idx) => {
    if (!p) return;
    const meta = p?.meta || {};
    const roleHint = String(meta.role || p.title || p.role || "").toLowerCase();
    const isDoctor = /doktor|doctor|hekim|tabip/.test(roleHint);
    const idRaw = p.id || p._id || p.personId || String(idx + 1);
    const nameRaw = p.fullName || p.name || p.displayName || "";
    const name = nameRaw || String(idRaw);
    const serviceId = String(p.serviceId || p.service || meta.serviceId || meta.service || "");
    const areas =
      p.areas ??
      p.workAreas ??
      meta.areas ??
      meta.workAreas ??
      p["ÇALIŞMA ALANLARI"] ??
      p["CALISMA ALANLARI"] ??
      "";
    const shiftCodes =
      p.shiftCodes ??
      p.shifts ??
      meta.shiftCodes ??
      meta.shifts ??
      p["VARDİYE KODLARI"] ??
      p["VARDIYE KODLARI"] ??
      "";
    const code =
      meta.code ??
      p.code ??
      p.kod ??
      p.personCode ??
      meta.personCode ??
      meta.tc ??
      p.tc ??
      p.tcNo ??
      "";
    const mapped = {
      id: String(idRaw),
      name,
      fullName: name,
      service: serviceId,
      serviceId,
      areas,
      shiftCodes,
      code,
      meta,
      canon: canonName(name),
    };
    const key = `${mapped.canon}::${mapped.serviceId || mapped.service || ""}`;
    const targetList = isDoctor ? doctors : nurses;
    const targetMap = isDoctor ? seenDoctors : seenNurses;
    if (targetMap.has(key)) {
      const existing = targetMap.get(key);
      const score = (x) => {
        const areaScore = Array.isArray(x?.areas) ? (x.areas.length ? 1 : 0) : (x?.areas ? 1 : 0);
        const shiftScore = Array.isArray(x?.shiftCodes) ? (x.shiftCodes.length ? 1 : 0) : (x?.shiftCodes ? 1 : 0);
        const codeScore = x?.code ? 1 : 0;
        return areaScore + shiftScore + codeScore;
      };
      if (score(mapped) > score(existing)) {
        targetMap.set(key, mapped);
      }
    } else {
      targetMap.set(key, mapped);
    }
  });
  nurses.push(...seenNurses.values());
  doctors.push(...seenDoctors.values());
  return { nurses, doctors };
}

function buildCountsFromPattern(def, year, month0) {
  const pattern = Array.isArray(def?.pattern) ? def.pattern : null;
  if (!pattern || pattern.length !== 7) return undefined;
  const counts = {};
  const daysInMonth = new Date(year, month0 + 1, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(year, month0, d).getDay(); // 0=Sun
    const monIdx = (dow + 6) % 7; // 0=Mon
    const v = Number(pattern[monIdx]);
    if (Number.isFinite(v)) counts[d] = v;
  }
  return counts;
}

function isServiceSupervisorTaskLabel(label = "") {
  const normalized = String(label || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  return normalized.includes("servis sorumlu");
}

const HALF_DAY_A_HOURS = 4;

function normalizeHolidayKind(row = {}) {
  const kind = String(row?.kind || "").toLowerCase().trim();
  const name = String(row?.name || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

  if (name.includes("arife")) return "arife";
  if (name.includes("bayram")) return "full";
  if (kind === "full" || kind === "arife" || kind === "half") return kind;
  if (name.includes("ogleden sonra") || name.includes("yarim gun") || name.includes("half")) return "half";
  return "full";
}

function buildSupervisorTaskLines(taskLine, year, month0, holidayKindByDate = {}) {
  if (!taskLine) return [];
  if (!isServiceSupervisorTaskLabel(taskLine.label)) return [taskLine];

  const daysInMonth = new Date(year, month0 + 1, 0).getDate();
  const regularCounts = {};
  const arifeCounts = {};

  for (let d = 1; d <= daysInMonth; d++) {
    const dateKey = `${year}-${String(month0 + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const weekday = new Date(year, month0, d).getDay();
    const isWeekend = weekday === 0 || weekday === 6;
    const kind = String(holidayKindByDate?.[dateKey] || "").toLowerCase();
    const need = Number.isFinite(taskLine?.counts?.[d]) ? Number(taskLine.counts[d]) : Number(taskLine?.defaultCount || 0);
    if (isWeekend || kind === "full") {
      regularCounts[d] = 0;
      arifeCounts[d] = 0;
      continue;
    }
    if (kind === "arife" || kind === "half") {
      regularCounts[d] = 0;
      arifeCounts[d] = need;
      continue;
    }
    regularCounts[d] = need;
    arifeCounts[d] = 0;
  }

  const hasPositive = (obj) => Object.values(obj || {}).some((v) => Number(v) > 0);
  const lines = [];

  if (hasPositive(regularCounts)) {
    lines.push({
      ...taskLine,
      weekendOff: true,
      defaultCount: 0,
      counts: regularCounts,
    });
  }

  if (hasPositive(arifeCounts)) {
    lines.push({
      ...taskLine,
      shiftCode: "A",
      weekendOff: true,
      defaultCount: 0,
      counts: arifeCounts,
    });
  }

  if (lines.length) return lines;
  return [{
    ...taskLine,
    weekendOff: true,
    defaultCount: 0,
    counts: regularCounts,
  }];
}

function sanitizeSupervisorAssignments(assignments = [], year, month0, holidayKindByDate = {}, workingHours = []) {
  void workingHours;
  return (assignments || [])
    .map((item) => {
      const label = String(item?.roleLabel || item?.label || "").trim();
      if (!isServiceSupervisorTaskLabel(label)) return item;
      const dateStr = String(item?.day || item?.date || "").slice(0, 10);
      if (!dateStr) return item;
      const dayNum = Number(dateStr.slice(8, 10));
      const weekday = Number.isFinite(dayNum) ? new Date(year, month0, dayNum).getDay() : NaN;
      const kind = String(holidayKindByDate?.[dateStr] || "").toLowerCase();
      if (weekday === 0 || weekday === 6 || kind === "full") return null;
      if (kind === "arife" || kind === "half") {
        return {
          ...item,
          shiftCode: "A",
          shiftId: "A",
          hours: HALF_DAY_A_HOURS,
        };
      }
      return item;
    })
    .filter(Boolean);
}

function matchPersonToUser(user, options) {
  if (!user || !options.length) return null;
  const idCandidates = [
    user.personId,
    user.person_id,
    user.staffId,
    user.id,
    user.tc,
    user.tcNo,
    user.tcno,
    user.TCKN,
    user.kod,
    user.code,
  ]
    .map((v) => (v == null ? "" : String(v).trim()))
    .filter(Boolean);
  for (const id of idCandidates) {
    const hit = options.find((opt) => opt.id && String(opt.id) === String(id));
    if (hit) return hit;
  }
  const nameCandidates = [
    user.fullName,
    user.name,
    user.displayName,
    [user.firstName, user.lastName].filter(Boolean).join(" "),
  ]
    .map((v) => (v == null ? "" : String(v).trim()))
    .filter(Boolean);
  const canonSet = new Set(nameCandidates.map((n) => canonName(n)));
  for (const opt of options) {
    if (canonSet.has(opt.canon)) return opt;
  }
  return null;
}

function withAliasIds(person, pool = []) {
  if (!person) return null;
  const canon = canonName(person.canon || person.name || person.fullName || "");
  const aliases = new Set();
  const addId = (val) => {
    const id = val == null ? "" : String(val).trim();
    if (id) aliases.add(id);
  };
  addId(person.id);
  addId(person.personId);
  addId(person.raw?.id);
  addId(person.raw?._id);
  addId(person.raw?.personId);

  (pool || []).forEach((candidate) => {
    if (!candidate) return;
    const sameCanon = canon && canonName(candidate.canon || candidate.name || "") === canon;
    const sameTc =
      person?.raw?.tc &&
      candidate?.raw?.tc &&
      String(person.raw.tc).trim() === String(candidate.raw.tc).trim();
    const sameEmail =
      person?.raw?.email &&
      candidate?.raw?.email &&
      String(person.raw.email).trim().toLowerCase() === String(candidate.raw.email).trim().toLowerCase();
    if (!(sameCanon || sameTc || sameEmail)) return;
    addId(candidate.id);
    addId(candidate.raw?.id);
    addId(candidate.raw?._id);
    addId(candidate.raw?.personId);
  });

  return {
    ...person,
    aliasIds: Array.from(aliases),
  };
}

export default function PlanTab({ workAreas = [], workingHours = [], peopleAll: peopleAllProp = [] }) {
  const { user } = useAuth();
  const scope = useServiceScope();
  const normalizeServiceId = useCallback(
    (raw) => {
      const val = String(raw || "").trim();
      if (!val) return "";
      if (scope?.servicesById?.has(val)) return val;
      const canon = canonService(val);
      for (const [id, svc] of scope?.servicesById?.entries?.() || []) {
        const name = svc?.name || svc?.label || svc?.title || svc?.code || id;
        const code = svc?.code || "";
        if (canonService(name) === canon || canonService(code) === canon) return String(id);
      }
      for (const svc of STATIC_SERVICES || []) {
        const id = String(svc?.id || "").trim();
        const name = String(svc?.name || "").trim();
        if (!id && !name) continue;
        if (canonService(id) === canon || canonService(name) === canon) return id || val;
      }
      return val;
    },
    [scope?.servicesById]
  );
  const { ym, setYear, setMonth } = useActiveYM();
  const { year, month } = ym;
  const [activeRole, setActiveRole] = useState("Nurse");
  const [plannerStatus, setPlannerStatus] = useState("idle"); // idle | loading | error | done
  const [plannerError, setPlannerError] = useState("");

  const peopleAll = useMemo(() => {
    const raw = Array.isArray(peopleAllProp) ? peopleAllProp : [];
    const seen = new Set();
    const normalized = [];
    raw.forEach((row, idx) => {
      const norm = normalizePersonRecord(row, idx);
      if (!norm || seen.has(norm.id)) return;
      seen.add(norm.id);
      normalized.push(norm);
    });
    normalized.sort((a, b) => a.name.localeCompare(b.name, "tr", { sensitivity: "base" }));
    return normalized;
  }, [peopleAllProp]);

  const [apiMatchedPerson, setApiMatchedPerson] = useState(null);

  useEffect(() => {
    setApiMatchedPerson(null);
  }, [user?.id, user?.personId, year, month]);

  const [allLeaves, setAllLeaves] = useState(() => getAllLeaves());
  useEffect(() => {
    const refreshLeaves = () => setAllLeaves(getAllLeaves());
    window.addEventListener("leaves:changed", refreshLeaves);
    return () => {
      window.removeEventListener("leaves:changed", refreshLeaves);
    };
  }, []);

  const roleKey = String(user?.role || user?.roleKey || user?.type || "").toUpperCase();
  const isAdminUser = roleKey === "ADMIN";
  const isStaffUser = roleKey === "STAFF";
  const isAuthorizedUser =
    !isAdminUser && !isStaffUser &&
    (roleKey === "AUTHORIZED" || roleKey === "MANAGER");
  const isStandardUser = !!user && !isAdminUser && !isAuthorizedUser && !isStaffUser;
  const canManage = isAdminUser || isAuthorizedUser || isStaffUser;

  const [selectedService, setSelectedService] = useState(scope.defaultServiceId || "");
  useEffect(() => {
    setSelectedService(scope.defaultServiceId || "");
  }, [scope.defaultServiceId]);

  const scopedPeople = useMemo(() => scope.filterByScope(peopleAll), [peopleAll, scope]);
  const matchPool = useMemo(
    () => (canManage ? scopedPeople : peopleAll),
    [canManage, scopedPeople, peopleAll]
  );

  const peopleForService = useMemo(() => {
    if (!selectedService) return scopedPeople;
    return scopedPeople.filter(
      (p) => scope.getServiceId(p.raw) === String(selectedService) || p.service === String(selectedService)
    );
  }, [scopedPeople, selectedService, scope]);

  const matchedPerson = useMemo(
    () => matchPersonToUser(user, matchPool),
    [user, matchPool]
  );

  const fallbackPerson = useMemo(() => {
    if (!isStandardUser) return null;
    const name =
      user?.fullName ||
      user?.name ||
      user?.displayName ||
      user?.username ||
      user?.userName ||
      user?.identifier ||
      user?.email ||
      user?.tc ||
      user?.tcNo ||
      user?.tcno ||
      "";
    if (!name) return null;
    const serviceId = normalizeServiceId(
      user?.serviceId ||
      (Array.isArray(user?.serviceIds) ? user.serviceIds[0] : "") ||
      ""
    );
    const roleHint =
      user?.roleLabel ||
      user?.title ||
      user?.jobTitle ||
      user?.position ||
      "";
    const fallbackId =
      String(
        user?.personId ||
        user?.person_id ||
        user?.staffId ||
        user?.id ||
        user?.userId ||
        user?.email ||
      name ||
      ""
    ).trim() || "me";
    return {
      id: fallbackId,
      name,
      canon: canonName(name),
      raw: { serviceId, role: roleHint },
      service: serviceId,
    };
  }, [isStandardUser, user, normalizeServiceId]);

  const forcedPerson = useMemo(() => {
    if (!isStandardUser) return null;
    const pid = String(user?.personId || "").trim();
    if (!pid) return null;
    const hit = peopleAll.find((p) => String(p?.id) === pid);
    if (hit) {
      const serviceId = normalizeServiceId(
        hit?.service ||
        hit?.raw?.serviceId ||
        hit?.raw?.service ||
        ""
      );
      return {
        ...hit,
        service: serviceId,
        raw: { ...(hit.raw || {}), serviceId },
      };
    }
    // Token'dan gelen personId tek başına yeterli değil.
    // Yerelde/serviste çözümlenemiyorsa bunu zorla kullanma; gerçek eşleşmeyi
    // backend personel listesi veya isim eşleştirmesi bulsun.
    return null;
  }, [isStandardUser, user, peopleAll, normalizeServiceId]);

  const normalizedMatchedPerson = useMemo(() => {
    if (!matchedPerson) return null;
    const serviceId = normalizeServiceId(
      matchedPerson?.service ||
      matchedPerson?.raw?.serviceId ||
      matchedPerson?.raw?.service ||
      ""
    );
    return withAliasIds({
      ...matchedPerson,
      service: serviceId,
      raw: { ...(matchedPerson.raw || {}), serviceId },
    }, peopleAll);
  }, [matchedPerson, normalizeServiceId, peopleAll]);

  const normalizedFallbackPerson = useMemo(
    () => withAliasIds(fallbackPerson, peopleAll),
    [fallbackPerson, peopleAll]
  );

  const normalizedForcedPerson = useMemo(
    () => withAliasIds(forcedPerson, peopleAll),
    [forcedPerson, peopleAll]
  );

  const normalizedApiMatchedPerson = useMemo(
    () => withAliasIds(apiMatchedPerson, peopleAll),
    [apiMatchedPerson, peopleAll]
  );

  const calendarPeople = useMemo(() => {
    if (isAdminUser || isAuthorizedUser || isStaffUser) return peopleForService;
    if (normalizedForcedPerson) return [normalizedForcedPerson];
    if (normalizedApiMatchedPerson) return [normalizedApiMatchedPerson];
    if (normalizedMatchedPerson) return [normalizedMatchedPerson];
    return normalizedFallbackPerson ? [normalizedFallbackPerson] : [];
  }, [isAdminUser, isAuthorizedUser, isStaffUser, peopleForService, normalizedForcedPerson, normalizedApiMatchedPerson, normalizedMatchedPerson, normalizedFallbackPerson]);

  const serviceOptions = useMemo(() => {
    const items = [];
    if (isAdminUser) {
      items.push({ id: "", name: "Tümü" });
    }
    for (const id of scope.allowedIds || []) {
      const svc = scope.servicesById.get(String(id));
      const name = svc?.name || svc?.code || id;
      items.push({ id: String(id), name });
    }
    return items;
  }, [scope.allowedIds, scope.servicesById, isAdminUser]);

  const showServiceSelect = canManage;
  const effectiveServiceId = useMemo(() => {
    if (canManage) return selectedService || "";
    const fromMatched =
      normalizedMatchedPerson?.service ||
      normalizedMatchedPerson?.raw?.serviceId ||
      "";
    return fromMatched || fallbackPerson?.service || fallbackPerson?.raw?.serviceId || "";
  }, [canManage, selectedService, normalizedMatchedPerson, fallbackPerson]);

  const roleInfo = {
    isAdmin: isAdminUser,
    isAuthorized: isAuthorizedUser || isStaffUser,
    isStandard: isStandardUser,
  };

  useEffect(() => {
    let alive = true;
    const shouldFetch =
      isStandardUser &&
      !forcedPerson &&
      !normalizedMatchedPerson &&
      !apiMatchedPerson;
    if (!shouldFetch) return undefined;
    (async () => {
      try {
        const res = await API.http.get(`/api/personnel?size=2000`);
        if (!alive) return;
        const items = Array.isArray(res?.items) ? res.items : [];
        const list = items
          .map((row, idx) => normalizePersonRecord(row, idx))
          .filter(Boolean);
        const hit = matchPersonToUser(user, list);
        if (hit) setApiMatchedPerson(hit);
      } catch (err) {
        console.warn("personnel fetch failed:", err?.message || err);
      }
    })();
    return () => { alive = false; };
  }, [isStandardUser, forcedPerson, normalizedMatchedPerson, apiMatchedPerson, user]);

  useEffect(() => {
    if (!isStandardUser) return;
    const src = normalizedMatchedPerson || fallbackPerson;
    if (!src) return;
    const hint = String(
      src?.raw?.meta?.role ||
      src?.raw?.title ||
      src?.raw?.role ||
      src?.role ||
      ""
    ).toLowerCase();
    const inferred = /doktor|doctor|hekim|tabip/.test(hint) ? "Doctor" : "Nurse";
    setActiveRole(inferred);
  }, [isStandardUser, normalizedMatchedPerson, fallbackPerson]);

  const handleRunPlanner = useCallback(async () => {
    try {
      setPlannerStatus("loading");
      setPlannerError("");

      const roleKey = activeRole;
      const serviceId = selectedService || "";
      const month0 = Math.min(11, Math.max(0, Number(month) - 1));

      const [personnelRes, hoursRes, scheduleRes, holidaysRes] = await Promise.all([
        API.http.get(`/api/personnel?page=1&size=2000`),
        API.http.get(`/api/settings/workingHours?serviceId=`),
        API.http.get(
          `/api/schedules/monthly?sectionId=calisma-cizelgesi&serviceId=${encodeURIComponent(
            serviceId
          )}&role=${encodeURIComponent(roleKey)}&year=${year}&month=${month}`
        ),
        API.http.get(`/api/holidays?y=${year}&m=${month}`),
      ]);

      const items = Array.isArray(personnelRes?.items) ? personnelRes.items : [];
      const { nurses, doctors } = splitByRole(items);
      const workingHours = Array.isArray(hoursRes?.value) ? hoursRes.value : [];
      const holidays = Array.isArray(holidaysRes?.items) ? holidaysRes.items : [];
      const holidayKindByDate = Object.fromEntries(
        holidays
          .filter((row) => row?.date)
          .map((row) => [String(row.date).slice(0, 10), normalizeHolidayKind(row)])
      );

      const defs = scheduleRes?.schedule?.data?.defs || [];
      const taskLines = (Array.isArray(defs) ? defs : [])
        .flatMap((d) => {
          const label = (d?.label || "").toString().trim();
          const shiftCode = (d?.shiftCode || "").toString().trim();
          if (!label || !shiftCode) return [];
          const counts = buildCountsFromPattern(d, year, month0);
          return buildSupervisorTaskLines({
            label,
            shiftCode,
            defaultCount: Number(d?.defaultCount ?? 0) || 0,
            counts,
          }, year, month0, holidayKindByDate);
        })
        .filter((line) => line && line.label && line.shiftCode);

      const result = await runPlannerOnce({
        year,
        month: month0,
        activeServiceId: serviceId,
        activeRole: roleKey,
        nurses,
        doctors,
        workingHours,
        personLeaves: allLeaves || {},
        taskLines,
      });

      const cleanedAssignments = sanitizeSupervisorAssignments(
        result?.dpResult?.assignments || [],
        year,
        month0,
        holidayKindByDate,
        workingHours
      );
      const cleanedResult = {
        ...result,
        dpResult: {
          ...(result?.dpResult || {}),
          assignments: cleanedAssignments,
        },
      };

      // Plan çıktısını çalışma çizelgesine yaz (backend ile senkron)
      try {
        const baseData =
          scheduleRes?.schedule?.data && typeof scheduleRes.schedule.data === "object"
            ? scheduleRes.schedule.data
            : {};
        const data = {
          ...baseData,
          assignments: Array.isArray(cleanedResult.dpResult?.assignments) ? cleanedResult.dpResult.assignments : [],
          generatedAt: new Date().toISOString(),
        };
        await saveMonthlySchedule({
          sectionId: "calisma-cizelgesi",
          serviceId,
          role: roleKey,
          year,
          month,
          data,
          meta: scheduleRes?.schedule?.meta || {},
        });
      } catch (err) {
        console.warn("Planı backend'e yazma hatası:", err?.message || err);
      }

      setPlannerStatus("done");
    } catch (err) {
      console.error(err);
      setPlannerStatus("error");
      setPlannerError(err?.message || "Planlama çalıştırılamadı.");
    }
  }, [activeRole, selectedService, year, month]);

  return (
    <div className="p-4 space-y-4">
      <ScheduleToolbar
        title={`${canManage ? "Planlama" : "Takvimim"} • ${MONTH_LABEL(year, month)}`}
        year={year}
        month={month}
        setYear={setYear}
        setMonth={setMonth}
        onBuild={canManage ? handleRunPlanner : undefined}
        role={canManage ? activeRole : undefined}
        onRoleChange={canManage ? setActiveRole : undefined}
      />

      {plannerStatus === "error" && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {plannerError || "Planlama çalıştırılamadı."}
        </div>
      )}
      {plannerStatus === "done" && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          Plan oluşturuldu.
        </div>
      )}

      {showServiceSelect && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm text-slate-600">Servis:</label>
          <select
            className="h-9 px-2 rounded-lg border text-sm text-slate-700"
            value={selectedService}
            onChange={(e) => setSelectedService(e.target.value)}
          >
            {serviceOptions.map((opt) => (
              <option key={opt.id ?? "_"} value={opt.id ?? ""}>
                {opt.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {isStandardUser && !matchedPerson && !fallbackPerson && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          Kullanıcı bilgilerinizle eşleşen bir personel kaydı bulunamadı. Personel listesinde kimlik bilgilerinizi
          güncelledikten sonra tekrar deneyin.
        </div>
      )}

      <div className="rounded-lg border bg-white p-4">
        <PersonScheduleCalendar
          year={year}
          month={month}
          people={calendarPeople}
          allLeaves={allLeaves}
          user={user}
          role={roleInfo}
          sectionId="calisma-cizelgesi"
          serviceId={effectiveServiceId}
          scheduleRole={activeRole}
          workAreas={workAreas}
          workingHours={workingHours}
        />
      </div>
    </div>
  );
}
