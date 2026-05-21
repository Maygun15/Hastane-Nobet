// src/tabs/OvertimeTab.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState, forwardRef, useImperativeHandle } from "react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import {
  FileSpreadsheet, Upload, RotateCcw, Search, ListChecks, Building2, Users, Clock3, TrendingUp, Trash2
} from "lucide-react";
import {
  fetchHolidayCalendar,
} from "../api/apiAdapter";
import useActiveYM from "../hooks/useActiveYM.js";
import ToolbarYM from "../components/common/ToolbarYM.jsx";
import { LEAVE_RULES as DEFAULT_LEAVE_RULES } from "../constants/rules.js";
import { buildLeaveCreditRules } from "../utils/leaveTypeRules.js";
import {
  buildPersonIdentityIndex,
  canonName,
  choosePreferredName,
  resolvePersonRef,
} from "../utils/personIdentity.js";
import { LS } from "../utils/storage.js";
import { getAllLeaves } from "../lib/leaves.js";
import { getShifts } from "../lib/dataResolver.js";
import {
  getScheduleModelSync,
  getPersonMonthShifts,
} from "../store/monthlyScheduleModel.js";
import {
  buildWorkRowsFromPlanAssignments,
  createPlanShiftHourResolver,
} from "../utils/overtimePlanTruth.js";
import { fetchMergedScheduleTruth } from "../utils/scheduleTruth.js";
import { buildPersonDayHoursMapFromAssignments } from "../utils/planWorkCalculator.js";
import { matchesServiceSelection } from "../utils/serviceMatching.js";

/* ================ Helpers ================ */
const pad2 = (n) => String(n).padStart(2, "0");
const ymKey = (y, m) => `${y}-${pad2(m)}`;
const daysInMonth = (y, m) => new Date(y, m, 0).getDate();
const iso = (y, m, d) => `${y}-${pad2(m)}-${pad2(d)}`;
const BUILD_TRIGGER_KEY = "scheduleBuildTrigger";
const BUILD_HANDLED_KEY = "scheduleBuildHandledOvertime";
const isWeekend = (y, m, d) => {
  const dow = new Date(y, m - 1, d).getDay();
  return dow === 0 || dow === 6;
};
const isGroupLabel = (nm) =>
  !!nm &&
  /^(hemşire(ler)?|hemsire(ler)?|doktor(lar)?|personel|nurses?|doctors?)$/i.test(
    String(nm).trim()
  );
const looksDoctor = (title = "") => {
  const t = String(title || "").toLocaleUpperCase("tr-TR");
  return /\b(DR|DOKTOR|HEKIM|HEKİM|TABIP|TABİP)\b/.test(t);
};

function dedupeImportedPersonRows(rows = []) {
  const byCanon = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const canon = canonName(row?.person || "");
    if (!canon) continue;
    const existing = byCanon.get(canon);
    if (!existing) {
      byCanon.set(canon, row);
      continue;
    }
    const existingHasPersonId = !!String(existing?.personId || "").trim();
    const nextHasPersonId = !!String(row?.personId || "").trim();
    if (!existingHasPersonId && nextHasPersonId) {
      byCanon.set(canon, row);
    }
  }
  return Array.from(byCanon.values());
}

function remapOvertimeRowsWithPeople(rows = [], people = []) {
  const peopleIndex = buildPersonIdentityIndex(people);

  const merged = new Map();
  for (const row of dedupeImportedPersonRows(rows)) {
    const rowPid = String(row?.personId || "").trim();
    const rowCanon = canonName(row?.person || "");
    const person = resolvePersonRef({ personId: rowPid, name: row?.person || rowCanon }, peopleIndex);
    const resolvedPid = person ? String(person.id || "").trim() : rowPid;
    const displayName = person?.fullName || person?.name || row?.person || "";
    const key = resolvedPid ? `id:${resolvedPid}` : `name:${rowCanon || String(row?.id || crypto.randomUUID())}`;
    const current = merged.get(key);
    const next = {
      ...row,
      personId: resolvedPid,
      person: choosePreferredName(current?.person || "", displayName),
      title: person?.title || row?.title || "",
      service: person?.service || row?.service || "",
    };
    if (!current) {
      merged.set(key, next);
      continue;
    }
    const currentDays = Array.isArray(current.days) ? current.days : [];
    const nextDays = Array.isArray(next.days) ? next.days : [];
    const mergedDays = Array.from({ length: Math.max(currentDays.length, nextDays.length) }, (_, idx) => {
      const left = currentDays[idx];
      const right = nextDays[idx];
      return left !== "" && left != null ? left : (right ?? "");
    });
    merged.set(key, {
      ...current,
      ...next,
      person: choosePreferredName(current.person, next.person),
      title: next.title || current.title || "",
      service: next.service || current.service || "",
      days: mergedDays,
    });
  }

  return Array.from(merged.values());
}

function buildDerivedOvertimeRows({ assignments = [], people = [], dcount = 31, resolveShiftHours }) {
  const grouped = buildPersonDayHoursMapFromAssignments(assignments, {
    people,
    resolveHours: resolveShiftHours,
  });
  const out = [];
  const used = new Set();

  for (const person of Array.isArray(people) ? people : []) {
    const pid = String(person?.id || person?.personId || "").trim();
    const pname = person?.fullName || person?.name || "";
    const nameKey = canonName(pname);
    const truthEntry =
      (pid ? grouped.get(`id:${pid}`) : null) ||
      (nameKey ? grouped.get(`name:${nameKey}`) : null);
    const row = {
      id: pid || crypto.randomUUID(),
      personId: pid,
      person: pname,
      title: person?.title || person?.role || "",
      service: person?.service || person?.serviceId || "",
      editedDays: {},
      days: Array.from({ length: dcount }, (_, idx) => {
        const dayNum = idx + 1;
        const hours = Number(truthEntry?.byDay?.[dayNum]);
        return Number.isFinite(hours) && hours > 0 ? hours : "";
      }),
    };
    out.push(row);
    if (pid) used.add(`id:${pid}`);
    if (nameKey) used.add(`name:${nameKey}`);
  }

  for (const entry of grouped.values()) {
    const pid = String(entry?.personId || "").trim();
    const nameKey = canonName(entry?.personName || "");
    const key = pid ? `id:${pid}` : `name:${nameKey}`;
    if (used.has(key)) continue;
    out.push({
      id: pid || crypto.randomUUID(),
      personId: pid,
      person: entry?.personName || "",
      title: "",
      service: "",
      editedDays: {},
      days: Array.from({ length: dcount }, (_, idx) => {
        const dayNum = idx + 1;
        const hours = Number(entry?.byDay?.[dayNum]);
        return Number.isFinite(hours) && hours > 0 ? hours : "";
      }),
    });
  }

  return out.sort((a, b) =>
    String(a.person || "").localeCompare(String(b.person || ""), "tr", { sensitivity: "base" })
  );
}


const INPUT =
  "outline-none text-center px-1.5 py-1 rounded-md border border-slate-300 bg-white " +
  "text-[14px] md:text-sm font-semibold font-mono tabular-nums leading-tight " +
  "focus:border-blue-500 focus:ring-2 focus:ring-blue-200 [appearance:textfield] [-moz-appearance:textfield]";
const TXT =
  "w-full outline-none px-2 py-1.5 rounded-md border border-slate-300 bg-white " +
  "text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200";

/* ================ LS & Model ================ */
const LS_DATA_PREFIX = "overtimeMatrixV4::";
const LS_CFG = "overtimeMatrixCfgV1";
const DEFAULT_CFG = { department: "ACİL SERVİS", unitId: "" };

function storageScopeKey(serviceId = "") {
  const val = String(serviceId || "").trim();
  return val || "ALL";
}

function loadOvertimeRowsFromCache(year, month, serviceId = "") {
  try {
    const scopedKey = LS_DATA_PREFIX + ymKey(year, month) + "::" + storageScopeKey(serviceId);
    const raw = JSON.parse(localStorage.getItem(scopedKey) || "[]");
    return dedupeImportedPersonRows(Array.isArray(raw) ? raw : []).map((row) => ({
      ...row,
      editedDays: { ...(row?.editedDays || {}) },
    }));
  } catch {
    return [];
  }
}

const makeBlankRow = (y, m) => ({
  id: crypto.randomUUID(),
  personId: "",
  person: "",
  title: "",
  service: "",
  editedDays: {},
  days: Array.from({ length: daysInMonth(y, m) }, () => ""),
});

/* ================ Rules ================ */
const dayStandardHours = (y, m, d, hmap, { includeWeekend = false } = {}) => {
  if (!includeWeekend && isWeekend(y, m, d)) return 0;
  const k = hmap.get(iso(y, m, d));
  if (k === "full") return 0;
  if (k === "arife" || k === "half") return 4;
  return 8;
};
const computeMonthlyStdHours = (year, month, holidays) => {
  const map = new Map(holidays.map((h) => [h.date, h.kind]));
  const dim = daysInMonth(year, month);
  let tot = 0;
  for (let d = 1; d <= dim; d++) tot += dayStandardHours(year, month, d, map);
  return tot;
};

/* ================ Leaves → Credited Hours ================ */
function creditedLeaveHoursForMonth({ year, month, leaves, holidays: _holidays, codesByDay, leaveRules = {}, leaveCountsWeekend = false }) {
  if (!leaves?.length && !codesByDay) return 0;
  const dim = daysInMonth(year, month);
  const dayCredit = Array(dim).fill(0);
  const addCredit = (y, m, d, credit) => {
    if (y !== year || m !== month) return;
    if (!leaveCountsWeekend && isWeekend(y, m, d)) return;
    const idx = d - 1;
    const c = Math.min(24, Math.max(0, Number(credit) || 0));
    dayCredit[idx] = Math.max(dayCredit[idx], c);
  };
  const eachDay = (startIso, endIso, cb) => {
    const s = new Date(startIso);
    const e = new Date(endIso ?? startIso);
    for (let dt = new Date(s); dt <= e; dt.setDate(dt.getDate() + 1)) cb(new Date(dt));
  };
  if (Array.isArray(leaves) && leaves.length) {
    for (const lv of leaves) {
      eachDay(lv.start, lv.end, (dt) => {
        const y = dt.getFullYear(), m = dt.getMonth() + 1, d = dt.getDate();
        if (!leaveCountsWeekend && isWeekend(y, m, d)) return;
        const code = String(lv.code || lv.type || "").trim().toLocaleUpperCase("tr-TR");
        const rule = code ? leaveRules?.[code] : null;
        if (rule && !rule.countsAsWorked) return;
        const baseCredit = rule && Number.isFinite(rule.hoursPerDay) ? rule.hoursPerDay : 8;
        let credit = 0;
        const partial = (lv.partial || "none").toLowerCase();
        if (partial === "none") credit = baseCredit;
        else if (partial === "half_am" || partial === "half_pm") credit = baseCredit / 2;
        else if (partial === "hours") credit = Math.min(Number(lv.hours || 0), baseCredit);
        else credit = baseCredit;
        addCredit(y, m, d, credit);
      });
    }
  }
  if (codesByDay && typeof codesByDay === "object") {
    const upTR = (s) => (s ?? "").toString().trim().toLocaleUpperCase("tr");
    const parseDayKey = (k) => {
      if (Number.isFinite(Number(k))) {
        const n = Number(k);
        return n >= 1 && n <= 31 ? n : null;
      }
      const s = String(k || "").trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        const y = Number(s.slice(0, 4));
        const m = Number(s.slice(5, 7));
        const d = Number(s.slice(8, 10));
        if (y === year && m === month) return d;
        return null;
      }
      const n = parseInt(s, 10);
      return Number.isFinite(n) && n >= 1 && n <= 31 ? n : null;
    };
    for (const [k, rec] of Object.entries(codesByDay)) {
      const d = parseDayKey(k);
      if (!d) continue;
      const codeRaw = typeof rec === "string" ? rec : rec?.code;
      const code = upTR(codeRaw);
      if (!code) continue;
      const rule = leaveRules?.[code];
      if (!rule || !rule.countsAsWorked) continue;
      const hours = Number.isFinite(rule.hoursPerDay) ? rule.hoursPerDay : 8;
      addCredit(year, month, d, hours);
    }
  }
  return dayCredit.reduce((a, b) => a + b, 0);
}

function collectLeaveDaysForMonth({ year, month, leaves, codesByDay }) {
  const out = new Set();
  const markDay = (y, m, d) => {
    if (y === year && m === month && Number.isFinite(d) && d >= 1 && d <= 31) out.add(d);
  };
  const eachDay = (startIso, endIso, cb) => {
    const s = new Date(startIso);
    const e = new Date(endIso ?? startIso);
    for (let dt = new Date(s); dt <= e; dt.setDate(dt.getDate() + 1)) cb(new Date(dt));
  };
  if (Array.isArray(leaves)) {
    for (const lv of leaves) {
      const code = String(lv?.code || lv?.type || "").trim();
      if (!code) continue;
      eachDay(lv.start, lv.end, (dt) => {
        markDay(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
      });
    }
  }
  if (codesByDay && typeof codesByDay === "object") {
    for (const [k, rec] of Object.entries(codesByDay)) {
      const code = typeof rec === "string" ? rec : rec?.code;
      if (!String(code || "").trim()) continue;
      if (Number.isFinite(Number(k))) { out.add(Number(k)); continue; }
      const s = String(k || "").trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        const y = Number(s.slice(0, 4));
        const m = Number(s.slice(5, 7));
        const d = Number(s.slice(8, 10));
        markDay(y, m, d);
      }
    }
  }
  return out;
}

/* ================ Component ================ */
const OvertimeTab = forwardRef(function OvertimeTab({
  hideToolbar = false,
  workingHours,
  people: peopleProp = [],
  leaveTypes = [],
  year: controlledYear,
  month: controlledMonth,
  selectedServiceId = "",
  selectedServiceName = "",
  activeRole = "Nurse",
  servicesById = null,
}, ref) {
  const { ym } = useActiveYM();
  const year = Number(controlledYear) || Number(ym?.year) || new Date().getFullYear();
  const month = Number(controlledMonth) || Number(ym?.month) || new Date().getMonth() + 1;
  const serviceScopeKey = useMemo(() => storageScopeKey(selectedServiceId), [selectedServiceId]);
  const storageKey = useMemo(
    () => LS_DATA_PREFIX + ymKey(year, month) + "::" + serviceScopeKey,
    [year, month, serviceScopeKey]
  );

  const [cfg, setCfg] = useState(() => ({ ...DEFAULT_CFG, ...(JSON.parse(localStorage.getItem(LS_CFG) || "null") || {}) }));
  const [rows, setRows] = useState(() => loadOvertimeRowsFromCache(year, month, selectedServiceId));
  const [truthRows, setTruthRows] = useState([]);
  const [swappedPersonDays, setSwappedPersonDays] = useState(new Map()); // personId → Set<YYYY-MM-DD>
  const [holidays, setHolidays] = useState([]);
  const [search, setSearch] = useState("");
  const [scheduleChangedBanner, setScheduleChangedBanner] = useState(false);
  const fileRef = useRef(null);
  const dcount = daysInMonth(year, month);
  const [importing, setImporting] = useState(false);
  const leaveRules = useMemo(
    () => buildLeaveCreditRules(Array.isArray(leaveTypes) ? leaveTypes : [], DEFAULT_LEAVE_RULES),
    [leaveTypes]
  );
  const people = useMemo(() => {
    const raw = Array.isArray(peopleProp) ? peopleProp : [];
    const svc = String(selectedServiceId || "").trim();
    const filtered = svc ? raw.filter((p) => matchesServiceSelection({ row: p, serviceId: svc, servicesById })) : raw;
    const normalized = filtered
      .map((p, idx) => ({
        id: String(p?.id ?? p?.personId ?? p?.pid ?? `p-${idx}`),
        fullName: p?.fullName || p?.name || [p?.firstName, p?.lastName].filter(Boolean).join(" ").trim(),
        title: p?.title || p?.role || "",
        service: p?.serviceId || p?.service || p?.department || "",
      }))
      .filter((p) => p.fullName);
    const roleKey = String(activeRole || "").toLowerCase();
    if (roleKey === "doctor") {
      return normalized.filter((p) => looksDoctor(p.title || ""));
    }
    if (roleKey === "nurse") {
      return normalized.filter((p) => !looksDoctor(p.title || ""));
    }
    return normalized;
  }, [peopleProp, selectedServiceId, activeRole, servicesById]);
  const truthRoles = useMemo(
    () => (String(activeRole || "").toLowerCase() === "doctor" ? ["Doctor"] : String(activeRole || "").toLowerCase() === "nurse" ? ["Nurse"] : ["Nurse", "Doctor"]),
    [activeRole]
  );


  useEffect(() => localStorage.setItem(LS_CFG, JSON.stringify(cfg)), [cfg]);
  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(rows));
  }, [rows, storageKey]);

  useEffect(() => {
    try {
      setRows(loadOvertimeRowsFromCache(year, month, selectedServiceId));
    } catch {}
  }, [year, month, selectedServiceId]);

  useEffect(() => {
    const nextDepartment = selectedServiceName || (selectedServiceId ? String(selectedServiceId) : "TÜM SERVİSLER");
    setCfg((prev) => {
      const next = {
        ...prev,
        unitId: String(selectedServiceId || ""),
        department: nextDepartment,
      };
      if (prev.unitId === next.unitId && prev.department === next.department) return prev;
      return next;
    });
  }, [selectedServiceId, selectedServiceName]);

  useEffect(() => {
    setRows((prev) => remapOvertimeRowsWithPeople(prev, people));
  }, [people]);

  useEffect(() => {
    setRows((prev) =>
      (prev || []).map((r) => {
        const a = [...(r.days || [])];
        a.length = dcount;
        for (let i = 0; i < dcount; i++) if (typeof a[i] === "undefined") a[i] = "";
        return { ...r, days: a };
      })
    );
  }, [dcount]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const list = await fetchHolidayCalendar({ year, month });
      if (alive) setHolidays(list || []);
    };
    load();
    const onChange = () => load();
    window.addEventListener("holidays:changed", onChange);
    window.addEventListener("storage", onChange);
    return () => {
      alive = false;
      window.removeEventListener("holidays:changed", onChange);
      window.removeEventListener("storage", onChange);
    };
  }, [year, month]);

  useEffect(() => {
    const refresh = () => {
      // Recompute tetikleyicisi: izin kaynağı yalnızca getAllLeaves()
      setRows((prev) => [...prev]);
    };
    window.addEventListener("leaves:changed", refresh);
    return () => {
      window.removeEventListener("leaves:changed", refresh);
    };
  }, []);

  const effectiveWorkingHours = useMemo(
    () => (Array.isArray(workingHours) && workingHours.length > 0 ? workingHours : getShifts()),
    [workingHours]
  );
  const resolveShiftHours = useMemo(() => createPlanShiftHourResolver(effectiveWorkingHours), [effectiveWorkingHours]);
  const loadTruthRowsFromRoster = useCallback(async () => {
    const truthAssignments = await fetchMergedScheduleTruth({
      sectionId: "calisma-cizelgesi",
      serviceId: String(selectedServiceId || ""),
      roles: truthRoles,
      year,
      month,
      options: {
        people,
        resolveHours: resolveShiftHours,
        preferScheduleReadModel: true,
      },
    }).then((t) => Array.isArray(t?.assignments) ? t.assignments : [])
      .catch(() => []);

    if (truthAssignments.length) {
      // Takas/hızlı yerine atama ile değiştirilmiş atamaları işaretle
      const swapMap = new Map(); // personId → Set<YYYY-MM-DD>
      for (const a of truthAssignments) {
        if (!['swap', 'quickReplace'].includes(a.source)) continue;
        const pid = String(a.personId || '').trim();
        const date = String(a.date || '').slice(0, 10);
        if (!pid || !date) continue;
        if (!swapMap.has(pid)) swapMap.set(pid, new Set());
        swapMap.get(pid).add(date);
      }
      setSwappedPersonDays(swapMap);
      return buildDerivedOvertimeRows({
        assignments: truthAssignments,
        people,
        dcount,
        resolveShiftHours,
      }).map((row) => ({ ...row, editedDays: {} }));
    }
    return [];
  }, [dcount, month, people, resolveShiftHours, selectedServiceId, year, truthRoles]);

  useEffect(() => {
    let active = true;
    const refreshTruth = async () => {
      const nextRows = await loadTruthRowsFromRoster();
      if (active) setTruthRows(nextRows);
    };
    refreshTruth();
    const onRefresh = () => refreshTruth();
    window.addEventListener("schedule:saved", onRefresh);
    window.addEventListener("schedule:built", onRefresh);
    window.addEventListener("schedule:invalidated", onRefresh);
    window.addEventListener("planner:changed", onRefresh);
    window.addEventListener("storage", onRefresh);
    return () => {
      active = false;
      window.removeEventListener("schedule:saved", onRefresh);
      window.removeEventListener("schedule:built", onRefresh);
      window.removeEventListener("schedule:invalidated", onRefresh);
      window.removeEventListener("planner:changed", onRefresh);
      window.removeEventListener("storage", onRefresh);
    };
  }, [loadTruthRowsFromRoster]);

  useEffect(() => {
    if (!Array.isArray(truthRows) || truthRows.length === 0) return;
    setRows((prev) => {
      const next = truthRows.map((row) => ({
        ...row,
        editedDays: {},
        days: Array.from({ length: dcount }, (_, idx) => {
          const hours = Number(row?.days?.[idx]);
          return Number.isFinite(hours) && hours > 0 ? hours : "";
        }),
      }));
      const changed = JSON.stringify(next) !== JSON.stringify(prev);
      if (changed) setScheduleChangedBanner(true);
      return changed ? next : prev;
    });
  }, [truthRows, dcount]);

  const computed = useMemo(() => {
    const stdMonthly = computeMonthlyStdHours(year, month, holidays);
    const ym = ymKey(year, month);
    const allLocalLeaves = getAllLeaves();
    const peopleIndex = buildPersonIdentityIndex(people);
    const perRowLeave = rows.map((r) => {
      const rowPid = String(r.personId || "").trim();
      const person = resolvePersonRef(
        { personId: rowPid, name: r.person || r.fullName || r.name || r.adsoyad || "" },
        peopleIndex
      );
      const effectivePid = rowPid || String(person?.id || "").trim();
      const localCodes = effectivePid ? (allLocalLeaves?.[effectivePid]?.[ym] || {}) : {};
      const leaveDays = collectLeaveDaysForMonth({ year, month, codesByDay: localCodes });
      const credited = creditedLeaveHoursForMonth({ year, month, holidays, codesByDay: localCodes, leaveRules, leaveCountsWeekend: true });
      let ignoredHours = 0;
      (r.days || []).forEach((val, idx) => {
        if (!leaveDays.has(idx + 1)) return;
        ignoredHours += Number(val) || 0;
      });
      return { id: r.id, credited, leaveDays, ignoredHours };
    });
    const perRow = rows.map((r) => {
      const leaveMeta = perRowLeave.find((x) => x.id === r.id) || { credited: 0, leaveDays: new Set(), ignoredHours: 0 };
      const work = (r.days || []).reduce((sum, val, idx) => {
        if (leaveMeta.leaveDays.has(idx + 1)) return sum;
        return sum + (Number(val) || 0);
      }, 0);
      const credited = leaveMeta.credited || 0;
      const required = Math.max(0, stdMonthly - credited);
      const overtime = Math.max(0, work - required);
      return {
        id: r.id, work, credited, required, overtime,
        ignoredHours: leaveMeta.ignoredHours || 0,
        conflictDays: Array.from(leaveMeta.leaveDays.values()).filter((day) => (Number(r.days?.[day - 1]) || 0) > 0),
      };
    });
    const grandWork = perRow.reduce((a, b) => a + b.work, 0);
    const grandOT = perRow.reduce((a, b) => a + b.overtime, 0);
    const conflicts = perRow.filter((row) => row.ignoredHours > 0).map((row) => ({
      id: row.id, ignoredHours: row.ignoredHours, days: row.conflictDays || [],
      person: rows.find((r) => r.id === row.id)?.person || "",
    }));
    return { stdMonthly, perRow, grandWork, grandOT, conflicts };
  }, [rows, people, year, month, holidays, leaveRules]);

  const addRow = () => setRows((p) => [...p, makeBlankRow(year, month)]);
  const removeRow = (id) => setRows((p) => p.filter((r) => r.id !== id));
  const updateField = (id, key, value) => setRows((p) => p.map((r) => (r.id === id ? { ...r, [key]: value } : r)));
  const updateDay = (id, idx, val) =>
    setRows((p) => p.map((r) => {
      if (r.id !== id) return r;
      const a = [...r.days];
      const v = String(val).replace(",", ".");
      a[idx] = v === "" ? "" : Number(v);
      return { ...r, days: a, editedDays: { ...(r?.editedDays || {}), [idx]: true } };
    }));
  const resetMonth = () => { if (confirm("Bu ayın çizelgesi sıfırlansın mı?")) setRows([]); };
  const resetMonthSilent = () => setRows([]);

  async function importFromDutyRoster() {
    if (importing) return;
    setImporting(true);
    try {
      const newRows = await loadTruthRowsFromRoster();
      if (!newRows.length) {
        toast.warning("Çizelge henüz oluşturulmamış", {
          description: "Önce Planlama Kontrol Merkezi'nden çalışma çizelgesi oluşturun.",
        });
        return;
      }
      setRows(newRows);
      setTruthRows(newRows);
      const assignedDays = newRows.reduce(
        (sum, row) => sum + (row.days || []).filter((h) => Number(h) > 0).length,
        0
      );
      toast.success(`${newRows.length} personel aktarıldı`, {
        description: `${assignedDays} gün ataması çalışma çizelgesinden yüklendi.`,
      });
    } finally { setImporting(false); }
  }

  const handleScheduleBuild = useCallback(() => {
    const trig = LS.get(BUILD_TRIGGER_KEY, null);
    if (!trig?.ym || !trig?.ts) return;
    const currentYm = ymKey(year, month);
    if (trig.ym !== currentYm) return;
    const last = Number(LS.get(BUILD_HANDLED_KEY, 0));
    if (trig.ts <= last) return;
    resetMonthSilent();
    importFromDutyRoster();
    LS.set(BUILD_HANDLED_KEY, trig.ts);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month, importing]);

  useEffect(() => {
    handleScheduleBuild();
    window.addEventListener("schedule:built", handleScheduleBuild);
    window.addEventListener("storage", handleScheduleBuild);
    return () => {
      window.removeEventListener("schedule:built", handleScheduleBuild);
      window.removeEventListener("storage", handleScheduleBuild);
    };
  }, [handleScheduleBuild]);

  async function onSelectPerson(rowId, personId) {
    const p = people.find((x) => x.id === personId);
    setRows((prev) => prev.map((r) => r.id === rowId ? { ...r, personId, person: p?.fullName || "", title: p?.title || "", service: p?.service || "" } : r));
    const rowMatch =
      truthRows.find((row) => String(row?.personId || "") === String(personId || ""))
      || truthRows.find((row) => canonName(row?.person || "") === canonName(p?.fullName || p?.name || ""));
    setRows((prev) => prev.map((r) => {
      if (r.id !== rowId) return r;
      const copy = { ...r, days: Array.from({ length: dcount }, () => ""), editedDays: {} };
      if (rowMatch && Array.isArray(rowMatch.days)) {
        for (let idx = 0; idx < Math.min(copy.days.length, rowMatch.days.length); idx++) {
          const hours = Number(rowMatch.days[idx]);
          copy.days[idx] = Number.isFinite(hours) ? hours : "";
        }
        return copy;
      }

      const model = getScheduleModelSync({
        sectionId: "calisma-cizelgesi",
        serviceId: String(selectedServiceId || ""),
        role: "",
        year,
        month,
        people,
      });
      const dayMap = getPersonMonthShifts({
        model,
        personId,
        personName: p?.fullName || p?.name || "",
      });
      for (const [dayKey, entry] of Object.entries(dayMap || {})) {
        const d = Number(dayKey);
        if (!Number.isFinite(d) || d < 1 || d > copy.days.length) continue;
        const explicit = Number(entry?.hours);
        const val = Number.isFinite(explicit) && explicit > 0
          ? explicit
          : resolveShiftHours(entry?.shiftCode, entry?.rowLabel);
        copy.days[d - 1] = Number.isFinite(val) ? val : "";
      }
      return copy;
    }));
  }

  const [exporting, setExporting] = useState(false);
  const exportExcel = () => {
    if (exporting) return;
    setExporting(true);
    try {
      const header1 = [cfg.department, "", ...Array(dcount - 1).fill(""), "AYLIK ÇALIŞMA SAATİ (kişi başı):", computed.stdMonthly];
      const header2 = ["Unvan", "Adı Soyadı", ...Array.from({ length: dcount }, (_, i) => `${i + 1}`), "Çalışma", "İzin(ÇS)", "Gereken", "Fazla Mesai"];
      const body = rows.map((r) => {
        const rec = computed.perRow.find((x) => x.id === r.id) || { work: 0, credited: 0, required: 0, overtime: 0 };
        return [r.title || "", r.person || "", ...r.days.map((x) => (x === "" ? "" : Number(x))), Number(rec.work.toFixed(2)), Number(rec.credited.toFixed(2)), Number(rec.required.toFixed(2)), Number(rec.overtime.toFixed(2))];
      });
      const totalsRow = ["TOPLAM", "", ...Array.from({ length: dcount }, (_, i) => rows.reduce((sum, r) => sum + (Number(r.days[i]) || 0), 0)), Number(computed.grandWork.toFixed(2)), "", "", Number(computed.grandOT.toFixed(2))];
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet([header1, header2, ...body, totalsRow]);
      ws["!cols"] = [{ wch: 16 }, { wch: 24 }, ...Array.from({ length: dcount }, () => ({ wch: 5 })), { wch: 9 }, { wch: 9 }, { wch: 9 }, { wch: 10 }];
      XLSX.utils.book_append_sheet(wb, ws, `FazlaMesai-${ymKey(year, month)}`);
      XLSX.writeFile(wb, `fazla-mesai-${ymKey(year, month)}.xlsx`, { compression: true });
    } finally {
      setExporting(false);
    }
  };

  const handleExcelImport = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const wb = XLSX.read(evt.target.result, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
        const headerIdx = data.findIndex((row) => row.some((c) => /unvan|adı soyad/i.test(String(c || ""))));
        if (headerIdx < 0) {
          toast.error("Excel formatı tanınamadı", { description: "Başlık satırı 'Unvan' ve 'Adı Soyadı' sütunlarını içermelidir." });
          return;
        }
        const header = data[headerIdx].map((c) => String(c || "").trim());
        const titleCol = header.findIndex((c) => /unvan/i.test(c));
        const nameCol = header.findIndex((c) => /adı soyad/i.test(c));
        if (titleCol < 0 || nameCol < 0) {
          toast.error("Sütun bulunamadı", { description: "Excel'de 'Unvan' ve 'Adı Soyadı' sütunları olmalıdır." });
          return;
        }
        const newRows = [];
        for (let i = headerIdx + 1; i < data.length; i++) {
          const row = data[i];
          const person = String(row[nameCol] || "").trim();
          if (!person || /toplam/i.test(person)) continue;
          const days = Array.from({ length: dcount }, (_, d) => {
            const colIdx = header.findIndex((c) => c === String(d + 1));
            if (colIdx < 0) return "";
            const v = row[colIdx];
            return v === "" || v === undefined ? "" : Number(v);
          });
          const editedDays = {};
          days.forEach((value, idx) => {
            if (value !== "" && value != null) editedDays[idx] = true;
          });
          newRows.push({ id: crypto.randomUUID(), personId: "", person, title: String(row[titleCol] || "").trim(), service: "", editedDays, days });
        }
        if (!newRows.length) {
          toast.warning("Aktarılacak satır bulunamadı", { description: "Excel dosyası veri satırı içermiyor." });
          return;
        }
        setRows(newRows);
        toast.success(`${newRows.length} personel Excel'den aktarıldı`);
      } catch (err) { console.error("Excel import err:", err); toast.error("Excel okunamadı", { description: "Dosya bozuk veya desteklenmeyen formatta." }); }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  };

  const filteredRows = useMemo(() => {
    const q = canonName(search || "");
    if (!q) return rows;
    return (rows || []).filter((r) => canonName(`${r.person || ""} ${r.title || ""}`).includes(q));
  }, [rows, search]);

  const dailyTotals = useMemo(() =>
    Array.from({ length: dcount }, (_, i) => filteredRows.reduce((sum, r) => sum + (Number(r.days[i]) || 0), 0)),
    [filteredRows, dcount]
  );

  const summaryLabel = selectedServiceName || cfg.department || "TÜM SERVİSLER";

  useImperativeHandle(ref, () => ({ importFromRoster: importFromDutyRoster, exportExcel, reset: resetMonth }));

  return (
    <div className="p-3 space-y-3">
      {!hideToolbar && (
        <ToolbarYM
          title="Fazla Mesai Takip Formu"
          leftExtras={
            <>
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-50 border text-sm text-slate-700">
                <Building2 size={16} className="opacity-70" />
                <span>{summaryLabel}</span>
              </div>
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl border bg-white">
                <Search size={16} className="opacity-70" />
                <input className="outline-none bg-transparent" placeholder="Personel ara"
                  value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
            </>
          }
          rightExtras={
            <>
              <button onClick={resetMonth}
                className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-rose-600 text-white hover:bg-rose-700">
                <RotateCcw size={16} /> Sıfırla
              </button>
              <button onClick={importFromDutyRoster} disabled={importing}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-xl ${importing ? "bg-blue-200 text-blue-700 cursor-wait" : "bg-blue-600 text-white hover:bg-blue-700"}`}>
                <ListChecks size={16} />
                {importing ? "Dolduruluyor…" : "Çizelgeden Doldur"}
              </button>
              <button onClick={() => fileRef.current?.click()}
                className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700">
                <Upload size={16} /> Excel Yükle
              </button>
              <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
                onChange={handleExcelImport} />
              <button onClick={exportExcel} disabled={exporting}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-xl text-white ${exporting ? "bg-emerald-400 cursor-wait" : "bg-emerald-600 hover:bg-emerald-700"}`}>
                <FileSpreadsheet size={16} /> {exporting ? "Hazırlanıyor…" : ".xlsx Dışa Aktar"}
              </button>
            </>
          }
        />
      )}

      <div className="sticky top-0 z-30 rounded-card border border-slate-200 bg-white p-4 shadow-card">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700">
                <Building2 className="h-3.5 w-3.5 text-sky-600" />
                {summaryLabel}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700">
                <Users className="h-3.5 w-3.5 text-emerald-600" />
                {filteredRows.length} personel
              </span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <label className="flex min-w-[260px] items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <Search size={16} className="text-slate-400" />
                <input
                  className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
                  placeholder="Personel veya unvan ara"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              <div className="text-xs text-slate-500">
                Liste, üst çubuktaki <span className="font-semibold text-slate-700">Çizelgeden Doldur</span> butonuyla doğrudan çalışma çizelgesinden beslenir.
              </div>
              <div className="text-xs text-slate-400 mt-1">
                Saat girişi: virgül veya nokta kullanabilirsiniz — ör: <span className="font-mono text-slate-500">8</span>, <span className="font-mono text-slate-500">8,5</span>, <span className="font-mono text-slate-500">8.5</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 xl:min-w-[520px]">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">
                <Clock3 className="h-3.5 w-3.5 text-amber-600" />
                Aylık Standart
              </div>
              <div className="mt-2 text-2xl font-semibold text-slate-900">{computed.stdMonthly}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">
                <Users className="h-3.5 w-3.5 text-sky-600" />
                Toplam Çalışma
              </div>
              <div className="mt-2 text-2xl font-semibold text-slate-900">{computed.grandWork.toFixed(2)}</div>
            </div>
            <div className="rounded-2xl border border-rose-200 bg-rose-50/70 px-4 py-3">
              <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-rose-700">
                <TrendingUp className="h-3.5 w-3.5" />
                Toplam Fazla Mesai
              </div>
              <div className="mt-2 text-2xl font-semibold text-rose-700">{computed.grandOT.toFixed(2)}</div>
            </div>
          </div>
        </div>
      </div>

      {computed.conflicts?.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          İzinli günlere yazılmış çalışma saatleri hesap dışı bırakıldı.{" "}
          {computed.conflicts.slice(0, 3).map((item) => `${item.person || "Personel"} (${item.days.join(",")})`).join(" • ")}
          {computed.conflicts.length > 3 ? ` • +${computed.conflicts.length - 3} kişi daha` : ""}
        </div>
      )}

      {scheduleChangedBanner && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-amber-800">
            <span className="text-amber-500">⚡</span>
            Çizelgede değişiklik yapıldı — aylık saat toplamları güncellendi.
          </div>
          <button onClick={() => setScheduleChangedBanner(false)} className="text-amber-600 hover:text-amber-800 text-xs font-medium transition-colors">
            Tamam
          </button>
        </div>
      )}

      <div className="rounded-card border border-slate-200 bg-white shadow-card overflow-auto max-h-[calc(100vh-22rem)]">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className="p-2.5 text-left sticky left-0 z-20 bg-white text-xs font-semibold text-ink-muted uppercase tracking-wide border-b-2 border-brand-600 shadow-[2px_0_6px_-2px_rgba(13,27,62,0.08)]">Unvan</th>
              <th className="p-2.5 text-left sticky left-[160px] z-20 bg-white text-xs font-semibold text-ink-muted uppercase tracking-wide border-b-2 border-brand-600 shadow-[2px_0_6px_-2px_rgba(13,27,62,0.08)]">Adı Soyadı</th>
              {Array.from({ length: dcount }, (_, i) => (
                <th key={i} className={`p-2.5 text-center w-[3.5rem] font-mono tabular-nums text-xs font-semibold border-b-2 ${isWeekend(year, month, i + 1) ? "bg-blue-50 text-blue-600 border-blue-300" : "bg-white text-ink-muted border-brand-600"}`}>
                  {i + 1}
                </th>
              ))}
              <th className="p-2.5 text-right text-xs font-semibold text-ink-muted uppercase tracking-wide bg-white border-b-2 border-brand-600">Çalışma</th>
              <th className="p-2.5 text-right text-xs font-semibold text-ink-muted uppercase tracking-wide bg-white border-b-2 border-brand-600">İzin (ÇS)</th>
              <th className="p-2.5 text-right text-xs font-semibold text-ink-muted uppercase tracking-wide bg-white border-b-2 border-brand-600">Gereken</th>
              <th className="p-2.5 text-right text-xs font-semibold text-ink-muted uppercase tracking-wide bg-white border-b-2 border-brand-600">Fazla Mesai</th>
              <th className="p-2.5 text-center w-12 text-xs font-semibold text-ink-faint bg-white border-b-2 border-brand-600">Sil</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredRows.length === 0 ? (
              <tr><td colSpan={dcount + 9} className="p-8 text-center text-ink-faint">Kayıt yok. Personel seçin veya satır ekleyin.</td></tr>
            ) : (
              filteredRows.map((r) => {
                const rec = computed.perRow.find((x) => x.id === r.id) || { work: 0, credited: 0, required: 0, overtime: 0 };
                const otColor = rec.overtime === 0 ? "text-slate-400" : rec.overtime <= 8 ? "text-amber-600" : "text-rose-600";
                return (
                  <tr key={r.id} className="odd:bg-white even:bg-slate-50/50 hover:bg-blue-50/30 transition-colors">
                    <td className="p-1 min-w-[160px] sticky left-0 z-10 bg-white border-r border-slate-200 shadow-[2px_0_6px_-2px_rgba(13,27,62,0.06)]">
                      <input className={TXT} value={r.title} onChange={(e) => updateField(r.id, "title", e.target.value)} placeholder="Unvan" />
                    </td>
                    <td className="p-1 min-w-[220px] sticky left-[160px] z-10 bg-white border-r border-slate-200 shadow-[2px_0_6px_-2px_rgba(13,27,62,0.06)]">
                      <PersonSelect
                        value={r.personId}
                        people={people.filter((p) => !search || p.fullName.toLowerCase().includes(search.toLowerCase()))}
                        onChange={(pid) => onSelectPerson(r.id, pid)}
                        displayValue={r.person}
                      />
                    </td>
                    {r.days.map((v, i) => {
                      const ymd = `${year}-${String(month).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`;
                      const isSwapped = swappedPersonDays.get(String(r.personId || ""))?.has(ymd) ?? false;
                      return (
                        <td key={i} className={`p-1 text-center relative ${isWeekend(year, month, i + 1) ? "bg-blue-50" : ""} ${isSwapped ? "bg-orange-50" : ""}`}>
                          <input
                            className={`${INPUT} h-8 w-[3.5rem] ${isSwapped ? "border-orange-300" : ""}`}
                            value={v === "" ? "" : v}
                            placeholder="-"
                            inputMode="decimal"
                            title={isSwapped ? "Bu gün takas ile değiştirildi" : "Çalışılan saat (örn: 8 veya 8,5)"}
                            aria-label={`${i + 1}. gün çalışma saati`}
                            onChange={(e) => updateDay(r.id, i, e.target.value)}
                          />
                          {isSwapped && (
                            <span className="absolute top-0 right-0 text-[7px] bg-orange-500 text-white px-0.5 rounded-bl leading-tight select-none">⇆</span>
                          )}
                        </td>
                      );
                    })}
                    <td className="p-2 text-right tabular-nums font-mono text-ink">{rec.work.toFixed(2)}</td>
                    <td className="p-2 text-right tabular-nums font-mono text-ink-muted">{rec.credited.toFixed(2)}</td>
                    <td className="p-2 text-right tabular-nums font-mono text-ink-muted">{rec.required.toFixed(2)}</td>
                    <td className={`p-2 text-right tabular-nums font-semibold font-mono ${otColor}`}>{rec.overtime.toFixed(2)}</td>
                    <td className="p-2 text-center">
                      <button onClick={() => removeRow(r.id)} className="p-1.5 rounded-lg hover:bg-rose-50 text-rose-500 transition-colors"><Trash2 size={15} /></button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          {filteredRows.length > 0 && (
            <tfoot>
              <tr className="bg-slate-50 font-semibold border-t-2 border-brand-200">
                <td className="p-2.5 sticky left-0 bg-slate-50 z-10 text-xs uppercase tracking-wide text-ink-muted">Toplam</td>
                <td className="p-2.5 sticky left-[160px] bg-slate-50 z-10"></td>
                {dailyTotals.map((total, i) => (
                  <td key={i} className={`p-2.5 text-center tabular-nums font-mono text-sm ${isWeekend(year, month, i + 1) ? "text-blue-600 bg-blue-50/50" : "text-ink"}`}>
                    {total > 0 ? total : ""}
                  </td>
                ))}
                <td className="p-2.5 text-right tabular-nums font-mono text-ink">{computed.grandWork.toFixed(2)}</td>
                <td className="p-2.5"></td>
                <td className="p-2.5"></td>
                <td className={`p-2.5 text-right tabular-nums font-mono font-bold ${computed.grandOT > 0 ? "text-brand-600" : "text-ink-faint"}`}>
                  {computed.grandOT.toFixed(2)}
                </td>
                <td className="p-2.5"></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <div className="rounded-[22px] border border-slate-200 p-3 bg-white shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-medium">Personel Listesi</div>
          <button onClick={addRow} className="text-sm px-3 py-1 rounded-lg bg-blue-600 text-white hover:bg-blue-700">
            + Boş Satır Ekle
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 max-h-64 overflow-auto">
          {people
            .filter((p) => !search || p.fullName.toLowerCase().includes(search.toLowerCase()))
            .map((p) => (
              <button key={p.id}
                onClick={() => setRows((prev) => [...prev, { ...makeBlankRow(year, month), personId: p.id, person: p.fullName, title: p.title, service: p.service }])}
                className="text-left p-2 rounded-lg border hover:bg-blue-50">
                <div className="font-medium">{p.fullName}</div>
                <div className="text-xs opacity-70">{p.title} · {p.service}</div>
              </button>
            ))}
        </div>
      </div>
    </div>
  );
});

export default OvertimeTab;

function PersonSelect({ value, people, onChange, displayValue }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const containerRef = useRef(null);
  const list = people.filter((p) => !q || p.fullName.toLowerCase().includes(q.toLowerCase()));

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
        setQ("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative" ref={containerRef}>
      <input
        className="w-full outline-none px-2 py-1.5 rounded-md border border-slate-300 bg-white text-sm"
        value={open ? q : (displayValue || "")}
        onFocus={() => { setOpen(true); setQ(""); }}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Adı Soyadı"
      />
      {open && (
        <div className="absolute z-20 mt-1 w-full max-h-56 overflow-auto bg-white border rounded-md shadow">
          {list.length === 0 ? (
            <div className="px-3 py-2 text-sm text-slate-500">Sonuç yok</div>
          ) : (
            list.map((p) => (
              <div key={p.id}
                className="px-3 py-2 text-sm hover:bg-blue-50 cursor-pointer"
                onMouseDown={() => { onChange(p.id); setOpen(false); setQ(""); }}>
                <div className="font-medium">{p.fullName}</div>
                <div className="text-xs opacity-70">{p.title} · {p.service}</div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
