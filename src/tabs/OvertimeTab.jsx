// src/tabs/OvertimeTab.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState, forwardRef, useImperativeHandle } from "react";
import * as XLSX from "xlsx";
import {
  FileSpreadsheet, Upload, RotateCcw, Settings, Trash2, Search, ListChecks
} from "lucide-react";
import {
  fetchPersonnel,
  fetchMonthlySchedule,
  fetchHolidayCalendar,
  fetchLeaves,
  getMonthlySchedule,
} from "../api/apiAdapter";
import { getPeople } from "../lib/dataResolver.js";
import { STAFF_KEY } from "../engine/rosterEngine.js";
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
  const dow = new Date(y, m - 1, d).getDay(); // 0=Pa,6=Cts
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

function readArrayLS(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const val = JSON.parse(raw);
    if (Array.isArray(val)) return val;
    if (val && typeof val === "object") {
      const out = [];
      Object.values(val).forEach((v) => {
        if (Array.isArray(v)) out.push(...v);
      });
      return out;
    }
  } catch {
    /* no-op */
  }
  return [];
}

function buildPersonMetaIndex() {
  const combined = [
    ...readArrayLS("nurses"),
    ...readArrayLS("doctors"),
    ...readArrayLS(STAFF_KEY),
  ];
  const peopleExtra = getPeople();
  if (Array.isArray(peopleExtra)) combined.push(...peopleExtra);

  const byId = new Map();
  const byCanon = new Map();

  const capture = (entry, fallbackId) => {
    if (!entry) return;
    const name =
      entry.fullName ||
      entry.name ||
      entry.displayName ||
      entry["AD SOYAD"] ||
      entry.personName ||
      entry.title ||
      "";
    if (!name || isGroupLabel(name)) return;
    const id =
      entry.id ??
      entry.personId ??
      entry.uid ??
      entry.pid ??
      entry.tc ??
      entry.tcNo ??
      entry.code ??
      entry.employeeId ??
      fallbackId ??
      null;
    const info = {
      id: id != null ? String(id) : null,
      name,
      title:
        entry.title ||
        entry.unvan ||
        entry.position ||
        entry.role ||
        (entry.meta && (entry.meta.title || entry.meta.role)) ||
        "",
      service:
        entry.service ||
        entry.unit ||
        entry.department ||
        entry.branch ||
        (entry.meta && (entry.meta.service || entry.meta.unit || entry.meta.department)) ||
        "",
    };
    const canon = canonName(name);
    if (info.id) {
      const prev = byId.get(info.id);
      if (!prev || (info.title && !prev.title) || (info.service && !prev.service)) {
        byId.set(info.id, info);
      }
    }
    if (canon) {
      if (!byCanon.has(canon)) {
        byCanon.set(canon, { ...info });
      } else {
        const prev = byCanon.get(canon);
        if (info.title && !prev.title) prev.title = info.title;
        if (info.service && !prev.service) prev.service = info.service;
      }
    }
  };

  combined.forEach((entry, idx) => capture(entry, `tmp-${idx}`));

  return { byId, byCanon };
}

function loadShiftCodeHours() {
  try {
    const arr = JSON.parse(localStorage.getItem("workingHours") || "[]");
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
          const sh = Number(start[0]) || 0;
          const sm = Number(start[1]) || 0;
          const eh = Number(end[0]) || 0;
          const em = Number(end[1]) || 0;
          let diff = (eh * 60 + em) - (sh * 60 + sm);
          if (!Number.isFinite(diff)) diff = 0;
          if (diff < 0) diff += 24 * 60;
          hours = Math.round((diff / 60) * 100) / 100;
        }
      }
      map[code] = hours;
    });
    return map;
  } catch {
    return {};
  }
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

/* ================ Rules: Holidays & Required Hours ================ */
const dayStandardHours = (y, m, d, hmap) => {
  if (isWeekend(y, m, d)) return 0;
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
function creditedLeaveHoursForMonth({ year, month, leaves, holidays, codesByDay, leaveRules = {} }) {
  if (!leaves?.length && !codesByDay) return 0;
  const hmap = new Map(holidays.map((h) => [h.date, h.kind]));
  const dim = daysInMonth(year, month);
  const dayCredit = Array(dim).fill(0);

  const addCredit = (y, m, d, credit) => {
    if (y !== year || m !== month) return;
    const std = dayStandardHours(y, m, d, hmap);
    if (std === 0) return;
    const idx = d - 1;
    const c = Math.min(std, Math.max(0, Number(credit) || 0));
    dayCredit[idx] = Math.min(std, dayCredit[idx] + c);
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
        const std = dayStandardHours(y, m, d, hmap);
        if (std === 0) return;

        let credit = 0;
        const partial = (lv.partial || "none").toLowerCase();
        if (partial === "none") credit = std;
        else if (partial === "half_am" || "half_pm") credit = std / 2;
        else if (partial === "hours") credit = Math.min(Number(lv.hours || 0), std);
        else credit = std;

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
      if (/^\\d{4}-\\d{2}-\\d{2}$/.test(s)) {
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

/* ================ Component ================ */
const OvertimeTab = forwardRef(function OvertimeTab({ hideToolbar = false }, ref) {
  // Tek AY/YIL kaynağı
  const { ym } = useActiveYM();
  const { year, month } = ym;

  const [cfg, setCfg] = useState(() => ({ ...DEFAULT_CFG, ...(JSON.parse(localStorage.getItem(LS_CFG) || "null") || {}) }));
  const [rows, setRows] = useState(() =>
    JSON.parse(localStorage.getItem(LS_DATA_PREFIX + ymKey(year, month)) || "[]")
  );

  const [people, setPeople] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [leavesByPerson, setLeavesByPerson] = useState({});
  const [search, setSearch] = useState("");
  const fileRef = useRef(null);
  const dcount = daysInMonth(year, month);
  const shiftCodeHours = useMemo(() => loadShiftCodeHours(), []);
  const [importing, setImporting] = useState(false);
  const [leaveVersion, setLeaveVersion] = useState(0);
  const [leaveRules, setLeaveRules] = useState(() =>
    buildLeaveCreditRules(LS.get("leaveTypesV2", []), DEFAULT_LEAVE_RULES)
  );

  /* persist */
  useEffect(() => localStorage.setItem(LS_CFG, JSON.stringify(cfg)), [cfg]);
  useEffect(() => {
    localStorage.setItem(LS_DATA_PREFIX + ymKey(year, month), JSON.stringify(rows));
  }, [rows, year, month]);

  /* ay/yıl değişince mevcut kayıtları yükle */
  useEffect(() => {
    try {
      const next = JSON.parse(localStorage.getItem(LS_DATA_PREFIX + ymKey(year, month)) || "[]");
      if (Array.isArray(next)) setRows(next);
    } catch {}
  }, [year, month]);

  /* gün sayısı değişince normalize */
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

  /* personnel */
  useEffect(() => {
    (async () => {
      const list = await fetchPersonnel({ unitId: cfg.unitId || undefined, active: true });
      setPeople(list || []);
    })();
  }, [cfg.unitId]);

  /* holidays */
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

  /* leave types -> rules */
  useEffect(() => {
    const refresh = () => {
      setLeaveRules(buildLeaveCreditRules(LS.get("leaveTypesV2", []), DEFAULT_LEAVE_RULES));
    };
    window.addEventListener("leaveTypes:changed", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("leaveTypes:changed", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  /* local leave changes */
  useEffect(() => {
    const refresh = () => setLeaveVersion((v) => v + 1);
    window.addEventListener("leaves:changed", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("leaves:changed", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  /* hesaplar */
  const computed = useMemo(() => {
    const stdMonthly = computeMonthlyStdHours(year, month, holidays); // kişi başı
    const ym = ymKey(year, month);
    const allLocalLeaves = getAllLeaves();
    const nameStore = LS.get("allLeavesByNameV1", {});
    const perRowBase = rows.map((r) => {
      const work = (r.days || []).reduce((a, b) => a + (Number(b) || 0), 0);
      return { id: r.id, work };
    });
    const perRowLeave = rows.map((r) => {
      const leaves = leavesByPerson[r.personId] || [];
      const byId = allLocalLeaves?.[r.personId]?.[ym] || {};
      const canon = canonName(r.person || r.fullName || r.name || r.adsoyad || "");
      const byName = canon ? (nameStore?.[canon]?.[ym] || {}) : {};
      const localCodes = { ...byName, ...byId }; // id varsa öncelik id'de
      const credited = creditedLeaveHoursForMonth({
        year,
        month,
        leaves,
        holidays,
        codesByDay: localCodes,
        leaveRules,
      });
      return { id: r.id, credited };
    });
    const perRow = rows.map((r) => {
      const work = perRowBase.find((x) => x.id === r.id)?.work || 0;
      const credited = perRowLeave.find((x) => x.id === r.id)?.credited || 0;
      const required = Math.max(0, stdMonthly - credited);
      const overtime = Math.max(0, work - required);
      return { id: r.id, work, credited, required, overtime };
    });
    const grandWork = perRow.reduce((a, b) => a + b.work, 0);
    const grandOT = perRow.reduce((a, b) => a + b.overtime, 0);
    return { stdMonthly, perRow, grandWork, grandOT };
  }, [rows, year, month, holidays, leavesByPerson, leaveRules, leaveVersion]);

  /* helpers */
  const addRow = () => setRows((p) => [...p, makeBlankRow(year, month)]);
  const removeRow = (id) => setRows((p) => p.filter((r) => r.id !== id));
  const updateField = (id, key, value) => setRows((p) => p.map((r) => (r.id === id ? { ...r, [key]: value } : r)));
  const updateDay = (id, idx, val) =>
    setRows((p) =>
      p.map((r) => {
        if (r.id !== id) return r;
        const a = [...r.days];
        const v = String(val).replace(",", ".");
        a[idx] = v === "" ? "" : Number(v);
        return { ...r, days: a };
      })
    );
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
      const metaIndex = buildPersonMetaIndex();
      const findMeta = (personObj, fallbackName) => {
        if (personObj?.id && metaIndex.byId.has(String(personObj.id))) {
          return metaIndex.byId.get(String(personObj.id));
        }
        const name = fallbackName || personObj?.fullName || personObj?.name || "";
        const cn = canonName(name);
        if (cn && metaIndex.byCanon.has(cn)) {
          return metaIndex.byCanon.get(cn);
        }
        return null;
      };

      for (const role of rolesToTry) {
        const schedule = await getMonthlySchedule({
          sectionId: "calisma-cizelgesi",
          serviceId: cfg.unitId || "",
          role,
          year,
          month,
        }).catch((err) => {
          if (err?.status !== 404) console.error("getMonthlySchedule err:", err);
          return null;
        });
        const data = schedule?.data || schedule || {};
        let named = data?.roster?.namedAssignments;
        if (!named && Array.isArray(data?.assignments)) {
          const built = {};
          (data.assignments || []).forEach((a) => {
            const date = a?.date;
            if (!date) return;
            const dayNum = Number(String(date).slice(8, 10));
            if (!Number.isFinite(dayNum) || dayNum < 1 || dayNum > dcount) return;
            const rowId = String(a.shiftId || a.rowId || a.shiftCode || "");
            if (!rowId) return;
            const nm = a.personName || a.name || "";
            if (!nm || isGroupLabel(nm)) return;
            if (!built[dayNum]) built[dayNum] = {};
            if (!built[dayNum][rowId]) built[dayNum][rowId] = [];
            built[dayNum][rowId].push(nm);
          });
          named = built;
        }
        if (!named || !Object.keys(named).length) continue;
        const defsSrc = Array.isArray(data?.defs) ? data.defs : Array.isArray(data?.rows) ? data.rows : [];
        const shiftByRow = new Map();
        const labelByRow = new Map();
        defsSrc.forEach((def) => {
          const rowId = String(def?.id ?? def?.rowId ?? "");
          if (!rowId) return;
          shiftByRow.set(rowId, def?.shiftCode || "");
          labelByRow.set(rowId, def?.label || "");
        });

        Object.entries(named).forEach(([dayStr, perRow]) => {
          const day = Number(dayStr);
          if (!Number.isFinite(day) || day < 1 || day > dcount) return;
          Object.entries(perRow || {}).forEach(([rowId, list]) => {
            const names = Array.isArray(list) ? list : [];
            const shiftCode = shiftByRow.get(String(rowId)) || "";
            const rowLabel = labelByRow.get(String(rowId)) || "";
            const hours = resolveShiftHours(shiftCode, rowLabel);
            names.forEach((nm) => {
              if (!nm || isGroupLabel(nm)) return;
              assignments.push({
                name: nm,
                day,
                hours,
                shiftCode,
                rowLabel,
                role,
              });
            });
          });
        });
      }

      if (!assignments.length) {
        alert("Aktarılacak görev ataması bulunamadı. Önce Çalışma Çizelgesi'ni doldurup kaydedin.");
        return;
      }

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
          id: crypto.randomUUID(),
          personId: personObj?.id || "",
          person: personObj?.fullName || sourceName,
          title: ((metaInfo?.title || baseTitle || "").trim()),
          days,
        };
        personRows.set(key, row);
        return row;
      };

      assignments.forEach((item) => {
        const canon = canonName(item.name);
        const matches = canon ? personIndex.get(canon) : null;
        const personObj = Array.isArray(matches) && matches.length ? matches[0] : null;
        const meta = findMeta(personObj, item.name);
        const rowKey = personObj?.id ? `id:${personObj.id}` : `name:${canon || item.name}`;
        const row = ensureRow(rowKey, item.name, personObj, meta);
        if (!row.title) {
          const entry = meta || personObj || (Array.isArray(matches) ? matches[0] : null);
          const fallbackTitle = entry?.title || entry?.role || "";
          row.title = (fallbackTitle || row.title || "").trim();
        }
        const idx = item.day - 1;
        const prev = Number(row.days[idx]) || 0;
        const hours = Number.isFinite(item.hours) ? item.hours : 0;
        if (hours > 0) {
          row.days[idx] = Math.round((prev + hours) * 100) / 100;
        }
      });

      const newRows = Array.from(personRows.values()).sort((a, b) =>
        String(a.person || "").localeCompare(String(b.person || ""), "tr", { sensitivity: "base" })
      );
      setRows(newRows);

      const uniques = Array.from(
        new Set(newRows.map((r) => r.personId).filter((pid) => pid && String(pid).trim() !== ""))
      );
      if (uniques.length) {
        const leavesEntries = await Promise.all(
          uniques.map(async (pid) => {
            try {
              const lv = await fetchLeaves({ personId: pid, year, month });
              return [pid, lv || []];
            } catch (err) {
              console.error("fetchLeaves err:", err);
              return [pid, []];
            }
          })
        );
        const leavesMap = {};
        leavesEntries.forEach(([pid, arr]) => {
          leavesMap[pid] = Array.isArray(arr) ? arr : [];
        });
        setLeavesByPerson(leavesMap);
      } else {
        setLeavesByPerson({});
      }

      alert(`Çalışma çizelgesinden ${assignments.length} atama aktarıldı.`);
    } finally {
      setImporting(false);
    }
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
  }, [year, month]);

  useEffect(() => {
    handleScheduleBuild();
    window.addEventListener("schedule:built", handleScheduleBuild);
    window.addEventListener("storage", handleScheduleBuild);
    return () => {
      window.removeEventListener("schedule:built", handleScheduleBuild);
      window.removeEventListener("storage", handleScheduleBuild);
    };
  }, [handleScheduleBuild]);

  /* kişi seçimi → ünvan/servis + vardiya + izin */
  async function onSelectPerson(rowId, personId) {
    const p = people.find((x) => x.id === personId);
    setRows((prev) =>
      prev.map((r) =>
        r.id === rowId
          ? { ...r, personId, person: p?.fullName || "", title: p?.title || "", service: p?.service || "" }
          : r
      )
    );

    const plan = await fetchMonthlySchedule({ personId, year, month });
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== rowId) return r;
        const copy = { ...r, days: [...r.days] };
        for (const s of plan || []) {
          const d = new Date(s.date).getDate();
          if (d >= 1 && d <= copy.days.length) copy.days[d - 1] = Number(s.hours);
        }
        return copy;
      })
    );

    const lv = await fetchLeaves({ personId, year, month });
    setLeavesByPerson((prev) => ({ ...prev, [personId]: lv || [] }));
  }

  /* export */
  const exportExcel = () => {
    const header1 = [
      cfg.department,
      ...Array(dcount - 1).fill(""),
      "AYLIK ÇALIŞMA SAATİ (kişi başı):",
      computed.stdMonthly,
    ];
  const header2 = [
    "Unvan", "Adı Soyadı",
    ...Array.from({ length: dcount }, (_, i) => `${i + 1}`),
    "Çalışma", "İzin(ÇS)", "Gereken", "Fazla Mesai",
  ];
  const body = rows.map((r) => {
    const rec = computed.perRow.find((x) => x.id === r.id) || { work: 0, credited: 0, required: 0, overtime: 0 };
    return [
      r.title || "", r.person || "",
      ...r.days.map((x) => (x === "" ? "" : Number(x))),
      Number(rec.work.toFixed(2)),
      Number(rec.credited.toFixed(2)),
      Number(rec.required.toFixed(2)),
      Number(rec.overtime.toFixed(2)),
      ];
    });
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([header1, header2, ...body]);
    ws["!cols"] = [{ wch: 16 }, { wch: 24 }, { wch: 16 }, ...Array.from({ length: dcount }, () => ({ wch: 5 })), { wch: 9 }, { wch: 9 }, { wch: 9 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, ws, `FazlaMesai-${ymKey(year, month)}`);
    XLSX.writeFile(wb, `fazla-mesai-${ymKey(year, month)}.xlsx`, { compression: true });
  };

  const filteredPeople = people.filter((p) => !search || p.fullName.toLowerCase().includes(search.toLowerCase()));

  useImperativeHandle(ref, () => ({
    importFromRoster: importFromDutyRoster,
    exportExcel,
    reset: resetMonth,
  }));

  return (
    <div className="p-3 space-y-3">
      {/* Üst bar: ortak toolbar kullanılıyorsa hiç render etme */}
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
              <button
                onClick={importFromDutyRoster}
                disabled={importing}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-xl ${importing ? "bg-blue-200 text-blue-700 cursor-wait" : "bg-blue-600 text-white hover:bg-blue-700"}`}
              >
                <ListChecks size={16} />
                {importing ? "Dolduruluyor…" : "Çizelgeden Doldur"}
              </button>
              <button onClick={() => fileRef.current?.click()}
                className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700">
                <Upload size={16} /> Excel Yükle
              </button>
              <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
                onChange={() => { /* içe aktarım eklemek istersen: buraya */ }} />
              <button onClick={exportExcel}
                className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700">
                <FileSpreadsheet size={16} /> .xlsx Dışa Aktar
              </button>
            </>
          }
        />
      )}

      {/* üst bilgi */}
      <div className="flex items-center justify-between p-3 rounded-2xl border bg-white sticky top-0 z-20">
        <div className="text-lg font-semibold">{cfg.department}</div>
        <div className="text-sm opacity-70">
          AYLIK ÇALIŞMA SAATİ (kişi başı): <span className="font-semibold">{computed.stdMonthly}</span>
          <span className="mx-2">•</span>
          GENEL TOPLAM ÇALIŞMA: <span className="font-semibold">{computed.grandWork}</span>
        </div>
      </div>

      {/* tablo */}
      <div className="rounded-2xl border overflow-auto">
        <table className="min-w-full text-xs md:text-sm">
          <thead>
            <tr className="bg-gray-100 text-gray-700 text-sm sticky top-0 z-10">
              <th className="p-2 text-left sticky left-0 z-20 bg-white">Unvan</th>
              <th className="p-2 text-left sticky left-[160px] z-20 bg-white">Adı Soyadı</th>
              {Array.from({ length: dcount }, (_, i) => (
                <th key={i} className="p-2 text-center w-[3.5rem] md:w-[3.75rem] font-mono tabular-nums border-l border-gray-200">{i + 1}</th>
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
                      <td key={i} className="p-1 text-center">
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
                    <td className="p-2 text-right tabular-nums font-semibold font-mono text-rose-600">{rec.overtime.toFixed(2)}</td>
                    <td className="p-2 text-center">
                      <button onClick={() => removeRow(r.id)} className="p-1.5 rounded-lg hover:bg-rose-50 text-rose-600"><Trash2 size={16} /></button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* personel seçim paneli */}
      <div className="rounded-2xl border p-3 bg-white">
        <div className="text-sm font-medium mb-2">Personel Listesi</div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 max-h-64 overflow-auto">
          {people
            .filter((p) => !search || p.fullName.toLowerCase().includes(search.toLowerCase()))
            .map((p) => (
              <button
                key={p.id}
                onClick={() =>
                  setRows((prev) => [
                    ...prev,
                    { ...makeBlankRow(year, month), personId: p.id, person: p.fullName, title: p.title, service: p.service },
                  ])
                }
                className="text-left p-2 rounded-lg border hover:bg-blue-50"
              >
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

/* Basit Autocomplete */
function PersonSelect({ value, people, onChange, displayValue }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const list = people.filter((p) => !q || p.fullName.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="relative">
      <input
        className="w-full outline-none px-2 py-1.5 rounded-md border border-gray-300 bg-white text-sm"
        value={displayValue || ""}
        onFocus={() => setOpen(true)}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Adı Soyadı"
      />
      {open && (
        <div className="absolute z-20 mt-1 w-full max-h-56 overflow-auto bg-white border rounded-md shadow">
          {list.length === 0 ? (
            <div className="px-3 py-2 text-sm text-gray-500">Sonuç yok</div>
          ) : (
            list.map((p) => (
              <div
                key={p.id}
                className="px-3 py-2 text-sm hover:bg-blue-50 cursor-pointer"
                onMouseDown={() => {
                  onChange(p.id);
                  setOpen(false);
                  setQ("");
                }}
              >
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
