// src/tabs/PlanTab.jsx
import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { Activity, ArrowRight, BellRing, Building2, CalendarDays, ChevronLeft, ChevronRight, ClipboardList, ListChecks, Loader2, Settings2, Sparkles, UserCog, Users } from "lucide-react";
import { useAuth } from "../auth/AuthContext.jsx";
import useServiceScope from "../hooks/useServiceScope.js";
import useActiveYM from "../hooks/useActiveYM.js";
import { buildNameUnavailability, getAllLeaves } from "../lib/leaves.js";
import { LS } from "../utils/storage.js";
import { useAppStore } from "../state/appStore";
import PersonScheduleCalendar from "../components/PersonScheduleCalendar.jsx";
import { WorkspaceHero, WorkspaceStatCard } from "../components/workspace/WorkspaceShell.jsx";
import { API } from "../lib/api.js";
import { generateSchedulerPlan, getMyRequests } from "../api/apiAdapter.js";
import { invalidateScheduleCache } from "../store/monthlyScheduleModel.js";
import { services as STATIC_SERVICES } from "../constants/enums.js";
import SchedulerAuditPanel from "../components/SchedulerAuditPanel.jsx";

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

export default function PlanTab({ workAreas = [], workingHours = [], peopleAll: peopleAllProp = [], onOpenRequests = null }) {
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
  const leaveTypes = useAppStore((s) => s.leaveTypes);
  const [plannerStatus, setPlannerStatus] = useState("idle"); // idle | loading | error | done
  const [plannerError, setPlannerError] = useState("");
  const [plannerIssues, setPlannerIssues] = useState([]);
  const [requestItems, setRequestItems] = useState([]);
  const [requestError, setRequestError] = useState("");
  const personCalendarRef = useRef(null);

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

  const leaveCountToday = useMemo(() => {
    const today = new Date(); // useMemo içinde hesapla — stale closure riski yok
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

  const openRequests = useCallback((status = "") => {
    if (typeof onOpenRequests === "function") {
      onOpenRequests(status);
      return;
    }
    const suffix = status ? `?status=${encodeURIComponent(status)}` : "";
    navigateTo(`/talepler${suffix}`);
  }, [navigateTo, onOpenRequests]);

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
  }, [isStandardUser, forcedPerson, normalizedMatchedPerson]); // apiMatchedPerson dep'ten çıkarıldı: içeride !apiMatchedPerson guard ile yönetiliyor; object referans değişimi sonsuz döngüye yol açar

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
  }, [isStandardUser, normalizedMatchedPerson, fallbackPerson, setActiveRole]);

  const handleRunPlanner = useCallback(async () => {
    try {
      setPlannerStatus("loading");
      setPlannerError("");
      setPlannerIssues([]);

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

      setPlannerIssues(Array.isArray(data.issues) ? data.issues : []);
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
      <WorkspaceHero
        badges={[
          { icon: Sparkles, label: canManage ? "Planlama Yönetimi" : "Kişisel Planlama Görünümü", tone: "border-sky-200 bg-sky-50 text-sky-700" },
        ]}
        title={canManage ? "Planlama Kontrol Merkezi" : "Kişisel Çalışma Takvimi"}
        description="Seçili dönem, servis kapsamı ve kişi planı tek çalışma yüzeyinde toplanır. Üstte bağlamı kontrol edip altta doğrudan takvime inersin."
        metrics={[
          { icon: CalendarDays, accent: "sky", label: "Dönem", value: MONTH_LABEL(year, month) },
          { icon: Building2, accent: "emerald", label: "Servis", value: currentServiceName },
          { icon: Users, accent: "violet", label: "Personel", value: `${visiblePeopleCount} kişi` },
          {
            icon: Activity,
            accent: plannerTone === "rose" ? "amber" : plannerTone === "emerald" ? "emerald" : plannerTone === "amber" ? "amber" : "sky",
            label: "Plan Durumu",
            value: plannerStatus === "loading" ? "Planlama çalışıyor" : plannerStatus === "done" ? "Plan hazır" : plannerStatus === "error" ? "Müdahale gerekli" : "Plan beklemede",
          },
        ]}
      />

      {/* ── Operasyonel Giriş Noktası — tek gerçeklik kaynağı ── */}
      <div className="rounded-[22px] border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">

          {/* Dönem navigasyonu */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => { if (month === 1) { setYear(year - 1); setMonth(12); } else { setMonth(month - 1); } }}
              className="rounded-xl border border-slate-200 p-1.5 hover:bg-slate-50 transition-colors"
              title="Önceki ay"
            >
              <ChevronLeft className="h-4 w-4 text-slate-500" />
            </button>
            <span className="min-w-[148px] text-center text-sm font-semibold text-slate-800">
              {MONTH_LABEL(year, month)}
            </span>
            <button
              type="button"
              onClick={() => { if (month === 12) { setYear(year + 1); setMonth(1); } else { setMonth(month + 1); } }}
              className="rounded-xl border border-slate-200 p-1.5 hover:bg-slate-50 transition-colors"
              title="Sonraki ay"
            >
              <ChevronRight className="h-4 w-4 text-slate-500" />
            </button>
          </div>

          <div className="h-5 w-px bg-slate-200 hidden sm:block" />

          {/* Servis seçimi */}
          {showServiceSelect && (
            <div className="flex items-center gap-2">
              <Building2 className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              <select
                value={selectedService}
                onChange={(e) => setSelectedService(e.target.value)}
                className="h-9 min-w-[160px] rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
              >
                {serviceOptions.map((opt) => (
                  <option key={opt.id ?? "_"} value={opt.id ?? ""}>{opt.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Rol toggle — sadece yönetici */}
          {canManage && (
            <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200">
              <button
                type="button"
                onClick={() => setActiveRole("Nurse")}
                className={`px-3 py-1 text-xs font-medium rounded-lg transition-all ${
                  activeRole !== "Doctor" ? "bg-white text-sky-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                Hemşire
              </button>
              <button
                type="button"
                onClick={() => setActiveRole("Doctor")}
                className={`px-3 py-1 text-xs font-medium rounded-lg transition-all ${
                  activeRole === "Doctor" ? "bg-white text-sky-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                Doktor
              </button>
            </div>
          )}

          {/* CTA — Çizelgeden Doldur */}
          {canManage && (
            <button
              type="button"
              onClick={plannerStatus === "loading" ? undefined : handleRunPlanner}
              disabled={plannerStatus === "loading"}
              className={`ml-auto flex items-center gap-1.5 rounded-xl border px-4 py-2 text-sm font-medium transition-colors ${
                plannerStatus === "loading"
                  ? "cursor-wait border-indigo-200 bg-indigo-50 text-indigo-400"
                  : "border-sky-400 bg-sky-600 text-white hover:bg-sky-700 shadow-sm"
              }`}
            >
              {plannerStatus === "loading"
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Oluşturuluyor…</>
                : <><ListChecks className="h-4 w-4" /> Çizelgeden Doldur</>
              }
            </button>
          )}
        </div>
      </div>

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

      {canManage && plannerStatus === "done" && plannerIssues.length > 0 && (
        <SchedulerAuditPanel
          issues={plannerIssues}
          totalDays={new Date(year, month, 0).getDate()}
        />
      )}

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
            <WorkspaceStatCard title="Görünen Personel" value={visiblePeopleCount} caption="Seçili servis ve rol filtresine göre" accent="sky" />
            <WorkspaceStatCard
              title={leaveCountToday === null ? "Bu Ay İzin Kaydı" : "Bugün İzinli"}
              value={leaveCountToday === null ? monthlyLeaveCount : leaveCountToday}
              caption={leaveCountToday === null ? "Seçili aydaki toplam izin işareti" : "Bugünün kişi bazlı izin sayısı"}
              accent="emerald"
            />
            <WorkspaceStatCard
              title="Bekleyen Talep"
              value={pendingRequestCount}
              caption={requestError ? "Talep özeti okunamadı" : `${approvedRequestCount} talep sonuçlandı`}
              accent="amber"
              onClick={pendingRequestCount > 0 ? () => openRequests("pending") : () => openRequests()}
              ariaLabel="Talep yönetimini aç"
            />
            <WorkspaceStatCard
              title="Plan Durumu"
              value={plannerStatus === "loading" ? "Oluşturuluyor" : plannerStatus === "done" ? "Hazır" : plannerStatus === "error" ? "Müdahale Gerekli" : "Beklemede"}
              caption={`${roleLabel} · ${currentServiceName}`}
              accent="violet"
            />
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
                  onClick={() => openRequests(pendingRequestCount > 0 ? "pending" : "")}
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

      <section className="monthly-calendar-print-area rounded-[28px] border border-slate-200 bg-white shadow-sm overflow-hidden">
        {/* Print stilleri */}
        <style>{`
          .print-only { display: none; }
          @media print {
            @page { size: A4 landscape; margin: 4mm; }
            html, body {
              background: #fff !important;
              width: 297mm !important;
              height: 210mm !important;
              min-height: 210mm !important;
              margin: 0 !important;
              overflow: hidden !important;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            #root,
            #root > * {
              width: 297mm !important;
              height: 210mm !important;
              max-height: 210mm !important;
              overflow: hidden !important;
            }
            body * { visibility: hidden !important; }
            .monthly-calendar-print-area,
            .monthly-calendar-print-area * {
              visibility: visible !important;
            }
            .monthly-calendar-print-area {
              position: fixed !important;
              top: 0 !important;
              left: 0 !important;
              width: 289mm !important;
              max-width: 289mm !important;
              height: 202mm !important;
              max-height: 202mm !important;
              border: 0 !important;
              border-radius: 0 !important;
              box-shadow: none !important;
              overflow: hidden !important;
              font-size: 8px !important;
              transform: none !important;
            }
            .monthly-calendar-print-area .print-only {
              display: block !important;
            }
            .monthly-calendar-print-area > .print-only {
              display: none !important;
            }
            .monthly-calendar-print-area .calendar-print-exclude,
            .no-print { display: none !important; }
            .monthly-calendar-print-area .person-calendar-body {
              padding: 0 !important;
            }
            .monthly-calendar-print-area .person-calendar-body > div {
              gap: 1mm !important;
            }
            .monthly-calendar-print-area .person-calendar-body .print-only {
              display: flex !important;
              align-items: center !important;
              justify-content: space-between !important;
              gap: 4mm !important;
              padding: 0 0 0.8mm 0 !important;
              margin: 0 !important;
              border-bottom: 1px solid #e2e8f0 !important;
            }
            .monthly-calendar-print-area .person-calendar-body .print-only .text-base {
              font-size: 9px !important;
              line-height: 1.1 !important;
            }
            .monthly-calendar-print-area .person-calendar-body .print-only .text-xs {
              font-size: 7px !important;
              line-height: 1.1 !important;
              margin-top: 1px !important;
            }
            .monthly-calendar-print-area .person-calendar-weekdays {
              display: grid !important;
              grid-template-columns: repeat(7, minmax(0, 1fr)) !important;
              gap: 2px !important;
              margin-bottom: 0.4mm !important;
              font-size: 7px !important;
              line-height: 1.1 !important;
            }
            .monthly-calendar-print-area .person-calendar-grid {
              display: grid !important;
              grid-template-columns: repeat(7, minmax(0, 1fr)) !important;
              gap: 2px !important;
              break-inside: avoid !important;
              page-break-inside: avoid !important;
            }
            .monthly-calendar-print-area .print-compact-day {
              min-height: 13.8mm !important;
              max-height: 13.8mm !important;
              padding: 1mm !important;
              border-width: 1px !important;
              border-radius: 4px !important;
              box-shadow: none !important;
              overflow: hidden !important;
            }
            .monthly-calendar-print-area .print-compact-day * {
              line-height: 1.1 !important;
            }
            .monthly-calendar-print-area .print-compact-day .gap-2,
            .monthly-calendar-print-area .print-compact-day .gap-1 {
              gap: 1px !important;
            }
            .monthly-calendar-print-area .print-compact-day .mt-1,
            .monthly-calendar-print-area .print-compact-day .mt-2,
            .monthly-calendar-print-area .print-compact-day .space-y-1 > * + * {
              margin-top: 1px !important;
            }
            .monthly-calendar-print-area .print-compact-day .pt-2 {
              padding-top: 1px !important;
            }
            .monthly-calendar-print-area .print-compact-day .text-lg {
              font-size: 8px !important;
            }
            .monthly-calendar-print-area .print-compact-day .text-[10px],
            .monthly-calendar-print-area .print-compact-day .text-[11px],
            .monthly-calendar-print-area .print-compact-day .text-xs {
              font-size: 6px !important;
            }
            .monthly-calendar-print-area .print-compact-day button {
              display: none !important;
            }
            .monthly-calendar-print-area .print-compact-day [class*="overflow-y-auto"] {
              overflow: hidden !important;
            }
            .monthly-calendar-print-area .print-compact-day [class*="rounded"][class*="bg-blue"] {
              max-height: 3.2mm !important;
              padding: 0 1px !important;
              overflow: hidden !important;
              white-space: nowrap !important;
              text-overflow: ellipsis !important;
            }
            .monthly-calendar-print-area .person-print-summary {
              break-inside: avoid !important;
              page-break-inside: avoid !important;
              margin-top: 1mm !important;
              max-height: 54mm !important;
              overflow: hidden !important;
            }
            .monthly-calendar-print-area .person-print-summary > div {
              padding: 1.5mm !important;
              border-width: 1px !important;
              border-radius: 5px !important;
            }
            .monthly-calendar-print-area .person-print-summary h3 {
              font-size: 7.5px !important;
              line-height: 1.1 !important;
            }
            .monthly-calendar-print-area .person-print-summary .mb-3,
            .monthly-calendar-print-area .person-print-summary .mb-4 {
              margin-bottom: 1mm !important;
            }
            .monthly-calendar-print-area .person-print-summary .h-2 {
              height: 2px !important;
            }
            .monthly-calendar-print-area .person-print-summary .grid {
              grid-template-columns: repeat(6, minmax(0, 1fr)) !important;
              gap: 1.5px !important;
            }
            .monthly-calendar-print-area .person-print-summary .grid > div {
              padding: 1mm !important;
            }
            .monthly-calendar-print-area .person-print-summary .text-2xl {
              font-size: 8.5px !important;
              line-height: 1.1 !important;
            }
            .monthly-calendar-print-area .person-print-summary .text-xs,
            .monthly-calendar-print-area .person-print-summary .text-[10px] {
              font-size: 5.8px !important;
              line-height: 1.1 !important;
            }
            .monthly-calendar-print-area .person-print-summary .mt-4 {
              margin-top: 1mm !important;
            }
            .monthly-calendar-print-area .person-print-summary .pt-4 {
              padding-top: 1mm !important;
            }
            .monthly-calendar-print-area .person-print-summary .gap-2 {
              gap: 1.5px !important;
            }
            .monthly-calendar-print-area .person-print-summary span {
              font-size: 5.8px !important;
              padding: 0.5px 2px !important;
            }
          }
        `}</style>
        <div className="print-only px-1 pb-2">
          <div className="text-lg font-bold text-slate-900">Aylık Çalışma Takvimi</div>
          <div className="mt-1 text-sm text-slate-600">
            {MONTH_LABEL(year, month)} · {currentServiceName} · {activeRole === "Doctor" ? "Doktor" : "Hemşire"}
          </div>
        </div>
        <div className="no-print border-b border-slate-200 bg-slate-50/80 px-4 py-3 md:px-5">
          <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-sm font-semibold text-slate-800">Aylık Takvim Tuvali</div>
              <div className="text-xs text-slate-500">
                Günlük atamalar, izinler ve kişi bazlı özet aynı yüzeyde gösterilir.
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-xs text-slate-500">
                {currentServiceName} · {activeRole === "Doctor" ? "Doktor" : "Hemşire"} görünümü
              </div>
              <button
                onClick={() => personCalendarRef.current?.printSchedule?.()}
                className="no-print flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 text-[13px] text-slate-600 hover:bg-slate-50"
                title="Seçili kişinin aylık nöbet çizelgesini yazdır"
              >
                🖨️ Yazdır
              </button>
              <button
                onClick={() => personCalendarRef.current?.emailSchedule?.()}
                className="no-print flex items-center gap-1.5 px-3 py-2 rounded-lg border border-sky-200 bg-sky-50 text-[13px] font-medium text-sky-700 hover:bg-sky-100"
                title="Seçili kişinin aylık nöbet çizelgesini e-posta ile gönder"
              >
                ✉️ E-posta Gönder
              </button>
            </div>
          </div>
        </div>
        <div className="person-calendar-body p-4 md:p-5">
        <PersonScheduleCalendar
          ref={personCalendarRef}
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
          leaveTypes={leaveTypes}
        />
        </div>
      </section>
    </div>
  );
}
