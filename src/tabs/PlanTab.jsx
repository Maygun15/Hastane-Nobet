// src/tabs/PlanTab.jsx
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { Activity, ArrowRight, BellRing, Building2, CalendarDays, ClipboardList, Settings2, ShieldCheck, Sparkles, UserCog, Users } from "lucide-react";
import { useAuth } from "../auth/AuthContext.jsx";
import useServiceScope from "../hooks/useServiceScope.js";
import useActiveYM from "../hooks/useActiveYM.js";
import { buildNameUnavailability, getAllLeaves } from "../lib/leaves.js";
import { LS } from "../utils/storage.js";
import { useAppStore } from "../state/appStore";
import ScheduleToolbar from "../components/ScheduleToolbar.jsx";
import PersonScheduleCalendar from "../components/PersonScheduleCalendar.jsx";
import { API } from "../lib/api.js";
import { generateSchedulerPlan, getMyRequests } from "../api/apiAdapter.js";
import { invalidateScheduleCache } from "../store/monthlyScheduleModel.js";
import { services as STATIC_SERVICES } from "../constants/enums.js";

const MONTH_LABEL = (year, month) =>
  `${Intl.DateTimeFormat("tr-TR", { month: "long" }).format(new Date(year, month - 1, 1))} ${year}`;
const DUTY_RULES_LS_KEY = "dutyRulesV2";

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
  // Yalnızca gerçek sistem ID alanları kullanılır; TC/kod ID olarak ele alınmaz
  const idCandidates = [
    p.id,
    p.personId,
    p.pid,
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
  // serviceId her zaman string — number/string karışıklığını önler
  const service = String(
    p.serviceId ??
      p.service ??
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
    raw: { ...p, serviceId: service, service },
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

function mapRulesToBackend(list) {
  const arr = Array.isArray(list) ? list : [];
  const findById = (id) => arr.find((rule) => rule?.id === id);
  const findAny = (ids) => ids.map(findById).find(Boolean);
  const findEnabled = (ids) => ids.map(findById).find((rule) => rule && rule.enabled);

  const boolRule = (ids) => {
    const any = findAny(ids);
    if (!any) return undefined;
    return !!findEnabled(ids);
  };
  const numRule = (ids, fallback) => {
    const any = findAny(ids);
    if (!any) return undefined;
    const enabled = findEnabled(ids);
    if (!enabled) return 0;
    const value = Number(enabled.value);
    return Number.isFinite(value) ? value : fallback;
  };

  const out = {};
  const oneShift = boolRule(["ONE_SHIFT_PER_DAY", "NO_MULTIPLE_ASSIGNMENTS_PER_DAY"]);
  if (oneShift !== undefined) out.ONE_SHIFT_PER_DAY = oneShift;

  const leaveBlock = boolRule(["LEAVE_BLOCK_GENERIC"]);
  if (leaveBlock !== undefined) out.LEAVE_BLOCK = leaveBlock;

  const consecutive = numRule(["MAX_CONSECUTIVE_6D"], 6);
  if (consecutive !== undefined) out.MAX_CONSECUTIVE_DAYS = consecutive;

  const rest = numRule(["MIN_GAP_12H", "MIN_REST_11H"], 11);
  if (rest !== undefined) out.MIN_REST_HOURS = rest;

  const nightNextDay = boolRule(["NIGHT_NEXT_DAY_OFF"]);
  if (nightNextDay !== undefined) out.NIGHT_NEXT_DAY_OFF = nightNextDay;

  const weeklyMax = numRule(["WEEKLY_MAX_SHIFTS", "WEEKLY_MAX_DUTIES", "WEEKLY_MAX_SHIFTS_PER_PERSON"], 0);
  if (weeklyMax !== undefined) out.MAX_SHIFTS_PER_WEEK = weeklyMax;

  const maxTask = numRule(["MAX_TASK_PER_PERSON", "MAX_SAME_TASK_PER_PERSON"], 0);
  if (maxTask !== undefined) out.MAX_TASK_PER_PERSON = maxTask;

  return out;
}

function readDutyRulesFromLS() {
  try {
    const raw = JSON.parse(localStorage.getItem(DUTY_RULES_LS_KEY) || "[]");
    const mapped = mapRulesToBackend(raw);
    if (mapped?.ONE_SHIFT_PER_DAY === false) delete mapped.ONE_SHIFT_PER_DAY;
    return mapped;
  } catch {
    return {};
  }
}

function buildLeavesByPersonForMonth(allLeaves = {}, year, month, people = []) {
  const ym = `${year}-${String(month).padStart(2, "0")}`;
  const leaveSets = {};
  const ensure = (personId) => {
    const key = String(personId || "").trim();
    if (!key) return null;
    leaveSets[key] ??= new Set();
    return leaveSets[key];
  };
  const addDay = (personId, day) => {
    const dayNum = Number(day);
    if (!Number.isFinite(dayNum) || dayNum < 1 || dayNum > 31) return;
    const bucket = ensure(personId);
    if (!bucket) return;
    bucket.add(`${year}-${String(month).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`);
  };

  for (const [personId, byYm] of Object.entries(allLeaves || {})) {
    const monthly = byYm?.[ym];
    if (!monthly || typeof monthly !== "object") continue;
    Object.keys(monthly).forEach((dayKey) => addDay(personId, dayKey));
  }

  if (Array.isArray(people) && people.length) {
    const daysByName = buildNameUnavailability(people, year, month);
    for (const person of people) {
      const personId = String(person?.id || "").trim();
      const personName = person?.name || person?.fullName || "";
      const days = daysByName.get(canonName(personName));
      if (!personId || !days || !days.size) continue;
      days.forEach((day) => addDay(personId, day));
    }
  }

  return Object.fromEntries(
    Object.entries(leaveSets)
      .map(([personId, dates]) => [personId, Array.from(dates.values())])
      .filter(([, dates]) => dates.length > 0)
  );
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

function countVisibleLeaveDays(allLeaves = {}, people = [], year, month) {
  const ymKey = `${year}-${String(month).padStart(2, "0")}`;
  const seen = new Set();
  for (const person of Array.isArray(people) ? people : []) {
    const aliasIds = new Set(
      [person?.id, ...(Array.isArray(person?.aliasIds) ? person.aliasIds : [])]
        .map((v) => (v == null ? "" : String(v).trim()))
        .filter(Boolean)
    );
    for (const aliasId of aliasIds) {
      const monthly = allLeaves?.[aliasId]?.[ymKey];
      if (!monthly || typeof monthly !== "object") continue;
      Object.entries(monthly).forEach(([day, val]) => {
        if (!val) return;
        seen.add(`${aliasId}:${day}`);
      });
    }
  }
  return seen.size;
}

function countPeopleOnSpecificLeaveDay(allLeaves = {}, people = [], year, month, day) {
  const ymKey = `${year}-${String(month).padStart(2, "0")}`;
  let count = 0;
  for (const person of Array.isArray(people) ? people : []) {
    const aliasIds = new Set(
      [person?.id, ...(Array.isArray(person?.aliasIds) ? person.aliasIds : [])]
        .map((v) => (v == null ? "" : String(v).trim()))
        .filter(Boolean)
    );
    let hasLeave = false;
    for (const aliasId of aliasIds) {
      const monthly = allLeaves?.[aliasId]?.[ymKey];
      if (!monthly || typeof monthly !== "object") continue;
      if (monthly[String(day)] || monthly[`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`]) {
        hasLeave = true;
        break;
      }
    }
    if (hasLeave) count += 1;
  }
  return count;
}

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
  // Rol seçimi — Zustand store üzerinden tüm sekmelerle paylaşılıyor
  const activeRole = useAppStore((s) => s.activeRole);
  const setActiveRole = useAppStore((s) => s.setActiveRole);
  const [plannerStatus, setPlannerStatus] = useState("idle"); // idle | loading | error | done
  const [plannerError, setPlannerError] = useState("");
  const [requestItems, setRequestItems] = useState([]);
  const [requestError, setRequestError] = useState("");

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

  // activeRole değişimi artık Zustand store üzerinden yönetiliyor.
  // Store'un setActiveRole fonksiyonu LS + event senkronizasyonunu da yapıyor.

  const roleKey = String(user?.role || user?.roleKey || user?.type || "").toUpperCase();
  const isAdminUser = roleKey === "ADMIN";
  const isStaffUser = roleKey === "STAFF";
  const isAuthorizedUser =
    !isAdminUser && !isStaffUser &&
    (roleKey === "AUTHORIZED" || roleKey === "MANAGER");
  const isStandardUser = !!user && !isAdminUser && !isAuthorizedUser && !isStaffUser;
  const canManage = isAdminUser || isAuthorizedUser || isStaffUser;

  // Servis seçimi — Zustand store üzerinden tüm sekmelerle paylaşılıyor
  const storeServiceId = useAppStore((s) => s.activeServiceId);
  const setStoreServiceId = useAppStore((s) => s.setActiveServiceId);
  const selectedService = storeServiceId || scope.defaultServiceId || "";
  const setSelectedService = useCallback((id) => {
    setStoreServiceId(id);
  }, [setStoreServiceId]);
  // İlk yüklemede scope default'unu store'a yaz
  useEffect(() => {
    if (!storeServiceId && scope.defaultServiceId) {
      setStoreServiceId(scope.defaultServiceId);
    }
  }, [scope.defaultServiceId, storeServiceId, setStoreServiceId]);

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

  const visiblePeopleCount = useMemo(
    () => (Array.isArray(calendarPeople) ? calendarPeople.length : 0),
    [calendarPeople]
  );

  const monthlyLeaveCount = useMemo(
    () => countVisibleLeaveDays(allLeaves, calendarPeople, year, month),
    [allLeaves, calendarPeople, year, month]
  );

  const today = new Date();
  const leaveCountToday = useMemo(() => {
    if (today.getFullYear() !== year || today.getMonth() + 1 !== month) return null;
    return countPeopleOnSpecificLeaveDay(allLeaves, calendarPeople, year, month, today.getDate());
  }, [allLeaves, calendarPeople, year, month]);

  const currentServiceName = useMemo(() => {
    if (!effectiveServiceId) return "Tüm Servisler";
    const svc = scope.servicesById.get(String(effectiveServiceId));
    return svc?.name || svc?.code || String(effectiveServiceId);
  }, [effectiveServiceId, scope.servicesById]);

  const roleLabel = activeRole === "Doctor" ? "Doktor Planı" : "Hemşire Planı";

  const plannerTone = plannerStatus === "error"
    ? "rose"
    : plannerStatus === "done"
      ? "emerald"
      : plannerStatus === "loading"
        ? "amber"
        : "slate";

  const pendingRequestCount = useMemo(
    () => (requestItems || []).filter((item) => item?.status === "pending").length,
    [requestItems]
  );

  const approvedRequestCount = useMemo(
    () => (requestItems || []).filter((item) => item?.status === "approved").length,
    [requestItems]
  );

  const dashboardAlerts = useMemo(() => {
    const items = [];
    if (!visiblePeopleCount) {
      items.push({ tone: "amber", text: "Seçili kapsamda görüntülenecek personel bulunmuyor." });
    }
    if (pendingRequestCount > 0) {
      items.push({ tone: "sky", text: `${pendingRequestCount} talep beklemede.` });
    }
    if (plannerStatus === "error" && plannerError) {
      items.push({ tone: "rose", text: plannerError });
    }
    if (isStandardUser && !matchedPerson && !fallbackPerson) {
      items.push({ tone: "amber", text: "Kullanıcı kaydı ile personel eşleşmesi eksik." });
    }
    return items;
  }, [visiblePeopleCount, pendingRequestCount, plannerStatus, plannerError, isStandardUser, matchedPerson, fallbackPerson]);

  const navigateTo = useCallback((path) => {
    try {
      window.history.pushState({}, "", path);
      window.dispatchEvent(new Event("urlchange"));
    } catch {}
  }, []);

  const openScheduleSection = useCallback((sectionId) => {
    try {
      window.location.hash = `#/cizelgeler/${encodeURIComponent(sectionId)}`;
    } catch {}
  }, []);

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
    let alive = true;
    (async () => {
      try {
        setRequestError("");
        const res = await getMyRequests();
        if (!alive) return;
        setRequestItems(Array.isArray(res?.items) ? res.items : []);
      } catch (err) {
        if (!alive) return;
        setRequestItems([]);
        setRequestError(err?.message || "Talep özeti alınamadı.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [user?.id]);

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
      const [personnelRes, scheduleRes] = await Promise.all([
        API.http.get(`/api/personnel?page=1&size=2000`),
        API.http.get(
          `/api/schedules/monthly?sectionId=calisma-cizelgesi&serviceId=${encodeURIComponent(
            serviceId
          )}&role=${encodeURIComponent(roleKey)}&year=${year}&month=${month}`
        ),
      ]);

      const items = Array.isArray(personnelRes?.items) ? personnelRes.items : [];
      const { nurses, doctors } = splitByRole(items);
      const scheduleData =
        scheduleRes?.schedule?.data && typeof scheduleRes.schedule.data === "object"
          ? scheduleRes.schedule.data
          : {};
      const defs = Array.isArray(scheduleData?.defs) ? scheduleData.defs : [];
      const overrides =
        scheduleData?.overrides && typeof scheduleData.overrides === "object"
          ? scheduleData.overrides
          : {};
      const shiftOptions = Array.isArray(scheduleData?.shiftOptions) ? scheduleData.shiftOptions : [];

      if (!defs.length) {
        throw new Error("Çalışma çizelgesi şablonu bulunamadı.");
      }

      const rolePeople = roleKey === "Doctor" ? doctors : nurses;
      const scopedRolePeople = serviceId
        ? rolePeople.filter((person) => String(person.serviceId || person.service || person.meta?.serviceId || person.meta?.service || "") === String(serviceId))
        : rolePeople;
      const staffSource = scopedRolePeople.length ? scopedRolePeople : rolePeople;
      const staffPayload = staffSource
        .map((person) => {
          const areas = Array.isArray(person.areas) ? person.areas : [];
          const shiftCodes = Array.isArray(person.shiftCodes) ? person.shiftCodes : [];
          const meta = person?.meta && typeof person.meta === "object" ? { ...person.meta } : {};
          if (!meta.areas && areas.length) meta.areas = areas;
          if (!meta.shiftCodes && shiftCodes.length) meta.shiftCodes = shiftCodes;
          if (!meta.role && person.role) meta.role = person.role;
          if (!meta.serviceId && person.serviceId) meta.serviceId = person.serviceId;
          return {
            id: String(person.id || ""),
            name: person.name || person.fullName || "",
            fullName: person.fullName || person.name || "",
            role: person.role || "",
            serviceId: person.serviceId || person.service || "",
            areas,
            shiftCodes,
            meta,
          };
        })
        .filter((person) => person.id && person.name);

      const rules = readDutyRulesFromLS();
      const leavesByPerson = buildLeavesByPersonForMonth(allLeaves, year, month, staffPayload);
      const supervisorConfig = LS.get("supervisorConfig", null);
      const supervisorPool = LS.get("supervisorPool", null);

      const result = await generateSchedulerPlan({
        sectionId: "calisma-cizelgesi",
        serviceId,
        role: roleKey,
        year,
        month,
        sync: true,
        dryRun: false,
        defs,
        overrides,
        shiftOptions,
        ...(staffPayload.length ? { staff: staffPayload } : {}),
        ...(Object.keys(rules).length ? { rules } : {}),
        ...(Object.keys(leavesByPerson).length ? { leavesByPerson } : {}),
        ...(supervisorConfig ? { supervisorConfig } : {}),
        ...(Array.isArray(supervisorPool) && supervisorPool.length ? { supervisorPool } : {}),
      });
      const data = result?.data || result?.result?.data || null;
      if (!data) {
        throw new Error("Scheduler sonucu alınamadı.");
      }

      invalidateScheduleCache(year, month);
      try {
        const detail = {
          sectionId: "calisma-cizelgesi",
          serviceId,
          role: roleKey,
          year,
          month,
          ts: Date.now(),
        };
        window.dispatchEvent(new CustomEvent("schedule:saved", { detail }));
        window.dispatchEvent(new Event("planner:changed"));
        window.dispatchEvent(new Event("schedule:built"));
        localStorage.setItem("scheduleLastSaved", JSON.stringify(detail));
        localStorage.setItem("scheduleBuildTrigger", JSON.stringify({ ym: `${year}-${String(month).padStart(2, "0")}`, ts: detail.ts }));
      } catch {}

      setPlannerStatus("done");
    } catch (err) {
      setPlannerStatus("error");
      setPlannerError(err?.message || "Planlama çalıştırılamadı.");
    }
  }, [activeRole, selectedService, year, month, allLeaves]);

  return (
    <div className="p-4 md:p-5 space-y-5">
      <section className="rounded-[24px] border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-slate-200 px-4 py-4 md:px-6 md:py-5">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700">
                <Sparkles className="h-3.5 w-3.5" />
                {canManage ? "Planlama Yönetimi" : "Kişisel Planlama Görünümü"}
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-slate-900 md:text-[28px]">
                  {canManage ? "Planlama Kontrol Merkezi" : "Kişisel Çalışma Takvimi"}
                </h1>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
                  Seçili dönem, servis kapsamı ve kişi planı tek çalışma yüzeyinde toplanır. Üstte bağlamı kontrol edip altta doğrudan takvime inersin.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700">
                  <CalendarDays className="h-3.5 w-3.5 text-sky-600" />
                  {MONTH_LABEL(year, month)}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700">
                  <Building2 className="h-3.5 w-3.5 text-indigo-600" />
                  {currentServiceName}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700">
                  <Users className="h-3.5 w-3.5 text-emerald-600" />
                  {visiblePeopleCount} kişi
                </span>
                <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${
                  plannerTone === "rose"
                    ? "border-rose-200 bg-rose-50 text-rose-700"
                    : plannerTone === "amber"
                      ? "border-amber-200 bg-amber-50 text-amber-700"
                      : plannerTone === "emerald"
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border-slate-200 bg-slate-50 text-slate-700"
                }`}>
                  <Activity className="h-3.5 w-3.5" />
                  {plannerStatus === "loading" ? "Planlama çalışıyor" : plannerStatus === "done" ? "Plan hazır" : plannerStatus === "error" ? "Müdahale gerekli" : "Plan beklemede"}
                </span>
              </div>
            </div>

            <div className="w-full xl:max-w-[640px]">
              <div className="rounded-[20px] border border-slate-200 bg-slate-50/80 p-3">
                <ScheduleToolbar
                  title={`${canManage ? "Planlama" : "Takvimim"} • ${MONTH_LABEL(year, month)}`}
                  year={year}
                  month={month}
                  setYear={setYear}
                  setMonth={setMonth}
                  onBuild={canManage ? handleRunPlanner : undefined}
                  building={plannerStatus === "loading"}
                  role={canManage ? activeRole : undefined}
                  onRoleChange={canManage ? setActiveRole : undefined}
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {plannerStatus === "error" && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 shadow-sm">
          {plannerError || "Planlama çalıştırılamadı."}
        </div>
      )}
      {plannerStatus === "done" && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 shadow-sm">
          Plan oluşturuldu. Takvim ve kişi özetleri yeni planla senkronlandı.
        </div>
      )}

      <section className="rounded-[22px] border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <ShieldCheck className="h-4 w-4 text-sky-600" />
              Görünüm Kapsamı
            </div>
            <p className="text-sm text-slate-500">
              {canManage
                ? "Servis ve rol kırılımını buradan yönetebilir, alttaki takvimde sonucu anında görebilirsin."
                : "Kişisel planın seçili ay ve vardiya tanımlarına göre aşağıda görüntülenir."}
            </p>
          </div>

          <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center">
            {showServiceSelect && (
              <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
                <span className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">Servis</span>
                <select
                  className="h-9 min-w-[180px] rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                  value={selectedService}
                  onChange={(e) => setSelectedService(e.target.value)}
                >
                  {serviceOptions.map((opt) => (
                    <option key={opt.id ?? "_"} value={opt.id ?? ""}>
                      {opt.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <div className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
              <span className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">Rol</span>
              <span className="rounded-full bg-white px-3 py-1 text-sm font-semibold text-slate-800 shadow-sm">
                {activeRole === "Doctor" ? "Doktorlar" : "Hemşireler"}
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
        <div className="rounded-[22px] border border-slate-200 bg-white p-4 shadow-sm md:p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-semibold text-slate-900">Operasyon Özeti</div>
              <div className="mt-1 text-sm text-slate-500">
                Seçili dönem ve kapsam için ilk bakışta karar aldıran göstergeler.
              </div>
            </div>
            <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
              {canManage ? "Yönetim görünümü" : "Kişisel görünüm"}
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-sky-100 bg-sky-50/70 p-4">
              <div className="text-xs font-medium uppercase tracking-[0.14em] text-sky-700">Görünen Personel</div>
              <div className="mt-2 text-3xl font-semibold text-slate-900">{visiblePeopleCount}</div>
              <div className="mt-1 text-xs text-slate-500">Seçili servis ve rol filtresine göre</div>
            </div>
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4">
              <div className="text-xs font-medium uppercase tracking-[0.14em] text-emerald-700">
                {leaveCountToday === null ? "Bu Ay İzin Kaydı" : "Bugün İzinli"}
              </div>
              <div className="mt-2 text-3xl font-semibold text-slate-900">
                {leaveCountToday === null ? monthlyLeaveCount : leaveCountToday}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {leaveCountToday === null ? "Seçili aydaki toplam izin işareti" : "Bugünün kişi bazlı izin sayısı"}
              </div>
            </div>
            <div className="rounded-2xl border border-amber-100 bg-amber-50/70 p-4">
              <div className="text-xs font-medium uppercase tracking-[0.14em] text-amber-700">Bekleyen Talep</div>
              <div className="mt-2 text-3xl font-semibold text-slate-900">{pendingRequestCount}</div>
              <div className="mt-1 text-xs text-slate-500">
                {requestError ? "Talep özeti okunamadı" : `${approvedRequestCount} talep sonuçlandı`}
              </div>
            </div>
            <div className="rounded-2xl border border-violet-100 bg-violet-50/70 p-4">
              <div className="text-xs font-medium uppercase tracking-[0.14em] text-violet-700">Plan Durumu</div>
              <div className="mt-2 text-xl font-semibold text-slate-900">
                {plannerStatus === "loading" ? "Oluşturuluyor" : plannerStatus === "done" ? "Hazır" : plannerStatus === "error" ? "Müdahale Gerekli" : "Beklemede"}
              </div>
              <div className="mt-1 text-xs text-slate-500">{roleLabel} · {currentServiceName}</div>
            </div>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <Activity className="h-4 w-4 text-sky-600" />
                Durum Notları
              </div>
              <div className="mt-3 space-y-2">
                {dashboardAlerts.length ? dashboardAlerts.map((item, idx) => (
                  <div
                    key={`${item.text}-${idx}`}
                    className={`rounded-xl border px-3 py-2 text-sm ${
                      item.tone === "rose"
                        ? "border-rose-200 bg-rose-50 text-rose-700"
                        : item.tone === "amber"
                          ? "border-amber-200 bg-amber-50 text-amber-800"
                          : "border-sky-200 bg-sky-50 text-sky-700"
                    }`}
                  >
                    {item.text}
                  </div>
                )) : (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                    Kritik uyarı görünmüyor. Seçili kapsam stabil.
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <BellRing className="h-4 w-4 text-violet-600" />
                Hızlı Aksiyonlar
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => openScheduleSection("calisma-cizelgesi")}
                  className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left hover:border-sky-300 hover:bg-sky-50 transition"
                >
                  <span>
                    <span className="block text-sm font-semibold text-slate-800">Çalışma Çizelgesi</span>
                    <span className="block text-xs text-slate-500">Aylık çalışma görünümüne geç</span>
                  </span>
                  <ArrowRight className="h-4 w-4 text-slate-400" />
                </button>
                <button
                  type="button"
                  onClick={() => navigateTo("/talepler")}
                  className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left hover:border-sky-300 hover:bg-sky-50 transition"
                >
                  <span>
                    <span className="block text-sm font-semibold text-slate-800">Talepler</span>
                    <span className="block text-xs text-slate-500">Bekleyen ve geçmiş talepleri aç</span>
                  </span>
                  <ClipboardList className="h-4 w-4 text-slate-400" />
                </button>
                {canManage ? (
                  <button
                    type="button"
                    onClick={() => navigateTo("/personel")}
                    className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left hover:border-sky-300 hover:bg-sky-50 transition"
                  >
                    <span>
                      <span className="block text-sm font-semibold text-slate-800">Personel</span>
                      <span className="block text-xs text-slate-500">Kayıtları ve servis eşleşmelerini yönet</span>
                    </span>
                    <UserCog className="h-4 w-4 text-slate-400" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => navigateTo("/profilim")}
                    className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left hover:border-sky-300 hover:bg-sky-50 transition"
                  >
                    <span>
                      <span className="block text-sm font-semibold text-slate-800">Profilim</span>
                      <span className="block text-xs text-slate-500">Kişisel bilgilerini ve şifreni yönet</span>
                    </span>
                    <ArrowRight className="h-4 w-4 text-slate-400" />
                  </button>
                )}
                {isAdminUser ? (
                  <button
                    type="button"
                    onClick={() => window.location.hash = "#/parametreler"}
                    className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left hover:border-sky-300 hover:bg-sky-50 transition"
                  >
                    <span>
                      <span className="block text-sm font-semibold text-slate-800">Parametreler</span>
                      <span className="block text-xs text-slate-500">Vardiya ve kural setlerini güncelle</span>
                    </span>
                    <Settings2 className="h-4 w-4 text-slate-400" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => openScheduleSection("aylik-calisma-ve-mesai-saatleri-cizelgesi")}
                    className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left hover:border-sky-300 hover:bg-sky-50 transition"
                  >
                    <span>
                      <span className="block text-sm font-semibold text-slate-800">Aylık Saat Çizelgesi</span>
                      <span className="block text-xs text-slate-500">Mesai toplamlarını detaylı incele</span>
                    </span>
                    <CalendarDays className="h-4 w-4 text-slate-400" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-[22px] border border-slate-200 bg-white p-4 shadow-sm md:p-5">
          <div className="text-sm font-semibold text-slate-900">Kapsam Özeti</div>
          <div className="mt-1 text-sm text-slate-500">
            Çalıştığın veri çerçevesini tek blokta doğrula.
          </div>
          <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50/70">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-4 py-3">
              <div>
                <div className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">Rol Görünümü</div>
                <div className="mt-1 text-sm font-semibold text-slate-900">{roleLabel}</div>
              </div>
              <div className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-200">
                {currentServiceName}
              </div>
            </div>
            <dl className="divide-y divide-slate-200">
              <div className="flex items-center justify-between gap-4 px-4 py-3">
                <dt className="text-sm text-slate-500">Kullanıcı eşleşmesi</dt>
                <dd className="text-sm font-semibold text-slate-900">
                  {normalizedMatchedPerson || normalizedApiMatchedPerson || normalizedForcedPerson || normalizedFallbackPerson
                    ? "Personel kaydı bağlı"
                    : "Eşleşme eksik"}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4 px-4 py-3">
                <dt className="text-sm text-slate-500">Toplam talep</dt>
                <dd className="text-sm font-semibold text-slate-900">{requestItems.length}</dd>
              </div>
              <div className="flex items-center justify-between gap-4 px-4 py-3">
                <dt className="text-sm text-slate-500">Bekleyen talepler</dt>
                <dd className="text-sm font-semibold text-amber-700">{pendingRequestCount}</dd>
              </div>
              <div className="flex items-center justify-between gap-4 px-4 py-3">
                <dt className="text-sm text-slate-500">Sonuçlanan talepler</dt>
                <dd className="text-sm font-semibold text-emerald-700">{approvedRequestCount}</dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      {isStandardUser && !matchedPerson && !fallbackPerson && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 shadow-sm flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1">
            <p className="text-sm font-medium text-amber-800">Personel kaydı eşleşmedi</p>
            <p className="text-xs text-amber-700 mt-0.5">
              Kullanıcı bilgilerinizle eşleşen bir personel kaydı bulunamadı. Yöneticinizden personel listesinde kimlik bilgilerinizi güncellemesini isteyin.
            </p>
          </div>
          <button
            onClick={() => navigateTo("/personel")}
            className="shrink-0 rounded-xl border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-50 transition-colors"
          >
            Personel Sekmesine Git →
          </button>
        </div>
      )}

      <section className="rounded-[28px] border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-slate-200 bg-slate-50/80 px-4 py-3 md:px-5">
          <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-sm font-semibold text-slate-800">Aylık Takvim Tuvali</div>
              <div className="text-xs text-slate-500">
                Günlük atamalar, izinler ve kişi bazlı özet aynı yüzeyde gösterilir.
              </div>
            </div>
            <div className="text-xs text-slate-500">
              {currentServiceName} · {activeRole === "Doctor" ? "Doktor" : "Hemşire"} görünümü
            </div>
          </div>
        </div>
        <div className="p-4 md:p-5">
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
      </section>
    </div>
  );
}
