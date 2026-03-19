// src/components/MonthlyHoursSheet.jsx
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  forwardRef,
  useImperativeHandle,
} from "react";
import * as XLSX from "xlsx";
import { LS } from "../utils/storage.js";
import { fetchPersonnel, getMonthlySchedule } from "../api/apiAdapter.js";
import { fetchHolidayCalendar } from "../api/apiAdapter.js";
import { isGroupLabel } from "../lib/dataResolver.js";
import { maskTC } from "../utils/format.js";

/* ========= Şablon başlıkları ========= */
const HEADER_STATIC_LEFT = [
  { key: "sira",    title: "sıra no",               width: 8  },
  { key: "unvan",   title: "Ünvanı",                width: 16 },
  { key: "tckn",    title: "T.C. Kimlik Numarası",  width: 18 },
  { key: "adsoyad", title: "Adı Soyadı",            width: 22 },
];
const HEADER_STATIC_RIGHT = [
  { key: "aylikCalistigiSaat", title: "AYLIK ÇALIŞTIĞI SAAT",           width: 18 },
  { key: "gecenAydanDevir",    title: "Geçen Aydan Devir (Saat)",       width: 20 },
  { key: "gelecekAyaDevir",    title: "Gelecek Aya Devir (Saat)",       width: 20 },
  { key: "aylikCalisilacak",   title: "Aylık Çalışılacak Mesai Saati",  width: 22 },
  { key: "toplamCalisma",      title: "TOPLAM ÇALIŞMA SAATİ",           width: 20 },
  { key: "ucretNobet",         title: "Ücreti Ödenecek Nöbet  Saati",   width: 22 },
  { key: "birimDisi",          title: "Birim Dışı Çalışma ……………………..", width: 28 },
];

/* ========= Yardımcılar ========= */
const fmt = (n) => (isFinite(n) ? Number(n).toLocaleString("tr-TR") : "");
const num = (v, d=0) => { if (v===null||v===undefined) return d; const s=String(v).replace(",",".").replace(/[^0-9.\-]/g,""); const n=parseFloat(s); return isNaN(n)?d:n; };
const ymKey = (year, month0) => `${year}-${String(month0 + 1).padStart(2,"0")}`; // month0: 0..11
const stdKey = (year, month0) => `monthlyHoursSheet/stdHours/${ymKey(year, month0)}`;
const LEGACY_MONTHLY_DEFAULT = 168;
const BUILD_TRIGGER_KEY = "scheduleBuildTrigger";
const BUILD_HANDLED_KEY = "scheduleBuildHandledMonthly";

const daysInMonth = (y, m1) => new Date(y, m1, 0).getDate(); // m1: 1..12
const dayStandardHours = (y, m1, d, hmap) => {
  const dow = new Date(y, m1 - 1, d).getDay(); // 0=Pa,6=Cts
  if (dow === 0 || dow === 6) return 0;
  const k = hmap.get(`${y}-${String(m1).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  if (k === "arife" || k === "half") return 4;
  if (k === "full") return 0;
  return 8;
};
const computeMonthlyStdHours = (year, month1, holidays) => {
  const map = new Map((holidays || []).map((h) => [h.date, h.kind]));
  const dim = daysInMonth(year, month1);
  let tot = 0;
  for (let d = 1; d <= dim; d++) tot += dayStandardHours(year, month1, d, map);
  return tot;
};

function parseTimeStr(s){ if(!s) return null; const m=String(s).match(/^(\d{1,2}):(\d{2})$/); if(!m) return null; const hh=+m[1], mm=+m[2]; if(hh<0||hh>29||mm<0||mm>59) return null; return hh*60+mm; }
function diffHours(start,end){ const a=parseTimeStr(start), b=parseTimeStr(end); if(a==null||b==null) return 0; let d=b-a; if(d<0) d+=24*60; return Math.round((d/60)*100)/100; }

function buildMonthDaysLocal(year, month0){
  if(!Number.isFinite(year) || !Number.isFinite(month0)) return [];
  const first=new Date(year, month0, 1), next=new Date(year, month0+1, 1), days=[];
  for(let dt=first; dt<next; dt=new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()+1)){
    const d=dt.getDate(), dow=dt.getDay();
    days.push({ ymd:`${year}-${String(month0+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`, d, isWeekend: dow===0 || dow===6 });
  }
  return days;
}

const stripDiacritics = (str) =>
  (str || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/Ğ/g, "G").replace(/Ü/g, "U").replace(/Ş/g, "S").replace(/İ/g, "I")
    .replace(/Ö/g, "O").replace(/Ç/g, "C")
    .replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ş/g, "s").replace(/ı/g, "i")
    .replace(/ö/g, "o").replace(/ç/g, "c");
const canonName = (s) => stripDiacritics((s || "").toString().trim().toLocaleUpperCase("tr-TR")).replace(/\s+/g, " ").trim();

function extractListValue(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    const candidates = [raw.value, raw.items, raw.list, raw.data];
    for (const item of candidates) {
      if (Array.isArray(item)) return item;
    }
  }
  return [];
}

function shiftKeyCandidates(raw) {
  const base = String(raw || "").trim().toUpperCase();
  if (!base) return [];
  const out = new Set([base]);
  const compact = base.replace(/\s+/g, " ").trim();
  if (compact) out.add(compact);
  const firstToken = compact.split(/[()\s/-]+/).find(Boolean);
  if (firstToken) out.add(firstToken);
  return Array.from(out.values());
}

function getShiftHours(item) {
  if (!item || typeof item !== "object") return null;
  if (item.hours !== undefined && item.hours !== null && String(item.hours).trim() !== "") {
    const n = Number(item.hours);
    return Number.isFinite(n) ? n : null;
  }
  if (item.start && item.end) return diffHours(item.start, item.end);
  return null;
}

function readWorkingHoursList(preferredList) {
  return Array.isArray(preferredList) ? preferredList : [];
}

function buildShiftCodeHoursMap(list = []) {
  const map = {};
  (Array.isArray(list) ? list : []).forEach((item) => {
    if (!item || typeof item !== "object") return;
    const hours = getShiftHours(item);
    if (!Number.isFinite(hours) || hours < 0) return;
    const code = String(item.code ?? item.id ?? item.shiftCode ?? "").trim();
    const label = String(item.label ?? item.name ?? item.area ?? "").trim();
    // Çakışmaları azaltmak için asıl eşlemeyi kod üzerinden kur.
    const codeAliases = shiftKeyCandidates(code);
    codeAliases.forEach((key) => {
      map[key] = hours;
    });
    // Label tam eşleşmesi yardımcı alias olarak eklenir, mevcut kod eşlemesini ezmez.
    const labelKey = String(label || "").trim().toUpperCase();
    if (labelKey && !Object.prototype.hasOwnProperty.call(map, labelKey)) {
      map[labelKey] = hours;
    }
  });
  return map;
}

function buildPersonMetaIndex(source = []) {
  const combined = Array.isArray(source) ? source : [];
  const byId = new Map();
  const byCanon = new Map();

  combined.forEach((entry, idx) => {
    if (!entry) return;
    const name =
      entry.fullName ||
      entry.name ||
      entry.displayName ||
      entry["AD SOYAD"] ||
      entry.personName ||
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
      `tmp-${idx}`;
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
      tckn:
        entry.tckn ||
        entry.tc ||
        entry.tcKimlik ||
        entry.tcNo ||
        entry["T.C."] ||
        entry.nationalId ||
        "",
    };
    const canon = canonName(name);
    if (info.id) {
      const prev = byId.get(info.id);
      if (!prev || (info.title && !prev.title) || (info.service && !prev.service) || (info.tckn && !prev.tckn)) {
        byId.set(info.id, { ...info });
      }
    }
    if (canon) {
      if (!byCanon.has(canon)) {
        byCanon.set(canon, { ...info });
      } else {
        const prev = byCanon.get(canon);
        if (info.title && !prev.title) prev.title = info.title;
        if (info.service && !prev.service) prev.service = info.service;
        if (info.tckn && !prev.tckn) prev.tckn = info.tckn;
      }
    }
  });

  return { byId, byCanon };
}

const fallbackShiftHours = (code, label = "") => {
  const c = String(code || "").trim().toUpperCase();
  const lbl = String(label || "").trim().toUpperCase();
  if (!c) {
    if (lbl.includes("YARIM") || lbl.includes("4 SAAT")) return 4;
    if (lbl.includes("POL") || lbl.includes("GÜNDÜZ") || lbl.includes("KISA")) return 8;
    if (lbl.includes("GECE") || lbl.includes("NÖBET") || lbl.includes("SORUMLU")) return 24;
    return 0;
  }
  if (["Y", "YILLIK", "E", "R", "İ", "I", "B", "RAPOR", "AN"].includes(c)) return 0;
  if (c.includes("IZIN") || c.includes("İZİN") || lbl.includes("İZİN") || lbl.includes("IZIN")) return 0;
  if (c === "A" || /^A[\s/_-]/.test(c)) return 4;
  if (c.includes("4")) return 4;
  if (c.includes("8") || c === "M" || c === "GUND") return 8;
  if (c.includes("12")) return 12;
  if (["YARIM", "HALF"].some((k) => c.includes(k))) return 4;
  if (["N", "GECE", "V2", "V1", "SV", "24"].some((k) => c.includes(k))) return 24;
  if (lbl.includes("NÖBET") || lbl.includes("GECE") || lbl.includes("SORUMLU")) return 24;
  return 0;
};

/* Daha esnek tarih ayrıştırıcı */
function tryParseExcelDateFlexible(v){
  if (!v && v !== 0) return null;

  if (v instanceof Date && !isNaN(v)) {
    const y=v.getFullYear(), m=v.getMonth()+1, d=v.getDate();
    return `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
  }

  const s = String(v).trim();

  // ISO "YYYY-MM-DD" veya "YYYY-MM-DDTHH:mm:ss"
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
  if (iso) {
    const y=+iso[1], m=+iso[2], d=+iso[3];
    if (y>1900 && m>=1 && m<=12 && d>=1 && d<=31) {
      return `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    }
  }

  // "dd.mm.yyyy" / "dd/mm/yyyy" / "dd-mm-yyyy"
  const m1 = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (m1){
    const d=+m1[1], mo=+m1[2], y=+m1[3];
    if (y>1900&&mo>=1&&mo<=12&&d>=1&&d<=31)
      return `${y}-${String(mo).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
  }

  // Sadece gün numarası
  const n = Number(s);
  if (Number.isFinite(n) && n>=1 && n<=31) return n;

  return null;
}

/* Çalışma kodu -> saat (öncelik: props.workingHours, fallback: LS) */
function useShiftCodeHours(workingHours){
  const [map, setMap] = useState(() =>
    buildShiftCodeHoursMap(readWorkingHoursList(workingHours))
  );
  useEffect(() => {
    setMap(buildShiftCodeHoursMap(readWorkingHoursList(workingHours)));
  }, [workingHours]);
  return map;
}

function resolveCellHours(value, shiftCodeHours, labelHint = "") {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const direct = parseFloat(raw.replace(",", "."));
  if (!isNaN(direct)) return direct;
  const keys = shiftKeyCandidates(raw);
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(shiftCodeHours, key)) continue;
    const h = Number(shiftCodeHours[key]);
    if (Number.isFinite(h) && h > 0) return h;
  }
  return fallbackShiftHours(raw, labelHint);
}

const looksDoctor = (title = "") => {
  const t = String(title || "").toLocaleUpperCase("tr-TR");
  return /\b(DR|DOKTOR|HEKIM|HEKİM|TABIP|TABİP)\b/.test(t);
};

function filterPeopleByRoleLabel(list = [], roleLabel = "Hemşireler") {
  const base = Array.isArray(list) ? list : [];
  if (roleLabel === "Doktorlar") return base.filter((p) => looksDoctor(p?.unvan || p?.role || ""));
  const nonDoctors = base.filter((p) => !looksDoctor(p?.unvan || p?.role || ""));
  return nonDoctors.length ? nonDoctors : base;
}

/* Kişiler (tek kaynak: props.people) */
function usePeople(roleLabel, sourcePeople = []){
  return useMemo(() => {
    const mapped = (Array.isArray(sourcePeople) ? sourcePeople : [])
      .map((p, i) => ({
        id: p?.id ? String(p.id) : `p-${i}`,
        unvan: p?.title || p?.role || "",
        role: p?.role || p?.title || "",
        adsoyad: p?.fullName || p?.name || [p?.firstName, p?.lastName].filter(Boolean).join(" ").trim(),
        tckn: p?.meta?.tckn || p?.meta?.tc || p?.tckn || p?.tc || p?.nationalId || "",
      }))
      .filter((p) => String(p.adsoyad || "").trim());
    return filterPeopleByRoleLabel(mapped, roleLabel);
  }, [roleLabel, sourcePeople]);
}

function emptyRow(person, monthlyRequired = LEGACY_MONTHLY_DEFAULT){
  return {
    sira:"", unvan:person?.unvan||"", tckn:person?.tckn||"", adsoyad:person?.adsoyad||"",
    days:{}, aylikCalistigiSaat:0, gecenAydanDevir:0, gelecekAyaDevir:0, aylikCalisilacak:monthlyRequired,
    toplamCalisma:0, ucretNobet:0, birimDisi:0,
  };
}

/* --- satır yardımcıları --- */
const isRowEmpty = (r) => {
  const name = String(r?.adsoyad || "").trim();
  const other = String(r?.unvan || "").trim() || String(r?.tckn || "").trim();
  const hasDays = Object.values(r?.days || {}).some(v => String(v || "").trim() !== "");
  return !name && !other && !hasDays;
};
const sortByNameTR = (a,b) =>
  String(a?.adsoyad||"").localeCompare(String(b?.adsoyad||""),"tr",{sensitivity:"base"});
const normalizeRows = (arr,{sort=true,renumber=true,filterEmpty=true}={})=>{
  let out = Array.isArray(arr)? [...arr] : [];
  if (filterEmpty) out = out.filter(r=>!isRowEmpty(r));
  if (sort) out.sort(sortByNameTR);
  if (renumber) out = out.map((r,i)=>({...r, sira:i+1}));
  return out;
};

function computeTotals(row, days, shiftCodeHours){
  let worked=0;
  (days||[]).forEach((d)=>{
    const v=(row?.days?.[d.ymd] ?? "").toString().trim();
    if(!v) return;
    worked += resolveCellHours(v, shiftCodeHours, row?.unvan || "");
  });
  const aylikCalistigiSaat=Math.round(worked*100)/100;
  const toplamCalisma=aylikCalistigiSaat + num(row?.gecenAydanDevir,0) - num(row?.gelecekAyaDevir,0);
  return { aylikCalistigiSaat, toplamCalisma };
}

function mostCommonMonthlyValue(rows) {
  const freq = new Map();
  for (const r of rows || []) {
    const v = Number(r?.aylikCalisilacak);
    if (!Number.isFinite(v) || v <= 0) continue;
    freq.set(v, (freq.get(v) || 0) + 1);
  }
  let best = null, bestCount = 0;
  for (const [val, count] of freq.entries()) {
    if (count > bestCount) { best = val; bestCount = count; }
  }
  return best;
}

/* ========= Ana Bileşen (imperative API ile) ========= */
const MonthlyHoursSheet = forwardRef(function MonthlyHoursSheet({ ym, workingHours, people: peopleProp = [] }, ref) {
  const year   = Number(ym?.year);
  const month1 = Number(ym?.month);                     // 1..12
  const month0 = Math.max(0, Math.min(11, month1 - 1)); // 0..11

  // Rol etiketi
  const roleFromLs = LS.get("activeRole", "Nurse");
  const roleLabel = roleFromLs === "Doctor" ? "Doktorlar" : "Hemşireler";

  // Gün listesi
  const days = useMemo(() => buildMonthDaysLocal(year, month0), [year, month0]);

  // Kişiler + kod-saat haritası
  const people = usePeople(roleLabel, peopleProp);
  const shiftCodeHours = useShiftCodeHours(workingHours);
  const [holidays, setHolidays] = useState([]);
  const stdMonthly = useMemo(() => computeMonthlyStdHours(year, month1, holidays), [year, month1, holidays]);

  // Satırlar + yükleme durumu
  const [rows, setRows] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [version, setVersion] = useState(1);
  const fileRef = useRef(null);

  const storageKey = useMemo(() => `monthlyHoursSheet/${ymKey(year, month0)}`, [year, month0]);
  const latestKey   = "monthlyHoursSheet/latest";
  const stdLsKey = useMemo(() => stdKey(year, month0), [year, month0]);

  /* Yükle */
  useEffect(() => {
    setLoaded(false);
    const saved = LS.get(storageKey, null);
    if (Array.isArray(saved)) {
      const ready = normalizeRows(saved, { sort:true, renumber:true, filterEmpty:true }).map((r) => ({
        ...r,
        ...computeTotals(r, days, shiftCodeHours),
      }));
      setRows(ready);
      setLoaded(true);
    } else {
      const plist = Array.isArray(people) ? people : [];
      if (plist.length === 0) { setRows([]); setLoaded(true); return; }
      const initial = normalizeRows(plist.map((p)=> emptyRow(p, stdMonthly)), { sort:true, renumber:true, filterEmpty:true }).map((r) => ({
        ...r,
        ...computeTotals(r, days, shiftCodeHours),
      }));
      setRows(initial);
      setLoaded(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, (people||[]).length, version, days, shiftCodeHours, stdMonthly]);

  /* Sadece yüklendikten sonra kaydet */
  useEffect(() => {
    if (!loaded) return;
    const toSave = normalizeRows(rows, { sort:false, renumber:false, filterEmpty:true });
    LS.set(storageKey, toSave);
    LS.set(latestKey, { ym: {year, month: month1}, rows: toSave });
  }, [loaded, storageKey, latestKey, rows, year, month1]);

  /* Hücre/Saha değişimleri */
  const setCell = (ri, dayYmd, value) => {
    setRows((prev) => {
      const next = [...(prev||[])];
      const r = { ...(next[ri]||{}) };
      const daysMap = { ...((r.days)||{}) };
      daysMap[dayYmd] = value;
      r.days = daysMap;
      const totals = computeTotals(r, days, shiftCodeHours);
      next[ri] = { ...r, ...totals };
      return next;
    });
  };
  const setField = (ri, field, value) => {
    setRows((prev) => {
      const next = [...(prev||[])];
      const row = { ...(next[ri]||{}), [field]: value };
      next[ri] = { ...row, ...computeTotals(row, days, shiftCodeHours) };
      return next;
    });
  };
  const addRow = () => setRows((p) => ([...(p||[]), emptyRow(null, stdMonthly)]));
  const reset = () => { LS.remove(storageKey); setVersion(v=>v+1); };

  /* holidays */
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const list = await fetchHolidayCalendar({ year, month: month1 });
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
  }, [year, month1]);

  /* aylık çalışılacak saatleri senkronla */
  useEffect(() => {
    if (!loaded) return;
    const prevStd = LS.get(stdLsKey, null) ?? mostCommonMonthlyValue(rows);
    setRows((prev) => {
      let changed = false;
      const next = (prev || []).map((r) => {
        const cur = num(r?.aylikCalisilacak, 0);
        if (!cur || cur === LEGACY_MONTHLY_DEFAULT || (prevStd != null && cur === prevStd)) {
          if (cur !== stdMonthly) {
            changed = true;
            return { ...r, aylikCalisilacak: stdMonthly };
          }
        }
        return r;
      });
      return changed ? next : prev;
    });
    LS.set(stdLsKey, stdMonthly);
  }, [stdMonthly, loaded, rows, stdLsKey]);

  // Vardiya saat haritası/gün listesi değiştiğinde satır toplamlarını yeniden hesapla.
  useEffect(() => {
    if (!loaded) return;
    setRows((prev) => {
      let changed = false;
      const next = (prev || []).map((r) => {
        const totals = computeTotals(r, days, shiftCodeHours);
        const curWorked = Number(r?.aylikCalistigiSaat ?? 0);
        const curTotal = Number(r?.toplamCalisma ?? 0);
        if (Math.abs(curWorked - totals.aylikCalistigiSaat) > 0.001 || Math.abs(curTotal - totals.toplamCalisma) > 0.001) {
          changed = true;
          return { ...r, ...totals };
        }
        return r;
      });
      return changed ? next : prev;
    });
  }, [loaded, days, shiftCodeHours]);

  /* Excel dışa aktar — ISO başlık */
  const exportExcel = () => {
    const header = [
      ...(HEADER_STATIC_LEFT||[]).map((h) => h.title),
      ...(days||[]).map((d) => d.ymd), // "YYYY-MM-DD"
      ...(HEADER_STATIC_RIGHT||[]).map((h) => h.title),
    ];
    const aoa = [header];
    (rows||[]).forEach((r, i) => {
      const row = [
        r?.sira || i + 1,
        r?.unvan || "",
        r?.tckn || "",
        r?.adsoyad || "",
        ...(days||[]).map((d) => r?.days?.[d.ymd] ?? ""),
        r?.aylikCalistigiSaat ?? 0,
        r?.gecenAydanDevir ?? 0,
        r?.gelecekAyaDevir ?? 0,
        r?.aylikCalisilacak ?? 168,
        r?.toplamCalisma ?? 0,
        r?.ucretNobet ?? 0,
        r?.birimDisi ?? 0,
      ];
      aoa.push(row);
    });
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [
      ...(HEADER_STATIC_LEFT||[]).map((c) => ({ wch: c.width })),
      ...(days||[]).map(() => ({ wch: 10 })),
      ...(HEADER_STATIC_RIGHT||[]).map((c) => ({ wch: c.width })),
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sayfa1");
    XLSX.writeFile(wb, `Aylik_Mesai_${year}-${String(month1).padStart(2,"0")}.xlsx`);
  };

  /* Excel içe aktar — sağlam okuma */
  const importExcel = (file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const wb = XLSX.read(new Uint8Array(e.target.result), {
        type: "array",
        cellDates: true,
        dateNF: "yyyy-mm-dd",
      });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false });
      if (!json?.length) return alert("Excel sayfası boş görünüyor.");

      const header = json[0] || [];
      const dayIdx = [];

      for (let i=0; i<header.length; i++){
        const parsed = tryParseExcelDateFlexible(header[i]);
        if (parsed) {
          if (typeof parsed === "string") {
            const [y, m] = parsed.split("-").map(Number);
            if (y === year && m === month1) dayIdx.push({ i, ymd: parsed });
          } else if (typeof parsed === "number") {
            const ymd = `${year}-${String(month1).padStart(2,"0")}-${String(parsed).padStart(2,"0")}`;
            dayIdx.push({ i, ymd });
          }
        }
      }

      if (!dayIdx.length) {
        alert("Gün sütunu bulunamadı. Başlıklar tarih (YYYY-AA-GG) veya gün numarası (1..31) olmalı; ayrıca ay/yıl bu sekmeyle aynı olmalı.");
        return;
      }

      const read = [];
      for (let r=1; r<json.length; r++){
        const row = json[r];
        if (!row || row.every((x)=>x==="" || x===null || typeof x==="undefined")) continue;
        const obj = emptyRow();
        obj.sira    = row[0] ?? "";
        obj.unvan   = row[1] ?? "";
        obj.tckn    = row[2] ?? "";
        obj.adsoyad = row[3] ?? "";
        obj.days = {};
        dayIdx.forEach(({i, ymd}) => { obj.days[ymd] = (row[i] ?? "").toString(); });
        const base = 4 + dayIdx.length;
        const g = (idx, def=0) => num(row[base+idx], def);
        obj.aylikCalistigiSaat = g(0,0);
        obj.gecenAydanDevir    = g(1,0);
        obj.gelecekAyaDevir    = g(2,0);
        obj.aylikCalisilacak   = g(3,stdMonthly);
        obj.toplamCalisma      = g(4,0);
        obj.ucretNobet         = g(5,0);
        obj.birimDisi          = g(6,0);
        const totals = computeTotals(obj, days, shiftCodeHours);
        read.push({ ...obj, ...totals });
      }

      const next = normalizeRows(read, { sort:true, renumber:true, filterEmpty:true });
      setRows(next);
      setLoaded(true);
      LS.set(storageKey, next);
      LS.set(latestKey, { ym: {year, month: month1}, rows: next });
      alert("Excel içe aktarma tamamlandı.");
    };
    reader.readAsArrayBuffer(file);
  };

  const triggerImport = () => fileRef.current?.click();
  const onFilePick = (e) => { const f=e.target.files?.[0]; if(f) importExcel(f); e.target.value=""; };

  /* Alt toplamlar */
  const colTotals = useMemo(()=>{
    const perDay = {};
    (days||[]).forEach(d => { perDay[d.ymd]=0; });
    let sumAylik=0, sumGecen=0, sumGelecek=0, sumCalisilacak=0, sumToplam=0, sumUcret=0, sumBirimDisi=0;
    (rows||[]).forEach(r=>{
      sumAylik       += num(r?.aylikCalistigiSaat,0);
      sumGecen       += num(r?.gecenAydanDevir,0);
      sumGelecek     += num(r?.gelecekAyaDevir,0);
      sumCalisilacak += num(r?.aylikCalisilacak,0);
      sumToplam      += num(r?.toplamCalisma,0);
      sumUcret       += num(r?.ucretNobet,0);
      sumBirimDisi   += num(r?.birimDisi,0);
      (days||[]).forEach(d=>{
        const v=(r?.days?.[d.ymd] ?? "").toString().trim();
        if(!v) return;
        perDay[d.ymd] += resolveCellHours(v, shiftCodeHours, r?.unvan || "");
      });
    });
    return { perDay, right:{ aylik:sumAylik, gecen:sumGecen, gelecek:sumGelecek, calisilacak:sumCalisilacak, toplam:sumToplam, ucret:sumUcret, birimDisi:sumBirimDisi } };
  }, [rows, days, shiftCodeHours]);

  /* Plan’dan doldur */
  const fillFromPlanner = () => {
    const ymk = ymKey(year, month0);
    const candidates = [];
    for (let i=0;i<localStorage.length;i++){
      const k = localStorage.key(i) || "";
      const lk = k.toLowerCase();
      if (k.includes(ymk) && (lk.includes("plan") || lk.includes("duty") || lk.includes("assign") || lk.includes("planner") || lk.includes("rows"))) {
        candidates.push(k);
      }
    }
    const isISO = (s)=> typeof s==="string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
    let data=null, shape="";
    for (const k of candidates){
      try{
        const v = JSON.parse(localStorage.getItem(k) || "null");
        if (Array.isArray(v) && v.length && (v[0]?.adsoyad || v[0]?.name) && v[0]?.days) { data=v; shape="arrayRows"; break; }
        if (v && typeof v==="object") {
          const keys=Object.keys(v);
          if (keys.length && isISO(keys[0])) { data=v; shape="byDate"; break; }
        }
      }catch{}
    }
    if (!data){ alert("Plan verisi bulunamadı. Lütfen Plan sekmesinde bu aya ait veriyi kaydedin."); return; }

    const next = (rows||[]).map(r => ({ ...r, days: { ...(r?.days || {}) } }));
    if (shape==="arrayRows"){
      const byName = new Map(next.map((r,i)=> [String(r?.adsoyad||"").trim().toUpperCase(), i]));
      (data||[]).forEach(item=>{
        const key = String(item?.adsoyad || item?.name || "").trim().toUpperCase();
        const ri = byName.get(key);
        if (ri===undefined) return;
        const srcDays = item?.days || {};
        (days||[]).forEach(d=>{
          const val = srcDays[d.ymd];
          if (val!==undefined && val!==null) next[ri].days[d.ymd] = val;
        });
      });
    } else if (shape==="byDate"){
      const byName = new Map(next.map((r,i)=> [String(r?.adsoyad||"").trim().toUpperCase(), i]));
      Object.entries(data||{}).forEach(([day, assigns])=>{
        if (!(days||[]).find(x=>x.ymd===day)) return;
        (assigns||[]).forEach(a=>{
          const key = String(a?.adsoyad || a?.name || "").trim().toUpperCase();
          const ri = byName.get(key);
          if (ri===undefined) return;
          next[ri].days[day] = a?.code ?? a?.hours ?? "";
        });
      });
    }
    const finalized = normalizeRows(next.map(r => ({ ...r, ...computeTotals(r, days, shiftCodeHours) })), { sort:true, renumber:true, filterEmpty:true });
    setRows(finalized);
    setLoaded(true);
  };

  const fillFromDutyRoster = async () => {
    try {
      const metaIndex = buildPersonMetaIndex(peopleProp);
      const remotePeople = await fetchPersonnel({ active: true, page: 1, size: 2000 }).catch(() => []);
      const remoteByCanon = new Map(
        (remotePeople || [])
          .map((p) => {
            const fullName = p?.fullName || p?.name || "";
            return [
              canonName(fullName),
              {
                id: p?.id ? String(p.id) : "",
                name: fullName,
                title: p?.title || p?.role || "",
                tckn: p?.meta?.tckn || p?.meta?.tc || p?.tckn || p?.tc || "",
              },
            ];
          })
          .filter(([canon, meta]) => canon && (meta?.name || meta?.title || meta?.tckn))
      );
      const hasKnownPeople = remoteByCanon.size > 0 || metaIndex.byCanon.size > 0;
      const isKnownPersonName = (name) => {
        const canon = canonName(name);
        if (!canon) return false;
        if (!hasKnownPeople) return true;
        return remoteByCanon.has(canon) || metaIndex.byCanon.has(canon);
      };
      const roles = ["Nurse", "Doctor"];
      const assignments = [];
      for (const role of roles) {
        const schedule = await getMonthlySchedule({
          sectionId: "calisma-cizelgesi",
          serviceId: "",
          role,
          year,
          month: month1,
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
            if (!Number.isFinite(day) || day < 1 || day > (days?.length || 31)) return;
            // shiftCode öncelikli: shiftId (ObjectId) saat çözümlemesinde belirsizlik yaratıyor.
            const rowId = String(a.shiftCode || a.shiftId || a.rowId || "");
            if (!rowId) return;
            const nm = a.personName || a.name || "";
            if (!nm || isGroupLabel(nm) || !isKnownPersonName(nm)) return;
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
          const shiftCode = String(def?.shiftCode ?? def?.code ?? "").trim();
          const label = String(def?.label ?? def?.name ?? def?.area ?? "").trim();
          if (rowId) {
            shiftByRow.set(rowId, shiftCode);
            labelByRow.set(rowId, label || rowId);
          }
          if (shiftCode) {
            shiftByRow.set(shiftCode, shiftCode);
            labelByRow.set(shiftCode, label || shiftCode);
          }
        });

        Object.entries(named).forEach(([dayStr, perRow]) => {
          const day = Number(dayStr);
          if (!Number.isFinite(day) || day < 1 || day > (days?.length || 31)) return;
          const ymd = `${year}-${String(month1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          Object.entries(perRow || {}).forEach(([rowId, list]) => {
            const lookupKey = String(rowId);
            const shiftCode = shiftByRow.get(lookupKey) || lookupKey;
            const rowLabel = labelByRow.get(lookupKey) || lookupKey;
            (list || []).forEach((nm) => {
              if (!nm || isGroupLabel(nm)) return;
              assignments.push({
                name: nm,
                day: ymd,
                shiftCode,
                rowLabel,
                role,
              });
            });
          });
        });
        if (Array.isArray(data?.assignments)) {
          (data.assignments || []).forEach((a) => {
            const date = a?.date || a?.day;
            if (!date) return;
            const ymd = String(date).slice(0, 10);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return;
            if (!ymd.startsWith(`${year}-${String(month1).padStart(2, "0")}-`)) return;
            const nm = a.personName || a.name || "";
            if (!nm || isGroupLabel(nm) || !isKnownPersonName(nm)) return;
            const explicitHours = Number(a?.hours);
            if (!Number.isFinite(explicitHours) || explicitHours <= 0) return;
            assignments.push({
              name: nm,
              day: ymd,
              shiftCode: String(a?.shiftCode || a?.shift || a?.code || "").trim(),
              rowLabel: String(a?.roleLabel || a?.rowLabel || a?.label || "").trim(),
              role,
              explicitHours: Math.round(explicitHours * 100) / 100,
            });
          });
        }
      }
      if (!assignments.length) {
        alert("Çalışma Çizelgesi verisi bulunamadı. Önce ilgili ayı kaydedin.");
        return;
      }

      const next = Array.isArray(rows) ? rows.map((r) => ({ ...r, days: { ...(r.days || {}) } })) : [];
      const nameIndex = new Map(next.map((r, i) => [canonName(r?.adsoyad || ""), i]));

      const ensureRow = (canon, meta) => {
        if (nameIndex.has(canon)) return nameIndex.get(canon);
        const newRow = emptyRow({
          unvan: meta?.title || "",
          adsoyad: meta?.name || "",
        });
        newRow.tckn = meta?.tckn || "";
        next.push(newRow);
        const idx = next.length - 1;
        nameIndex.set(canon, idx);
        return idx;
      };

      assignments.forEach((item) => {
        const canon = canonName(item.name);
        if (!canon) return;
        const meta = remoteByCanon.get(canon) || metaIndex.byCanon.get(canon) || null;
        const idx = ensureRow(canon, meta);
        const row = next[idx];
        if (meta) {
          if (meta.title && !row.unvan) row.unvan = meta.title;
          if (meta.tckn && !row.tckn) row.tckn = meta.tckn;
          if (meta.name && !row.adsoyad) row.adsoyad = meta.name;
        }
        if (!row.adsoyad) row.adsoyad = item.name;
        const rawShift = String(item.shiftCode || "").trim();
        const rawLabel = String(item.rowLabel || "").trim();
        const safeValue = rawShift && !/^\d+$/.test(rawShift) ? rawShift : (rawLabel || rawShift);
        const explicitHours = Number(item.explicitHours);
        row.days[item.day] =
          Number.isFinite(explicitHours) && explicitHours > 0
            ? Math.round(explicitHours * 100) / 100
            : safeValue;
      });

      // Mevcut satırlardaki unvan/tckn değerlerini de backend personel verisiyle hizala.
      next.forEach((row) => {
        const canon = canonName(row?.adsoyad || "");
        const remoteMeta = canon ? remoteByCanon.get(canon) : null;
        if (!remoteMeta) return;
        if (remoteMeta.title && remoteMeta.title !== row.unvan) row.unvan = remoteMeta.title;
        if (remoteMeta.tckn && !row.tckn) row.tckn = remoteMeta.tckn;
      });

      const finalized = normalizeRows(
        next.map((r) => ({ ...r, ...computeTotals(r, days, shiftCodeHours) })),
        { sort: true, renumber: true, filterEmpty: true }
      );
      setRows(finalized);
      setLoaded(true);
      alert("Çalışma Çizelgesi'nden aylık tablo dolduruldu.");
    } catch (err) {
      console.error("fillFromDutyRoster err:", err);
      alert("Çalışma çizelgesi verisi aktarılırken hata oluştu.");
    }
  };

  const handleScheduleBuild = useCallback(() => {
    const trig = LS.get(BUILD_TRIGGER_KEY, null);
    if (!trig?.ym || !trig?.ts) return;
    const currentYm = ymKey(year, month0);
    if (trig.ym !== currentYm) return;
    const last = Number(LS.get(BUILD_HANDLED_KEY, 0));
    if (trig.ts <= last) return;
    reset();
    fillFromDutyRoster();
    LS.set(BUILD_HANDLED_KEY, trig.ts);
  }, [year, month0, reset, fillFromDutyRoster]);

  useEffect(() => {
    handleScheduleBuild();
    window.addEventListener("schedule:built", handleScheduleBuild);
    window.addEventListener("storage", handleScheduleBuild);
    return () => {
      window.removeEventListener("schedule:built", handleScheduleBuild);
      window.removeEventListener("storage", handleScheduleBuild);
    };
  }, [handleScheduleBuild]);

  /* ----- Dışa açılan API ----- */
  useImperativeHandle(ref, () => ({
    exportExcel,
    triggerImport,
    importExcelFile: importExcel,
    fillFromPlanner,
    importFromRoster: fillFromDutyRoster,
    reset,
    addRow,
  }));

  return (
    <div className="space-y-3">
      {/* Gizli dosya input’u: triggerImport() ile açılır */}
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={onFilePick}
      />

      {/* Tablo */}
      <div className="rounded-xl border bg-white overflow-auto">
        <table className="min-w-full text-[13px]">
          <thead className="bg-gray-50">
            <tr>
              {(HEADER_STATIC_LEFT||[]).map((h)=>(
                <th key={h.key} style={{ minWidth: h.width*8, border:"1px solid #e5e7eb", padding:4 }}>{h.title}</th>
              ))}
              {(days||[]).map((d)=>(
                <th key={d.ymd} className="text-center min-w-[60px]" style={{ border:"1px solid #e5e7eb", padding:4 }}>{d.d}</th>
              ))}
              {(HEADER_STATIC_RIGHT||[]).map((h)=>(
                <th key={h.key} style={{ minWidth: h.width*7.2, border:"1px solid #e5e7eb", padding:4 }}>{h.title}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(rows||[]).map((r,ri)=>(
              <tr key={ri} style={{ background: ri%2 ? "#ffffff" : "rgba(249,250,251,0.6)" }}>
                <td style={{ border:"1px solid #e5e7eb", padding:4 }}>
                  <input className="border rounded px-2 py-1 w-16" value={r?.sira ?? ""} onChange={(e)=>setField(ri,"sira",e.target.value)} />
                </td>
                <td style={{ border:"1px solid #e5e7eb", padding:4 }}>
                  <input className="border rounded px-2 py-1 w-40" value={r?.unvan ?? ""} onChange={(e)=>setField(ri,"unvan",e.target.value)} />
                </td>
                <td style={{ border:"1px solid #e5e7eb", padding:4 }}>
                  <input
                    className="border rounded px-2 py-1 w-44 bg-slate-50 text-slate-600"
                    value={maskTC(r?.tckn ?? "")}
                    readOnly
                  />
                </td>
                <td style={{ border:"1px solid #e5e7eb", padding:4 }}>
                  <input className="border rounded px-2 py-1 w-56" value={r?.adsoyad ?? ""} onChange={(e)=>setField(ri,"adsoyad",e.target.value)} />
                </td>

                {(days||[]).map((d)=>(
                  <td key={d.ymd} className="text-center" style={{ border:"1px solid #e5e7eb", padding:4, background: d.isWeekend ? "#fff1f2":"transparent" }}>
                    <input
                      className="border rounded px-2 py-1 text-center w-14"
                      placeholder={d.isWeekend ? "-" : ""}
                      value={r?.days?.[d.ymd] ?? ""}
                      onChange={(e)=>setCell(ri, d.ymd, e.target.value)}
                    />
                  </td>
                ))}

                <td style={{ border:"1px solid #e5e7eb", padding:4, textAlign:"right", fontWeight:600 }}>{fmt(r?.aylikCalistigiSaat)}</td>
                <td style={{ border:"1px solid #e5e7eb", padding:4 }}>
                  <input className="border rounded px-2 py-1 text-right w-24" value={r?.gecenAydanDevir ?? 0} onChange={(e)=>setField(ri,"gecenAydanDevir",num(e.target.value,0))}/>
                </td>
                <td style={{ border:"1px solid #e5e7eb", padding:4 }}>
                  <input className="border rounded px-2 py-1 text-right w-24" value={r?.gelecekAyaDevir ?? 0} onChange={(e)=>setField(ri,"gelecekAyaDevir",num(e.target.value,0))}/>
                </td>
                <td style={{ border:"1px solid #e5e7eb", padding:4 }}>
                  <input className="border rounded px-2 py-1 text-right w-28" value={r?.aylikCalisilacak ?? 168} onChange={(e)=>setField(ri,"aylikCalisilacak",num(e.target.value,168))}/>
                </td>
                <td style={{ border:"1px solid #e5e7eb", padding:4, textAlign:"right", fontWeight:600 }}>{fmt(r?.toplamCalisma)}</td>
                <td style={{ border:"1px solid #e5e7eb", padding:4 }}>
                  <input className="border rounded px-2 py-1 text-right w-28" value={r?.ucretNobet ?? 0} onChange={(e)=>setField(ri,"ucretNobet",num(e.target.value,0))}/>
                </td>
                <td style={{ border:"1px solid #e5e7eb", padding:4 }}>
                  <input className="border rounded px-2 py-1 text-right w-32" value={r?.birimDisi ?? 0} onChange={(e)=>setField(ri,"birimDisi",num(e.target.value,0))}/>
                </td>
              </tr>
            ))}
          </tbody>

          {/* Alt toplam (tfoot) */}
          <tfoot>
            <tr className="bg-gray-100 font-semibold">
              <td style={{ border:"1px solid #e5e7eb", padding:4 }} colSpan={4}>TOPLAM</td>
              {(days||[]).map((d)=>(
                <td key={d.ymd} style={{ border:"1px solid #e5e7eb", padding:4, textAlign:"right" }}>{fmt(colTotals.perDay[d.ymd])}</td>
              ))}
              <td style={{ border:"1px solid #e5e7eb", padding:4, textAlign:"right" }}>{fmt(colTotals.right.aylik)}</td>
              <td style={{ border:"1px solid #e5e7eb", padding:4, textAlign:"right" }}>{fmt(colTotals.right.gecen)}</td>
              <td style={{ border:"1px solid #e5e7eb", padding:4, textAlign:"right" }}>{fmt(colTotals.right.gelecek)}</td>
              <td style={{ border:"1px solid #e5e7eb", padding:4, textAlign:"right" }}>{fmt(colTotals.right.calisilacak)}</td>
              <td style={{ border:"1px solid #e5e7eb", padding:4, textAlign:"right" }}>{fmt(colTotals.right.toplam)}</td>
              <td style={{ border:"1px solid #e5e7eb", padding:4, textAlign:"right" }}>{fmt(colTotals.right.ucret)}</td>
              <td style={{ border:"1px solid #e5e7eb", padding:4, textAlign:"right" }}>{fmt(colTotals.right.birimDisi)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="flex items-center gap-2">
        <button className="h-9 rounded-lg border bg-white px-3" onClick={addRow}>+ Satır Ekle</button>
        <button className="h-9 rounded-lg border bg-rose-50 text-rose-800 px-3" onClick={reset}>Sıfırla</button>
        <div className="text-xs text-gray-500">Hafta sonu hücreleri görsel olarak işaretlidir.</div>
      </div>
    </div>
  );
});

export default MonthlyHoursSheet;
