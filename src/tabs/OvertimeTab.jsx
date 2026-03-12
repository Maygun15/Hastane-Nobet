// src/tabs/OvertimeTab.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState, forwardRef, useImperativeHandle } from "react";
import * as XLSX from "xlsx";
import {
  FileSpreadsheet, Upload, RotateCcw, Settings, Trash2, Search, ListChecks
} from "lucide-react";
import {
  fetchMonthlySchedule,
  fetchHolidayCalendar,
  getMonthlySchedule,
} from "../api/apiAdapter";
import useActiveYM from "../hooks/useActiveYM.js";
import ToolbarYM from "../components/common/ToolbarYM.jsx";
import { LEAVE_RULES as DEFAULT_LEAVE_RULES } from "../constants/rules.js";
import { buildLeaveCreditRules } from "../utils/leaveTypeRules.js";
import { LS } from "../utils/storage.js";
import { getAllLeaves } from "../lib/leaves.js";

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

function stripDiacritics(str) {
  return (str || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/Ğ/g, "G").replace(/Ü/g, "U").replace(/Ş/g, "S").replace(/İ/g, "I")
    .replace(/Ö/g, "O").replace(/Ç/g, "C")
    .replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ş/g, "s").replace(/ı/g, "i")
    .replace(/ö/g, "o").replace(/ç/g, "c");
}
const canonName = (s) => stripDiacritics((s || "").toString().trim().toLocaleUpperCase("tr-TR")).replace(/\s+/g, " ").trim();

function buildPersonMetaIndex(source = []) {
  const combined = Array.isArray(source) ? source : [];
  const byId = new Map();
  const byCanon = new Map();
  const capture = (entry, fallbackId) => {
    if (!entry) return;
    const name = entry.fullName || entry.name || entry.displayName || entry["AD SOYAD"] || entry.personName || entry.title || "";
    if (!name || isGroupLabel(name)) return;
    const id = entry.id ?? entry.personId ?? entry.uid ?? entry.pid ?? entry.tc ?? entry.tcNo ?? entry.code ?? entry.employeeId ?? fallbackId ?? null;
    const info = {
      id: id != null ? String(id) : null,
      name,
      title: entry.title || entry.unvan || entry.position || entry.role || (entry.meta && (entry.meta.title || entry.meta.role)) || "",
      service: entry.service || entry.unit || entry.department || entry.branch || (entry.meta && (entry.meta.service || entry.meta.unit || entry.meta.department)) || "",
      tckn: entry.tckn || entry.tc || entry.tcKimlik || entry.tcNo || entry["T.C."] || entry.nationalId || "",
    };
    const canon = canonName(name);
    if (info.id) {
      const prev = byId.get(info.id);
      if (!prev || (info.title && !prev.title) || (info.service && !prev.service) || (info.tckn && !prev.tckn)) byId.set(info.id, info);
    }
    if (canon) {
      if (!byCanon.has(canon)) byCanon.set(canon, { ...info });
      else {
        const prev = byCanon.get(canon);
        if (info.title && !prev.title) prev.title = info.title;
        if (info.service && !prev.service) prev.service = info.service;
        if (info.tckn && !prev.tckn) prev.tckn = info.tckn;
      }
    }
  };
  combined.forEach((entry, idx) => capture(entry, `tmp-${idx}`));
  return { byId, byCanon };
}

function loadShiftCodeHours(preferredList) {
  try {
    const arr = Array.isArray(preferredList) ? preferredList : [];
    const map = {};
    (arr || []).forEach((x) => {
      const code = String(x?.code || "").trim().toUpperCase();
      if (!code) return;
      let hours = 0;
      if (x?.hours !== undefined && x?.hours !== null && String(x.hours).trim() !== "") {
        const n = Number(x.hours);
        hours = Number.isFinite(n) ? n : 0;
      } else if (x?.start && x?.end) {
        const start = String(x.start).split(":");
        const end = String(x.end).split(":");
        if (start.length === 2 && end.length === 2) {
          const sh = Number(start[0]) || 0, sm = Number(start[1]) || 0;
          const eh = Number(end[0]) || 0, em = Number(end[1]) || 0;
          let diff = (eh * 60 + em) - (sh * 60 + sm);
          if (!Number.isFinite(diff)) diff = 0;
          if (diff < 0) diff += 24 * 60;
          hours = Math.round((diff / 60) * 100) / 100;
        }
      }
      map[code] = hours;
    });
    return map;
  } catch { return {}; }
}

const fallbackShiftHours = (code, label = "") => {
  const c = String(code || "").trim().toUpperCase();
  const lbl = String(label || "").trim().toUpperCase();
  if (!c) {
    if (lbl.includes("YARIM") || lbl.includes("4 SAAT")) return 4;
    if (lbl.includes("POL") || lbl.includes("GÜNDÜZ") || lbl.includes("KISA")) return 8;
    return 24;
  }
  if (c.includes("4")) return 4;
  if (c.includes("8") || c === "M" || c === "GUND") return 8;
  if (c.includes("12")) return 12;
  if (["YARIM", "HALF"].some((k) => c.includes(k))) return 4;
  if (["N", "GECE", "V2", "V1", "SV", "24"].some((k) => c.includes(k))) return 24;
  if (lbl.includes("NÖBET") || lbl.includes("SORUMLU") || lbl.includes("RESÜS") || lbl.includes("TRİAJ") || lbl.includes("CERRAHİ")) return 24;
  return 24;
};

const INPUT =
  "outline-none text-center px-1.5 py-1 rounded-md border border-gray-300 bg-white " +
  "text-[14px] md:text-sm font-semibold font-mono tabular-nums leading-tight " +
  "focus:border-blue-500 focus:ring-2 focus:ring-blue-200 [appearance:textfield] [-moz-appearance:textfield]";
const TXT =
  "w-full outline-none px-2 py-1.5 rounded-md border border-gray-300 bg-white " +
  "text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200";

/* ================ LS & Model ================ */
const LS_DATA_PREFIX = "overtimeMatrixV3::";
const LS_CFG = "overtimeMatrixCfgV1";
const DEFAULT_CFG = { department: "ACİL SERVİS", unitId: "" };

const makeBlankRow = (y, m) => ({
  id: crypto.randomUUID(),
  personId: "",
  person: "",
  title: "",
  service: "",
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
const OvertimeTab = forwardRef(function OvertimeTab({ hideToolbar = false, workingHours, people: peopleProp = [], leaveTypes = [] }, ref) {
  const { ym } = useActiveYM();
  const { year, month } = ym;

  const [cfg, setCfg] = useState(() => ({ ...DEFAULT_CFG, ...(JSON.parse(localStorage.getItem(LS_CFG) || "null") || {}) }));
  const [rows, setRows] = useState(() =>
    JSON.parse(localStorage.getItem(LS_DATA_PREFIX + ymKey(year, month)) || "[]")
  );
  const [holidays, setHolidays] = useState([]);
  const [search, setSearch] = useState("");
  const fileRef = useRef(null);
  const dcount = daysInMonth(year, month);
  const shiftCodeHours = useMemo(() => loadShiftCodeHours(workingHours), [workingHours]);
  const [importing, setImporting] = useState(false);
  const leaveRules = useMemo(
    () => buildLeaveCreditRules(Array.isArray(leaveTypes) ? leaveTypes : [], DEFAULT_LEAVE_RULES),
    [leaveTypes]
  );
  const people = useMemo(() => {
    const raw = Array.isArray(peopleProp) ? peopleProp : [];
    const normalized = raw
      .map((p, idx) => ({
        id: String(p?.id ?? p?.personId ?? p?.pid ?? `p-${idx}`),
        fullName: p?.fullName || p?.name || [p?.firstName, p?.lastName].filter(Boolean).join(" ").trim(),
        title: p?.title || p?.role || "",
        service: p?.serviceId || p?.service || p?.department || "",
      }))
      .filter((p) => p.fullName);
    const svc = String(cfg.unitId || "").trim();
    if (!svc) return normalized;
    return normalized.filter((p) => String(p.service || "").trim() === svc);
  }, [peopleProp, cfg.unitId]);


  useEffect(() => localStorage.setItem(LS_CFG, JSON.stringify(cfg)), [cfg]);
  useEffect(() => {
    localStorage.setItem(LS_DATA_PREFIX + ymKey(year, month), JSON.stringify(rows));
  }, [rows, year, month]);

  useEffect(() => {
    try {
      const next = JSON.parse(localStorage.getItem(LS_DATA_PREFIX + ymKey(year, month)) || "[]");
      if (Array.isArray(next)) setRows(next);
    } catch {}
  }, [year, month]);

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

  const computed = useMemo(() => {
    const stdMonthly = computeMonthlyStdHours(year, month, holidays);
    const ym = ymKey(year, month);
    const allLocalLeaves = getAllLeaves();
    const personIdByCanon = new Map(
      (people || [])
        .map((p) => [canonName(p?.fullName || p?.name || ""), String(p?.id || "").trim()])
        .filter(([canon, pid]) => canon && pid)
    );
    const perRowLeave = rows.map((r) => {
      const rowPid = String(r.personId || "").trim();
      const canon = canonName(r.person || r.fullName || r.name || r.adsoyad || "");
      const effectivePid = rowPid || personIdByCanon.get(canon) || "";
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
      return { ...r, days: a };
    }));
  const resetMonth = () => { if (confirm("Bu ayın çizelgesi sıfırlansın mı?")) setRows([]); };
  const resetMonthSilent = () => setRows([]);

  const resolveShiftHours = useMemo(() => {
    const map = shiftCodeHours || {};
    return (code, label = "") => {
      const key = String(code || "").trim().toUpperCase();
      if (!key) return 0;
      const mapped = map[key];
      let hrs = Number.isFinite(mapped) ? Number(mapped) : NaN;
      if (!Number.isFinite(hrs) || hrs <= 0) hrs = fallbackShiftHours(key, label);
      if (!Number.isFinite(hrs) || hrs <= 0) hrs = 24;
      if (hrs > 0 && hrs < 4) hrs = 24;
      return Math.round(hrs * 100) / 100;
    };
  }, [shiftCodeHours]);

  async function importFromDutyRoster() {
    if (importing) return;
    setImporting(true);
    try {
      const rolesToTry = ["Nurse", "Doctor"];
      const assignments = [];
      const metaIndex = buildPersonMetaIndex(people);
      const findMeta = (personObj, fallbackName) => {
        if (personObj?.id && metaIndex.byId.has(String(personObj.id))) return metaIndex.byId.get(String(personObj.id));
        const name = fallbackName || personObj?.fullName || personObj?.name || "";
        const cn = canonName(name);
        if (cn && metaIndex.byCanon.has(cn)) return metaIndex.byCanon.get(cn);
        return null;
      };
      for (const role of rolesToTry) {
        const schedule = await getMonthlySchedule({
          sectionId: "calisma-cizelgesi",
          serviceId: "",
          role,
          year,
          month,
        }).catch((err) => {
          if (err?.status !== 404) console.error("getMonthlySchedule err:", err);
          return null;
        });
        const data = schedule?.data || schedule || {};
        const named = {};
        const namedRemote = data?.roster?.namedAssignments;
        if (namedRemote && typeof namedRemote === "object") {
          Object.entries(namedRemote).forEach(([dayKey, byRow]) => {
            if (!named[dayKey]) named[dayKey] = {};
            Object.entries(byRow || {}).forEach(([rowId, list]) => {
              named[dayKey][rowId] = Array.isArray(list) ? [...list] : [];
            });
          });
        }
        if (Array.isArray(data?.assignments)) {
          (data.assignments || []).forEach((a) => {
            const date = a?.date || a?.day;
            if (!date) return;
            const day = Number(String(date).slice(8, 10));
            if (!Number.isFinite(day) || day < 1 || day > dcount) return;
            // shiftCode öncelikli: shiftId (ObjectId) kullanımı saat çözümlemesini bozabiliyor.
            const rowId = String(a.shiftCode || a.shiftId || a.rowId || "");
            if (!rowId) return;
            const nm = a.personName || a.name || "";
            if (!nm || isGroupLabel(nm)) return;
            if (!named[day]) named[day] = {};
            if (!named[day][rowId]) named[day][rowId] = [];
            if (!named[day][rowId].includes(nm)) named[day][rowId].push(nm);
          });
        }
        if (!named || !Object.keys(named).length) continue;
        const defsSrc = Array.isArray(data?.defs) ? data.defs : Array.isArray(data?.rows) ? data.rows : [];
        const shiftByRow = new Map();
        const labelByRow = new Map();
        defsSrc.forEach((def) => {
          const rowId = String(def?.id ?? def?.rowId ?? "");
          if (!rowId) return;
          shiftByRow.set(rowId, def?.shiftCode || "");
          labelByRow.set(rowId, def?.label || rowId);
        });
        Object.entries(named).forEach(([dayStr, perRow]) => {
          const day = Number(dayStr);
          if (!Number.isFinite(day) || day < 1 || day > dcount) return;
          Object.entries(perRow || {}).forEach(([rowId, list]) => {
            const shiftCode = shiftByRow.get(String(rowId)) || "";
            const rowLabel = labelByRow.get(String(rowId)) || String(rowId);
            (list || []).forEach((nm) => {
              if (!nm || isGroupLabel(nm)) return;
              assignments.push({ name: nm, day, shiftCode, rowLabel, role });
            });
          });
        });
        if (Array.isArray(data?.assignments)) {
          (data.assignments || []).forEach((a) => {
            const date = a?.date || a?.day;
            if (!date) return;
            const day = Number(String(date).slice(8, 10));
            if (!Number.isFinite(day) || day < 1 || day > dcount) return;
            const nm = a.personName || a.name || "";
            if (!nm || isGroupLabel(nm)) return;
            const explicitHours = Number(a?.hours);
            if (!Number.isFinite(explicitHours) || explicitHours <= 0) return;
            const shiftCode = String(a?.shiftCode || a?.shift || a?.code || "").trim();
            const rowLabel = String(a?.roleLabel || a?.rowLabel || a?.label || "").trim();
            assignments.push({
              name: nm,
              day,
              shiftCode,
              rowLabel,
              role,
              explicitHours: Math.round(explicitHours * 100) / 100,
            });
          });
        }
      }
      if (!assignments.length) {
        alert("Aktarılacak görev ataması bulunamadı. Önce Çalışma Çizelgesi'ni doldurup kaydedin.");
        return;
      }
      const normalizedAssignments = new Map();
      assignments.forEach((item) => {
        const exactKey = [
          canonName(item.name),
          item.day,
          String(item.shiftCode || "").trim().toUpperCase(),
          String(item.rowLabel || "").trim().toUpperCase(),
        ].join("|");
        if (normalizedAssignments.has(exactKey)) return;
        normalizedAssignments.set(exactKey, item);
      });
      const byPersonDay = new Map();
      Array.from(normalizedAssignments.values()).forEach((item) => {
        const personDayKey = [canonName(item.name), item.day].join("|");
        // MonthlyHoursSheet ile aynı davranış: aynı kişi+gün için son atama kazanır.
        byPersonDay.set(personDayKey, item);
      });
      const finalAssignments = Array.from(byPersonDay.values());
      const personIndex = new Map();
      (people || []).forEach((p) => {
        const key = canonName(p.fullName || p.name || "");
        if (!key) return;
        const arr = personIndex.get(key) || [];
        arr.push(p);
        personIndex.set(key, arr);
      });
      const personRows = new Map();
      const ensureRow = (key, sourceName, personObj, metaInfo) => {
        if (personRows.has(key)) return personRows.get(key);
        const days = Array.from({ length: dcount }, () => "");
        const baseTitle = personObj?.title || personObj?.role || "";
        const row = {
          id: crypto.randomUUID(), personId: personObj?.id || "",
          person: personObj?.fullName || sourceName,
          title: (metaInfo?.title || baseTitle || "").trim(), days,
        };
        personRows.set(key, row);
        return row;
      };
      finalAssignments.forEach((item) => {
        const canon = canonName(item.name);
        const matches = canon ? personIndex.get(canon) : null;
        const personObj = Array.isArray(matches) && matches.length ? matches[0] : null;
        const meta = findMeta(personObj, item.name);
        const rowKey = personObj?.id ? `id:${personObj.id}` : `name:${canon || item.name}`;
        const row = ensureRow(rowKey, item.name, personObj, meta);
        if (!row.title) {
          const entry = meta || personObj || (Array.isArray(matches) ? matches[0] : null);
          row.title = (entry?.title || entry?.role || "").trim();
        }
        const idx = item.day - 1;
        const explicitHours = Number(item.explicitHours);
        const hours = Number.isFinite(explicitHours) && explicitHours > 0
          ? explicitHours
          : resolveShiftHours(item.shiftCode, item.rowLabel);
        row.days[idx] = hours > 0 ? Math.round(hours * 100) / 100 : "";
      });
      const newRows = Array.from(personRows.values()).sort((a, b) =>
        String(a.person || "").localeCompare(String(b.person || ""), "tr", { sensitivity: "base" })
      );
      setRows(newRows);
      alert(`Çalışma çizelgesinden ${finalAssignments.length} atama aktarıldı.`);
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
    const plan = await fetchMonthlySchedule({ personId, year, month });
    setRows((prev) => prev.map((r) => {
      if (r.id !== rowId) return r;
      const copy = { ...r, days: [...r.days] };
      for (const s of plan || []) {
        const d = new Date(s.date).getDate();
        if (d >= 1 && d <= copy.days.length) copy.days[d - 1] = Number(s.hours);
      }
      return copy;
    }));
  }

  const exportExcel = () => {
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
        if (headerIdx < 0) { alert("Excel formatı tanınamadı."); return; }
        const header = data[headerIdx].map((c) => String(c || "").trim());
        const titleCol = header.findIndex((c) => /unvan/i.test(c));
        const nameCol = header.findIndex((c) => /adı soyad/i.test(c));
        if (titleCol < 0 || nameCol < 0) { alert("Excel formatı hatalı."); return; }
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
          newRows.push({ id: crypto.randomUUID(), personId: "", person, title: String(row[titleCol] || "").trim(), service: "", days });
        }
        if (!newRows.length) { alert("Aktarılacak satır bulunamadı."); return; }
        setRows(newRows);
        alert(`${newRows.length} personel satırı Excel'den aktarıldı.`);
      } catch (err) { console.error("Excel import err:", err); alert("Excel okunurken hata oluştu."); }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  };

  const dailyTotals = useMemo(() =>
    Array.from({ length: dcount }, (_, i) => rows.reduce((sum, r) => sum + (Number(r.days[i]) || 0), 0)),
    [rows, dcount]
  );

  useImperativeHandle(ref, () => ({ importFromRoster: importFromDutyRoster, exportExcel, reset: resetMonth }));

  return (
    <div className="p-3 space-y-3">
      {!hideToolbar && (
        <ToolbarYM
          title="Fazla Mesai Takip Formu"
          leftExtras={
            <>
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-gray-50 border">
                <Settings size={16} className="opacity-70" />
                <label className="text-sm">Birim:</label>
                <input className="w-48 outline-none bg-transparent" value={cfg.department}
                  onChange={(e) => setCfg((c) => ({ ...c, department: e.target.value }))} />
                <label className="text-sm ml-2">UnitId:</label>
                <input className="w-32 outline-none bg-transparent" value={cfg.unitId}
                  onChange={(e) => setCfg((c) => ({ ...c, unitId: e.target.value }))} />
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
              <button onClick={exportExcel}
                className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700">
                <FileSpreadsheet size={16} /> .xlsx Dışa Aktar
              </button>
            </>
          }
        />
      )}

      <div className="flex items-center justify-between p-3 rounded-2xl border bg-white sticky top-0 z-20">
        <div className="text-lg font-semibold">{cfg.department}</div>
        <div className="text-sm opacity-70">
          AYLIK ÇALIŞMA SAATİ (kişi başı): <span className="font-semibold">{computed.stdMonthly}</span>
          <span className="mx-2">•</span>
          GENEL TOPLAM ÇALIŞMA: <span className="font-semibold">{computed.grandWork}</span>
          <span className="mx-2">•</span>
          TOPLAM FAZLA MESAİ: <span className="font-semibold text-rose-600">{computed.grandOT.toFixed(2)}</span>
        </div>
      </div>

      {computed.conflicts?.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          İzinli günlere yazılmış çalışma saatleri hesap dışı bırakıldı.{" "}
          {computed.conflicts.slice(0, 3).map((item) => `${item.person || "Personel"} (${item.days.join(",")})`).join(" • ")}
          {computed.conflicts.length > 3 ? ` • +${computed.conflicts.length - 3} kişi daha` : ""}
        </div>
      )}

      <div className="rounded-2xl border overflow-auto">
        <table className="min-w-full text-xs md:text-sm">
          <thead>
            <tr className="bg-gray-100 text-gray-700 text-sm sticky top-0 z-10">
              <th className="p-2 text-left sticky left-0 z-20 bg-white">Unvan</th>
              <th className="p-2 text-left sticky left-[160px] z-20 bg-white">Adı Soyadı</th>
              {Array.from({ length: dcount }, (_, i) => (
                <th key={i} className={`p-2 text-center w-[3.5rem] md:w-[3.75rem] font-mono tabular-nums border-l border-gray-200 ${isWeekend(year, month, i + 1) ? "bg-blue-50 text-blue-600" : ""}`}>
                  {i + 1}
                </th>
              ))}
              <th className="p-2 text-right">Çalışma</th>
              <th className="p-2 text-right">İzin (ÇS)</th>
              <th className="p-2 text-right">Gereken</th>
              <th className="p-2 text-right">Fazla Mesai</th>
              <th className="p-2 text-center w-12">Sil</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={dcount + 9} className="p-6 text-center text-gray-500">Kayıt yok. Personel seçin veya satır ekleyin.</td></tr>
            ) : (
              rows.map((r) => {
                const rec = computed.perRow.find((x) => x.id === r.id) || { work: 0, credited: 0, required: 0, overtime: 0 };
                const otColor = rec.overtime === 0 ? "text-gray-400" : rec.overtime <= 8 ? "text-amber-600" : "text-rose-600";
                return (
                  <tr key={r.id} className="odd:bg-white even:bg-gray-50 hover:bg-gray-100 transition-colors">
                    <td className="p-1 min-w-[160px] sticky left-0 z-10 bg-white shadow-[inset_-1px_0_0_0_rgba(0,0,0,0.06)]">
                      <input className={TXT} value={r.title} onChange={(e) => updateField(r.id, "title", e.target.value)} placeholder="Unvan" />
                    </td>
                    <td className="p-1 min-w-[220px] sticky left-[160px] z-10 bg-white shadow-[inset_-1px_0_0_0_rgba(0,0,0,0.06)]">
                      <PersonSelect
                        value={r.personId}
                        people={people.filter((p) => !search || p.fullName.toLowerCase().includes(search.toLowerCase()))}
                        onChange={(pid) => onSelectPerson(r.id, pid)}
                        displayValue={r.person}
                      />
                    </td>
                    {r.days.map((v, i) => (
                      <td key={i} className={`p-1 text-center ${isWeekend(year, month, i + 1) ? "bg-blue-50" : ""}`}>
                        <input
                          className={`${INPUT} h-8 md:h-9 w-[3.5rem] md:w-[3.75rem]`}
                          value={v === "" ? "" : v}
                          placeholder="-"
                          inputMode="decimal"
                          onChange={(e) => updateDay(r.id, i, e.target.value)}
                        />
                      </td>
                    ))}
                    <td className="p-2 text-right tabular-nums font-mono">{rec.work.toFixed(2)}</td>
                    <td className="p-2 text-right tabular-nums font-mono">{rec.credited.toFixed(2)}</td>
                    <td className="p-2 text-right tabular-nums font-mono">{rec.required.toFixed(2)}</td>
                    <td className={`p-2 text-right tabular-nums font-semibold font-mono ${otColor}`}>{rec.overtime.toFixed(2)}</td>
                    <td className="p-2 text-center">
                      <button onClick={() => removeRow(r.id)} className="p-1.5 rounded-lg hover:bg-rose-50 text-rose-600"><Trash2 size={16} /></button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="bg-gray-100 font-semibold text-xs border-t-2 border-gray-300">
                <td className="p-2 sticky left-0 bg-gray-100 z-10">TOPLAM</td>
                <td className="p-2 sticky left-[160px] bg-gray-100 z-10"></td>
                {dailyTotals.map((total, i) => (
                  <td key={i} className={`p-2 text-center tabular-nums font-mono text-xs ${isWeekend(year, month, i + 1) ? "bg-blue-100" : ""}`}>
                    {total > 0 ? total : ""}
                  </td>
                ))}
                <td className="p-2 text-right tabular-nums font-mono">{computed.grandWork.toFixed(2)}</td>
                <td className="p-2"></td>
                <td className="p-2"></td>
                <td className={`p-2 text-right tabular-nums font-mono ${computed.grandOT > 0 ? "text-rose-600" : "text-gray-400"}`}>
                  {computed.grandOT.toFixed(2)}
                </td>
                <td className="p-2"></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <div className="rounded-2xl border p-3 bg-white">
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
        className="w-full outline-none px-2 py-1.5 rounded-md border border-gray-300 bg-white text-sm"
        value={open ? q : (displayValue || "")}
        onFocus={() => { setOpen(true); setQ(""); }}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Adı Soyadı"
      />
      {open && (
        <div className="absolute z-20 mt-1 w-full max-h-56 overflow-auto bg-white border rounded-md shadow">
          {list.length === 0 ? (
            <div className="px-3 py-2 text-sm text-gray-500">Sonuç yok</div>
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
