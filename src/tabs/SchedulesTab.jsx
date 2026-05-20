// src/tabs/SchedulesTab.jsx
import React, { useMemo, useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import {
  ArrowLeftRight,
  CalendarClock,
  ClipboardList,
  Clock3,
  FileSpreadsheet,
  ShieldCheck,
  Stethoscope,
  Users,
} from "lucide-react";
import { http } from "../lib/api.js";
import { LS } from "../utils/storage.js";
import DutyRowsEditor from "../components/DutyRowsEditor.jsx";
import ScheduleToolbar from "../components/ScheduleToolbar.jsx";
import MonthlyHoursSheet from "../components/MonthlyHoursSheet.jsx";
import OvertimeTab from "./OvertimeTab.jsx";
import MonthlyLeavesMatrixGeneric from "./MonthlyLeavesMatrixGeneric.jsx";
import { WorkspaceHero, WorkspacePanel } from "../components/workspace/WorkspaceShell.jsx";
import { getAllLeaves, setLeave, unsetLeave, buildNameUnavailability } from "../lib/leaves.js";
import { collectRequestsByPerson } from "../lib/requestParser.js";
import { checkLeaveShiftConflict, removeShiftOnDay } from "../utils/conflictChecker.js";
import useActiveYM from "../hooks/useActiveYM.js";
import useServiceScope from "../hooks/useServiceScope.js"; // ⬅️ YENİ: servis kapsamı
import { useAppStore } from "../state/appStore";

/* =========================================================
   INLINE SCHEDULER — “Liste Oluştur” için yedek algoritma
========================================================= */
const DEFAULT_NIGHT_CODES = new Set(["N", "V1", "V2", "SV"]);
const DAY_NAMES_TR = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];
const stripDiacritics = (str) =>
  (str || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
const canonPersonName = (name) => stripDiacritics(upTR(name)).replace(/\s+/g, " ").trim();
const upTR = (s) => (s ?? "").toString().trim().toLocaleUpperCase("tr");
const normTRText = (s = "") =>
  stripDiacritics((s ?? "").toString())
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
const isServiceSupervisorLabel = (label = "") => normTRText(label).includes("servis sorumlu");
const mulberry32 = (seed) => {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
};
const randPick = (arr, rng) =>
  (arr && arr.length ? arr[Math.floor(rng() * arr.length)] : undefined);

const buildDayCols = (year, month1) => {
  const d = new Date(year, month1 - 1, 1);
  const out = [];
  while (d.getMonth() + 1 === month1) {
    const dd = String(d.getDate()).padStart(2, "0");
    const name = DAY_NAMES_TR[d.getDay() === 0 ? 6 : d.getDay() - 1];
    out.push(`${dd} (${name})`);
    d.setDate(d.getDate() + 1);
  }
  return out;
};

const areaKeywords = (gorevName) => {
  const g = upTR(gorevName);
  const map = {
    "SERVİS SORUMLUSU": ["SERVİS SORUMLUSU"],
    "SÜPERVİZÖR": ["SÜPERVİZÖR", "SV"],
    "EKİP SORUMLUSU": ["EKİP SORUMLUSU"],
    "RESÜSİTASYON": ["RESÜSİTASYON"],
    "KIRMIZI VE SARI GÖREVLENDİRME": ["KIRMIZI", "SARI"],
    KIRMIZI: ["KIRMIZI"],
    SARI: ["SARI"],
    ÇOCUK: ["ÇOCUK"],
    YEŞİL: ["YEŞİL"],
    ECZANE: ["ECZANE"],
    "CERRAHİ MÜDAHELE": ["CERRAHİ MÜDAHELE", "CERRAHİ"],
    AŞI: ["AŞI"],
    TRİAJ: ["TRİAJ"],
  };
  for (const k of Object.keys(map)) if (g.includes(k)) return map[k];
  return g ? [g.split(" ")[0]] : [];
};

function eligibleNurses(nurses, gorevName, vardiyaCode) {
  const code = upTR(vardiyaCode);
  const keys = areaKeywords(gorevName);
  const out = [];
  for (const n of nurses) {
    const areas = upTR(n["ÇALIŞMA ALANLARI"]);
    const shifts = "," + upTR(n["VARDİYE KODLARI"]).replace(/\s+/g, "") + ",";
    const shiftOK = shifts.includes("," + code + ",");
    const areaOK = keys.some((k) => areas.includes(k));
    if (shiftOK && areaOK) out.push(n["AD SOYAD"]);
  }
  if (out.length === 0) {
    for (const n of nurses) {
      const shifts = "," + upTR(n["VARDİYE KODLARI"]).replace(/\s+/g, "") + ",";
      if (shifts.includes("," + code + ",")) out.push(n["AD SOYAD"]);
    }
  }
  return out;
}

const hadNightPrevDay = (assignments, rows, person, prevDayIdx, nightCodes) => {
  if (prevDayIdx < 0) return false;
  for (let r = 0; r < rows.length; r++) {
    if (assignments[r][prevDayIdx] === person && nightCodes.has(rows[r].vardiya)) return true;
  }
  return false;
};

function buildSchedule(nurses, tasks, opts) {
  const year = opts?.year ?? new Date().getFullYear();
  const month1 = opts?.month ?? new Date().getMonth() + 1;
  const supervisorName = opts?.supervisorName ?? "GAMZE ÖZTÜRK TEZKİN";
  const greenWeekday = opts?.greenWeekday ?? 3;
  const greenWeekend = opts?.greenWeekend ?? 4;
  const rng = mulberry32(opts?.seed ?? year * 100 + month1);
  const nightCodes = new Set(opts?.nightShiftCodes ?? Array.from(DEFAULT_NIGHT_CODES));
  const supNorm = upTR(supervisorName);
  const { byPerson: requestRaw } = collectRequestsByPerson({ year, month1, strictMonth: true });
  const requestConstraints = buildRequestMap(requestRaw, year, month1);

  const tasksClean = (tasks || [])
    .map((t) => ({
      gorev: upTR(t["GÖREVİ"]),
      vardiya: upTR(t["VARDİYE TİPİ"]),
      count: Math.max(0, Number(t["ÇALIŞAN KİŞİ SAYISI"]) || 0),
    }))
    .filter((t) => t.count > 0);

  const rows = [];
  let yesilV1Rows = 0;
  for (const t of tasksClean) {
    if (t.gorev.includes("YEŞİL") && t.vardiya === "V1") yesilV1Rows += t.count;
    for (let i = 0; i < t.count; i++) {
      rows.push({ gorev: t.gorev, vardiya: t.vardiya, suffix: t.count > 1 ? ` — #${i + 1}` : "", weekendOnly: false });
    }
  }
  if (yesilV1Rows < 4) {
    for (let k = yesilV1Rows + 1; k <= 4; k++) {
      rows.push({ gorev: "YEŞİL", vardiya: "V1", suffix: ` — #${k} (Hafta Sonu)`, weekendOnly: true });
    }
  }

  const days = buildDayCols(year, month1);
  const columns = ["GÖREV SATIRI", ...days];
  const labels = rows.map((r) => `${r.gorev} (${r.vardiya})${r.suffix}`);
  const table = Array.from({ length: rows.length }, () => Array(days.length).fill(""));
  const unavailableByName = opts?.unavailableByName instanceof Map ? opts.unavailableByName : null;
  const isUnavailable =
    unavailableByName
      ? (name, dayNum) => {
          const canon = canonPersonName(name);
          if (!canon) return false;
          const set = unavailableByName.get(canon);
          return !!(set && set.has(dayNum));
        }
      : () => false;

  for (let d = 0; d < days.length; d++) {
    const dayNum = d + 1;
    const wd = new Date(year, month1 - 1, dayNum).getDay();
    const isWeekend = wd === 0 || wd === 6;
    const greenNeed = isWeekend ? greenWeekend : greenWeekday;
    let greenFilled = 0;
    const usedToday = new Set();

    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];

      if (isServiceSupervisorLabel(row.gorev)) {
        let name = !isWeekend ? supervisorName : "";
        if (name && (isUnavailable(name, dayNum) || requestConstraints?.shouldAvoid(name, dayNum))) name = "";
        table[r][d] = name;
        if (name) usedToday.add(name);
        continue;
      }

      if (row.weekendOnly && !isWeekend) { table[r][d] = ""; continue; }
      if (row.gorev.includes("YEŞİL") && row.vardiya === "V1") {
        if (greenFilled >= greenNeed) { table[r][d] = ""; continue; }
      }

      let pool = eligibleNurses(nurses, row.gorev, row.vardiya)
        .filter((nm) => !usedToday.has(nm))
        .filter((nm) => upTR(nm) !== supNorm);

      if (nightCodes.has(row.vardiya)) {
        pool = pool.filter((nm) => !hadNightPrevDay(table, rows, nm, d - 1, nightCodes));
      }

      if (unavailableByName) {
        pool = pool.filter((nm) => !isUnavailable(nm, dayNum));
      }

      if (requestConstraints) {
        pool = pool.filter((nm) => !requestConstraints.shouldAvoid(nm, dayNum));
      }

      if (pool.length === 0) { table[r][d] = ""; continue; }

      const pick = randPick(pool, rng);
      table[r][d] = pick;
      usedToday.add(pick);
      if (row.gorev.includes("YEŞİL") && row.vardiya === "V1") greenFilled++;
    }
  }

  return { columns, rows: labels, table };
}

function buildRequestMap(rawMap, year, month) {
  if (!rawMap || typeof rawMap !== "object") return null;
  const avoidMap = new Map();
  for (const [canon, data] of Object.entries(rawMap)) {
    const set = new Set();
    (data?.avoid || []).forEach((seg) => {
      if (!seg || seg.year !== year || seg.month !== month) return;
      expandSegDays(seg).forEach((day) => set.add(day));
    });
    if (set.size) avoidMap.set(canon, set);
  }
  if (!avoidMap.size) return null;
  return {
    shouldAvoid(name, day) {
      const canon = canonPersonName(name);
      if (!canon) return false;
      const set = avoidMap.get(canon);
      return set ? set.has(day) : false;
    },
  };
}

function expandSegDays(seg) {
  const out = [];
  const start = Number(seg.startDay) || 1;
  const end = Number(seg.endDay) || start;
  const clamp = (v) => Math.min(Math.max(v, 1), 31);
  for (let d = clamp(start); d <= clamp(end); d++) out.push(d);
  return out;
}

function generateScheduleFromLS(year, month1) {
  const nurses = LS.get("nurses", []);
  const templateRaw = LS.get("scheduleTemplateRows", LS.get("scheduleRowsV2", []));
  let template = [];
  if (Array.isArray(templateRaw)) {
    template = templateRaw;
  } else if (templateRaw && Array.isArray(templateRaw.rows)) {
    template = templateRaw.rows;
  } else if (templateRaw && typeof templateRaw === "object") {
    template = Object.values(templateRaw).flatMap((v) => (Array.isArray(v) ? v : []));
  }
  const tasks = (template || []).map((r) => ({
    "GÖREVİ": r.gorev ?? r.Görev ?? r["GÖREVİ"] ?? r.areaName ?? "",
    "VARDİYE TİPİ": r.vardiya ?? r.Vardiya ?? r["VARDİYE TİPİ"] ?? r.shift ?? "",
    "ÇALIŞAN KİŞİ SAYISI": Number(
      r.personCount ?? r["Görevli Kişi"] ?? r["ÇALIŞAN KİŞİ SAYISI"] ?? r.count ?? 0
    ),
  }));
  const unavailableByName = buildNameUnavailability(nurses, year, month1);
  const schedule = buildSchedule(nurses, tasks, {
    year,
    month: month1,
    supervisorName: "GAMZE ÖZTÜRK TEZKİN",
    greenWeekday: 3,
    greenWeekend: 4,
    seed: year * 100 + month1,
    unavailableByName,
  });
  const { columns, rows, table } = schedule;
  const outRows = rows.map((label, rIdx) => {
    const o = { label };
    columns.slice(1).forEach((col, cIdx) => { o[col] = table[rIdx][cIdx] || ""; });
    return o;
  });
  LS.set("scheduleRowsV2", outRows);
  window.dispatchEvent(new Event("storage"));
}

/* =========================
   LS helpers
========================= */
const LS_KEY = "scheduleSections";
const LS_ACTIVE = "scheduleActiveSectionId";
const DEFAULT_SECTIONS = [
  { id: "calisma-cizelgesi", name: "Çalışma Çizelgesi" },
  { id: "aylik-calisma-ve-mesai-saatleri-cizelgesi", name: "Aylık Çalışma ve Mesai Saatleri Çizelgesi" },
  { id: "fazla-mesai-takip", name: "Fazla Mesai Takip Formu" },
  { id: "toplu-izin-listesi", name: "Toplu İzin Listesi" },
];

const toZeroBased = (m) => {
  const n = Number(m);
  if (!Number.isFinite(n)) return 0;
  if (n >= 1 && n <= 12) return n - 1;
  if (n >= 0 && n <= 11) return n;
  return ((Math.round(n) % 12) + 12) % 12;
};
/* eslint-disable no-unused-vars */
const toOneBased = (m) => toZeroBased(m) + 1;
/* eslint-enable no-unused-vars */

const MONTHS_TR = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

const SECTION_META = {
  "calisma-cizelgesi": {
    icon: ClipboardList,
    eyebrow: "Planlama Motoru",
    shortLabel: "Çalışma",
    description: "Vardiya atamalarını üretin, düzenleyin ve kaydedin. Bu alan diğer çizelgelerin veri kaynağıdır.",
  },
  "aylik-calisma-ve-mesai-saatleri-cizelgesi": {
    icon: FileSpreadsheet,
    eyebrow: "Aylık Hesap",
    shortLabel: "Aylık Çalışma",
    description: "Çalışma çizelgesinden gelen vardiyaları aylık saat ve devir hesabına dönüştürün.",
  },
  "fazla-mesai-takip": {
    icon: Clock3,
    eyebrow: "Mesai İzleme",
    shortLabel: "Fazla Mesai",
    description: "Personel bazında fiili çalışma, izin kredisi ve fazla mesai çıktısını tek tabloda izleyin.",
  },
  "toplu-izin-listesi": {
    icon: CalendarClock,
    eyebrow: "İzin Yönetimi",
    shortLabel: "Toplu İzin",
    description: "Ay içindeki izin kodlarını toplu görün, aktarın ve diğer çizelgelerle uyumlu tutun.",
  },
};

const SECTION_WORKSPACE_COPY = {
  "calisma-cizelgesi": {
    label: "Atama Çalışma Alanı",
    summary: "Bu ekranda yalnız kişilere atama, manuel düzeltme ve sonuç önizlemesi yapılır.",
    source: "Görev satırları, gün bazlı sayı matrisi ve sayısal kurgu Parametreler > Çizelge Yapısı altında yönetilir.",
    steps: [
      "Önce servis ve rol bağlamını seçin.",
      "Listeyi oluşturun veya mevcut atamaları düzenleyin.",
      "Hızlı yerine atama, sabitleme ve manuel düzeltmeleri doğrudan burada yapın.",
    ],
  },
  "aylik-calisma-ve-mesai-saatleri-cizelgesi": {
    label: "Saat ve Devir Çalışma Alanı",
    summary: "Çalışma çizelgesinden gelen vardiyalar aylık saat, devir ve çalışılacak süre hesabına burada dönüştürülür.",
    source: "Bu tablo çalışma çizelgesini truth kaynağı olarak okur; burada yaptığınız Excel içe/dışa aktarma sadece aylık saat matrisini etkiler.",
    steps: [
      "Önce çalışma çizelgesini güncel tutun.",
      "Gerekirse Çizelgeden Doldur ile saat matrisini yenileyin.",
      "Excel düzenlemeleri sonrası toplamları ve devir alanlarını buradan kontrol edin.",
    ],
  },
  "fazla-mesai-takip": {
    label: "Mesai İzleme Çalışma Alanı",
    summary: "Fiili çalışma, çalışılmış sayılan izin kredisi ve fazla mesai hesapları personel bazında burada izlenir.",
    source: "Fazla mesai tablosu çalışma çizelgesi, izin kayıtları ve vardiya saat tanımlarını birlikte kullanır.",
    steps: [
      "Servis ve rol bağlamını seçin.",
      "Çizelgeden Doldur ile güncel vardiya saatlerini aktarın.",
      "Arama ve toplam kartlarıyla personel bazlı fazla mesai yükünü inceleyin.",
    ],
  },
  "toplu-izin-listesi": {
    label: "İzin Toplama Çalışma Alanı",
    summary: "Ay içindeki izin kodlarını toplu görün, içe aktarın ve diğer çizelgelerle uyumu buradan yönetin.",
    source: "İzin matrisi aylık çalışma ve fazla mesai hesaplarını doğrudan etkiler; bu nedenle burada yapılan değişiklikler diğer çizelgelere yansır.",
    steps: [
      "Ay ve servis bağlamını seçin.",
      "Excel içe aktarımıyla izinleri toplu yükleyin veya tek tek kontrol edin.",
      "Kaynak izin kodlarının çalışma saatine etkisini aylık/fazla mesai ekranlarında doğrulayın.",
    ],
  },
};

function getSectionMeta(sectionId, fallbackName = "") {
  return (
    SECTION_META[sectionId] || {
      icon: FileSpreadsheet,
      eyebrow: "Çizelge Modülü",
      shortLabel: fallbackName || "Çizelge",
      description: "Bu çalışma alanı için özel içerik burada görüntülenir.",
    }
  );
}

function SectionWorkspaceIntro({ sectionId }) {
  const copy = SECTION_WORKSPACE_COPY[sectionId];
  if (!copy) return null;
  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4">
        <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">{copy.label}</div>
        <p className="mt-2 text-sm leading-6 text-slate-700">{copy.summary}</p>
        <div className="mt-3 rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-600">
          <span className="font-medium text-slate-800">Veri kaynağı:</span> {copy.source}
        </div>
      </div>
      <div className="rounded-[24px] border border-slate-200 bg-white px-4 py-4">
        <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">Kullanım Akışı</div>
        <ol className="mt-2 space-y-2 text-sm leading-6 text-slate-700">
          {copy.steps.map((step, idx) => (
            <li key={step} className="flex gap-3">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold text-white">
                {idx + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function getSecFromLocation() {
  try {
    const { hash, search } = window.location;
    if (hash && hash.startsWith("#/cizelgeler")) {
      const parts = hash.split("/");
      const id = decodeURIComponent(parts[2] || parts[parts.length - 1] || "");
      return id && id !== "cizelgeler" ? id : null;
    }
    const q = new URLSearchParams(search).get("sec");
    return q ? decodeURIComponent(q) : null;
  } catch { return null; }
}

/* CSV/XLSX ortak */
const splitCsvLine = (line) => {
  const re = /,(?=(?:[^"]*"[^"]*")*[^"]*$)/g;
  return line.split(re).map((t) => {
    const x = t.trim();
    return x.startsWith('"') && x.endsWith('"') ? x.slice(1, -1).replace(/""/g, '"') : x;
  });
};
const parseCSV = (text) => {
  const lines = (text || "").replace(/\r/g, "").split("\n").filter(Boolean);
  if (!lines.length) return { header: [], rows: [] };
  const header = splitCsvLine(lines[0]).map((h) => String(h || "").trim());
  const rows = lines.slice(1).map(splitCsvLine);
  return { header, rows };
};
async function readTableFile(file) {
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  const isCsv = ext === "csv" || (file.type && file.type.includes("csv"));
  if (isCsv) {
    const text = await file.text();
    return parseCSV(text);
  }
  const ab = await file.arrayBuffer();
  const wb = XLSX.read(ab, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows2d = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
  const header = (rows2d[0] || []).map((v) => String(v ?? "").trim());
  const rows = rows2d.slice(1).map((r) => header.map((_, i) => String((r && r[i]) ?? "").trim()));
  return { header, rows };
}
const extractDay = (h) => {
  const m = String(h || "").match(/\d{1,2}/);
  if (!m) return NaN;
  const n = parseInt(m[0], 10);
  return n >= 1 && n <= 31 ? n : NaN;
};

/* =========================
   Alt sekme içerikleri
========================= */
function SectionContent({
  sectionId,
  year,
  month, // 1..12
  setYear,
  setMonth,
  peopleAll,
  allLeaves,
  leaveTypes,
  workingHours,
  selectedServiceId,
  selectedServiceName,
  activeRole,
  servicesById,
}) {
  const editorRef = useRef(null);
  const monthlyRef = useRef(null);
  const templateFileRef = useRef(null);
  const overtimeRef = useRef(null);
  const fileInputRef = useRef(null); // Toplu İzin içe aktar

  // Takas geçmişi — onaylanmış takas talepleri bu ay
  const [swapLog, setSwapLog] = useState([]);
  const [swapLogOpen, setSwapLogOpen] = useState(false);
  useEffect(() => {
    let active = true;
    http.get(`/api/requests?type=takas&status=approved`)
      .then((res) => {
        if (!active) return;
        const ymKey = `${year}-${String(month).padStart(2, "0")}`;
        const executed = (Array.isArray(res?.items) ? res.items : [])
          .filter((r) => r.swapExecuted && (String(r.swapMyDate || "").startsWith(ymKey) || String(r.swapTargetDate || "").startsWith(ymKey)));
        setSwapLog(executed);
      })
      .catch(() => {});
    return () => { active = false; };
  }, [year, month]);

  // DutyRowsEditor'a iletilen takas hücresi seti — "dayNum|ROWID|personName"
  const swappedCells = useMemo(() => {
    const s = new Set();
    const ymKey = `${year}-${String(month).padStart(2, "0")}`;
    for (const r of swapLog) {
      if (!r.swapExecuted) continue;
      // myDate üzerinde artık swapWithPersonName var
      if (String(r.swapMyDate || "").startsWith(ymKey)) {
        const d = Number(String(r.swapMyDate || "").slice(8, 10));
        const shiftId = String(r.swapMyShiftId || "");
        const name = String(r.swapWithPersonName || "");
        if (d && shiftId && name) {
          s.add(`${d}|${shiftId}|${name}`);
          s.add(`${d}|${shiftId.toUpperCase()}|${name}`);
        }
      }
      // targetDate üzerinde artık fromName var
      if (String(r.swapTargetDate || "").startsWith(ymKey)) {
        const d = Number(String(r.swapTargetDate || "").slice(8, 10));
        const shiftId = String(r.swapTargetShiftId || "");
        const name = String(r.fromName || "");
        if (d && shiftId && name) {
          s.add(`${d}|${shiftId}|${name}`);
          s.add(`${d}|${shiftId.toUpperCase()}|${name}`);
        }
      }
    }
    return s;
  }, [swapLog, year, month]);
  const handleBuild = useCallback(() => {
    if (editorRef.current?.build) return editorRef.current.build();
    toast.error("Çizelge bileşeni yüklenemedi", { description: "Sayfayı yenileyin ve tekrar deneyin." });
  }, []);

  // Toplu İzin export (gerçek)
  const handleExportLeaves = useCallback(async () => {
    const mIdx = toZeroBased(month);
    const month1 = mIdx + 1;
    const daysInMonth = new Date(year, month1, 0).getDate();
    const ymStr = `${year}-${String(month1).padStart(2, "0")}`;
    const header = ["personId", "name", ...Array.from({ length: daysInMonth }, (_, i) => String(i + 1))];
    const rows = (Array.isArray(peopleAll) ? peopleAll : []).map((p) => {
      const pid = String(p.id ?? "");
      const name = p.fullName || p.name || "";
      const monthly = allLeaves?.[pid]?.[ymStr] || {};
      const cols = [pid, name];
      for (let d = 1; d <= daysInMonth; d++) {
        const rec = monthly?.[String(d)];
        const code = rec ? (typeof rec === "object" ? (rec.code || "") : String(rec)) : "";
        cols.push(code || "");
      }
      return cols;
    });
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `Toplu_${ymStr}`);
    XLSX.writeFile(wb, `toplu-izin-${ymStr}.xlsx`, { bookType: "xlsx" });
  }, [peopleAll, allLeaves, year, month]);

  // Toplu İzin import (gerçek)
  const triggerImportLeaves = useCallback(() => fileInputRef.current?.click(), []);
  const onFilePicked = useCallback(async (ev) => {
    const mIdx = toZeroBased(month);
    const month1 = mIdx + 1;
    const file = ev.target.files?.[0];
    if (!file) return;
    try {
      const { header, rows } = await readTableFile(file);
      if (!header.length) { toast.error("Dosya okunamadı", { description: "Beklenen format: .xlsx veya .csv, ilk satır başlık (personId, name, 1..31)." }); return; }

      const daysInMonth = new Date(year, month1, 0).getDate();

      const idxId = header.findIndex((h) => h.toLowerCase() === "personid" || h.toLowerCase() === "id");
      const idxName = header.findIndex((h) => ["name", "ad", "ad soyad"].includes(h.toLowerCase()));

      const dayCols = [];
      header.forEach((h, i) => {
        const d = extractDay(h);
        if (Number.isFinite(d) && d >= 1 && d <= daysInMonth) dayCols.push([d, i]);
      });
      const seen = new Set();
      const dayColsClean = [];
      for (const [d, i] of dayCols.sort((a, b) => a[0] - b[0])) {
        if (!seen.has(d)) { dayColsClean.push([d, i]); seen.add(d); }
      }
      if (!dayColsClean.length) { toast.error("Gün sütunları bulunamadı", { description: "Excel'de 1–31 arası sayısal başlıklı sütunlar olmalıdır." }); return; }

      const peopleByName = Object.fromEntries(
        (peopleAll || []).map((p) => [(p.fullName || p.name || "").trim().toLowerCase(), p])
      );

      let updates = 0;
      const conflictLog = [];
      let conflictPolicy = null; // null: sorulmadı, true: uygula+vardiya sil, false: çakışanları atla
      rows.forEach((cols) => {
        let pid = idxId >= 0 ? String(cols[idxId] || "").trim() : "";
        let personMeta = null;
        if (!pid && idxName >= 0) {
          const nm = String(cols[idxName] || "").trim().toLowerCase();
          const record = peopleByName[nm];
          if (record?.id) {
            pid = String(record.id);
            personMeta = record;
          }
        } else if (pid && idxName >= 0) {
          const nm = String(cols[idxName] || "").trim().toLowerCase();
          personMeta = peopleByName[nm] || personMeta;
        }
        if (!pid) return;
        if (!personMeta && peopleAll) {
          personMeta = (peopleAll || []).find((p) => String(p.id) === pid) || null;
        }
        const personName = personMeta?.fullName || personMeta?.name || "";

        for (const [d, iCol] of dayColsClean) {
          const val = String(cols[iCol] || "").trim();
          if (val) {
            const conflict = checkLeaveShiftConflict({
              personId: pid,
              personName,
              year,
              month: month1,
              day: d,
              people: peopleAll,
            });
            if (conflict.hasConflict) {
              conflictLog.push(conflict.message);
              try {
                window.dispatchEvent(new CustomEvent("leave:conflict", { detail: conflict }));
              } catch {}
              if (conflictPolicy === null) {
                conflictPolicy = window.confirm(
                  "Excel importta vardiya-izin çakışmaları var.\n" +
                  "Çakışan hücrelerde izin eklensin ve mevcut vardiya otomatik silinsin mi?\n\n" +
                  "İptal seçersen çakışan hücreler atlanır."
                );
              }
              if (!conflictPolicy) continue;
              void removeShiftOnDay({
                personId: pid,
                personName,
                year,
                month: month1,
                day: d,
                people: peopleAll,
              });
            }
            setLeave({ personId: pid, personName, year, month: month1, day: d, code: val }); updates++;
          }
          else     { unsetLeave({ personId: pid, personName, year, month: month1, day: d }); }
        }
      });

      if (conflictLog.length) {
        toast.warning(`${updates} hücre güncellendi, ${conflictLog.length} çakışma var`, {
          description: conflictLog.slice(0, 3).join(" · ") + (conflictLog.length > 3 ? ` · +${conflictLog.length - 3} daha` : ""),
          duration: 6000,
        });
      } else {
        toast.success("İçe aktarma tamamlandı", { description: `${updates} hücre güncellendi.` });
      }
      try { window.dispatchEvent(new Event("leaves:changed")); } catch {}
    } catch (e) {
      console.error(e);
      toast.error("Dosya okunamadı", { description: "Dosya bozuk veya desteklenmeyen formatta." });
    } finally {
      ev.target.value = "";
    }
  }, [peopleAll, month, year]);

  // Ortak toolbar: her sekmede aynı butonlar, sekmeye göre handler değişir
  const noop = () => {};
  const commonToolbarProps = {
    year,
    month,
    setYear,
    setMonth,
    onAi: noop,
    onBuild: noop,
    onExport: noop,
    onImport: noop,
    onReset: noop,
  };

  const triggerTemplateImport = useCallback(() => {
    const input = templateFileRef.current;
    if (input) {
      input.value = "";
      input.click();
    } else if (editorRef.current?.importTemplate) {
      toast.error("Dosya seçici açılamadı", { description: "Sayfayı yenileyin ve tekrar deneyin." });
    }
  }, []);

  const handleTemplateFile = useCallback(
    async (ev) => {
      const file = ev.target.files?.[0];
      if (!file) return;
      try {
        if (editorRef.current?.importTemplate) {
          await editorRef.current.importTemplate(file);
        } else {
          toast.error("İçe aktarım desteklenmiyor", { description: "Bu sekme için şablon içe aktarımı mevcut değil." });
        }
      } finally {
        ev.target.value = "";
      }
    },
    []
  );

  const SwapLogBanner = swapLog.length > 0 && (
    <div className="rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm">
      <button
        className="w-full flex items-center gap-2 text-left"
        onClick={() => setSwapLogOpen((v) => !v)}
      >
        <ArrowLeftRight size={15} className="text-orange-500 shrink-0" />
        <span className="font-semibold text-orange-800">
          Bu ay {swapLog.length} takas gerçekleşti
        </span>
        <span className="ml-auto text-[11px] text-orange-500">{swapLogOpen ? "▲ Gizle" : "▼ Göster"}</span>
      </button>
      {swapLogOpen && (
        <div className="mt-2 space-y-1.5 border-t border-orange-200 pt-2">
          {swapLog.map((r) => (
            <div key={r._id || r.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-orange-900">
              <span className="font-medium">{r.fromName}</span>
              <span className="text-orange-400">⇆</span>
              <span className="font-medium">{r.swapWithPersonName || "?"}</span>
              <span className="text-orange-600 font-mono">{r.swapMyDate} {r.swapMyShiftLabel || r.swapMyShiftId}</span>
              <span className="text-orange-400">↔</span>
              <span className="text-orange-600 font-mono">{r.swapTargetDate} {r.swapTargetShiftLabel || r.swapTargetShiftId}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  switch (sectionId) {
    case "calisma-cizelgesi":
      return (
        <div className="space-y-3">
          {SwapLogBanner}
          <ScheduleToolbar
            title="Çalışma Çizelgesi"
            {...commonToolbarProps}
            onAi={() => editorRef.current?.ai?.() ?? commonToolbarProps.onAi()}
            onBuild={handleBuild}
            onExport={() => editorRef.current?.exportExcel?.() ?? commonToolbarProps.onExport()}
          />
          <SectionWorkspaceIntro sectionId={sectionId} />
          <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
            <div className="font-medium">Yapılandırma bu ekrandan ayrıldı.</div>
            <div className="mt-1 text-sky-800/80">
              Görev satırları, gün bazlı sayı matrisi ve sayısal önizleme artık{" "}
              <button
                type="button"
                onClick={() => { try { window.location.hash = "/parametreler/cizelge-yapisi"; } catch {} }}
                className="font-semibold underline underline-offset-2"
              >
                Parametreler &gt; Çizelge Yapısı
              </button>{" "}
              altında yönetilir.
            </div>
          </div>
          <div className="rounded-lg border bg-white p-4">
            <DutyRowsEditor
              ref={editorRef}
              mode="assignmentOnly"
              year={year}
              month={month}
              sectionId={sectionId}
              serviceId={selectedServiceId}
              role={activeRole}
              peopleAll={peopleAll}
              workingHours={workingHours}
              personLeaves={allLeaves}
              swappedCells={swappedCells}
            />
          </div>
        </div>
      );

    case "aylik-calisma-ve-mesai-saatleri-cizelgesi":
      return (
        <div className="space-y-3">
          {SwapLogBanner}
          <ScheduleToolbar
            title="Aylık Çalışma ve Mesai Saatleri Çizelgesi"
            {...commonToolbarProps}
            onBuild={() => monthlyRef.current?.importFromRoster?.() ?? commonToolbarProps.onBuild()}
            onExport={() => monthlyRef.current?.exportExcel?.() ?? commonToolbarProps.onExport()}
            onImport={() => monthlyRef.current?.importExcel?.() ?? commonToolbarProps.onImport()}
            onReset={() => monthlyRef.current?.reset?.() ?? commonToolbarProps.onReset()}
          />
          <SectionWorkspaceIntro sectionId={sectionId} />
          <div className="rounded-lg border bg-white p-4">
            <MonthlyHoursSheet
              ref={monthlyRef}
              ym={{ year, month }}
              people={Array.isArray(peopleAll) ? peopleAll : []}
              workingHours={workingHours}
              serviceId={selectedServiceId || ""}
              activeRole={activeRole}
              setYm={(val) => {
                const y = Number(val?.year) || year;
                const m = Number(val?.month) || month;
                setYear(y);
                setMonth(m);
              }}
              hideToolbar
            />
          </div>
        </div>
      );

    case "fazla-mesai-takip":
      return (
        <div className="space-y-3">
          {SwapLogBanner}
          <ScheduleToolbar
            title="Fazla Mesai Takip Formu"
            {...commonToolbarProps}
            onBuild={() => overtimeRef.current?.importFromRoster?.() ?? commonToolbarProps.onBuild()}
            onExport={() => overtimeRef.current?.exportExcel?.() ?? commonToolbarProps.onExport()}
            onReset={() => overtimeRef.current?.reset?.() ?? commonToolbarProps.onReset()}
          />
          <SectionWorkspaceIntro sectionId={sectionId} />
          <div className="rounded-lg border bg-white p-4">
            <OvertimeTab
              ref={overtimeRef}
              hideToolbar
              year={year}
              month={month}
              workingHours={workingHours}
              people={Array.isArray(peopleAll) ? peopleAll : []}
              leaveTypes={Array.isArray(leaveTypes) ? leaveTypes : []}
              selectedServiceId={selectedServiceId}
              selectedServiceName={selectedServiceName}
              activeRole={activeRole}
              servicesById={servicesById instanceof Map ? servicesById : null}
            />
          </div>
        </div>
      );

    case "toplu-izin-listesi":
      return (
        <div className="space-y-3">
          <ScheduleToolbar
            title="Toplu İzin Listesi"
            {...commonToolbarProps}
            onExport={handleExportLeaves}
            onImport={triggerImportLeaves}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
            className="hidden"
            onChange={onFilePicked}
          />
          <SectionWorkspaceIntro sectionId={sectionId} />
          <div className="rounded-lg border bg-white p-4">
            <MonthlyLeavesMatrixGeneric
              people={Array.isArray(peopleAll) ? peopleAll : []}
              year={year}
              month={toZeroBased(month)}
              personLeaves={allLeaves}
              selectedService={selectedServiceId || null}
              leaveTypes={leaveTypes}
            />
          </div>
        </div>
      );

    default:
      return (
        <div className="space-y-3">
          <ScheduleToolbar
            title={`Sekme: ${sectionId}`}
            {...commonToolbarProps}
          />
          <div className="rounded-lg border bg-white p-4">
            <div className="text-sm text-slate-600">Özel sekme içeriği (placeholder).</div>
          </div>
        </div>
      );
  }
}

/* =========================
   Ana bileşen
========================= */
export default function SchedulesTab({ workAreas, workingHours, peopleAll: peopleAllProp, leaveTypes: leaveTypesProp, personLeaves: personLeavesProp }) {
  const storeWorkingHours = useAppStore((s) => s.workingHours);
  const storeNurses       = useAppStore((s) => s.nurses);
  const storeDoctors      = useAppStore((s) => s.doctors);
  const storeLeaveTypes   = useAppStore((s) => s.leaveTypes);
  const storePersonLeaves = useAppStore((s) => s.personLeaves);
  const storePeopleAll    = useMemo(() => [...storeDoctors, ...storeNurses], [storeDoctors, storeNurses]);

  const effectiveWorkingHours   = Array.isArray(workingHours)   ? workingHours   : storeWorkingHours;
  const effectivePeopleAllProp  = Array.isArray(peopleAllProp)  ? peopleAllProp  : storePeopleAll;
  const effectiveLeaveTypesProp = Array.isArray(leaveTypesProp) ? leaveTypesProp : storeLeaveTypes;
  const effectivePersonLeaves   = (personLeavesProp && typeof personLeavesProp === "object")
    ? personLeavesProp
    : storePersonLeaves;

  const initialSections = useMemo(() => {
    const v = LS.get(LS_KEY, DEFAULT_SECTIONS);
    return Array.isArray(v) && v.length ? v : DEFAULT_SECTIONS;
  }, []);
  const [sections, setSections] = useState(initialSections);

  useEffect(() => {
    const refresh = (e) => {
      if (e?.type === "storage" && e.key !== null && e.key !== LS_KEY) return;
      const v = LS.get(LS_KEY, DEFAULT_SECTIONS);
      setSections(Array.isArray(v) && v.length ? v : DEFAULT_SECTIONS);
    };
    window.addEventListener("storage", refresh);
    window.addEventListener("scheduleSectionsChanged", refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("scheduleSectionsChanged", refresh);
    };
  }, []);

  const [activeId, setActiveId] = useState(() => {
    const fromUrl = getSecFromLocation();
    const fromLs = LS.get(LS_ACTIVE, initialSections[0]?.id || "");
    return fromUrl || fromLs || initialSections[0]?.id || "";
  });

  const active = useMemo(
    () => sections.find((s) => s.id === activeId) || sections[0],
    [sections, activeId]
  );

  const [visitedIds, setVisitedIds] = useState(() => (activeId ? [activeId] : []));

  useEffect(() => {
    if (!activeId) return;
    setVisitedIds((prev) => (prev.includes(activeId) ? prev : [...prev, activeId]));
  }, [activeId]);

  useEffect(() => {
    setVisitedIds((prev) => prev.filter((id) => sections.some((s) => s.id === id)));
  }, [sections]);

  const visitedInOrder = useMemo(() => {
    const remaining = new Set(visitedIds);
    const ordered = [];
    for (const s of sections) {
      if (remaining.delete(s.id)) ordered.push(s.id);
    }
    remaining.forEach((id) => ordered.push(id));
    return ordered;
  }, [sections, visitedIds]);

  useEffect(() => {
    if (!activeId) return;
    LS.set(LS_ACTIVE, activeId);
    try { window.location.hash = `#/cizelgeler/${encodeURIComponent(activeId)}`; } catch {}
  }, [activeId]);

  useEffect(() => {
    const syncFromUrl = () => {
      const id = getSecFromLocation();
      if (!id) return;
      setActiveId((prev) => (prev === id ? prev : id));
    };
    syncFromUrl();
    window.addEventListener("hashchange", syncFromUrl);
    window.addEventListener("popstate", syncFromUrl);
    return () => {
      window.removeEventListener("hashchange", syncFromUrl);
      window.removeEventListener("popstate", syncFromUrl);
    };
  }, []);

  useEffect(() => {
    const idFromUrl = getSecFromLocation();
    if (idFromUrl) return;
    if (!sections.some((s) => s.id === activeId)) {
      setActiveId(sections[0]?.id || "");
    }
  }, [sections, activeId]);

  const { ym, setYear, setMonth } = useActiveYM(); // month: 1..12
  const { year, month } = ym;

  const peopleAll = useMemo(() => {
    const raw = Array.isArray(effectivePeopleAllProp) ? effectivePeopleAllProp : [];
    return raw
      .map((p) => {
        const id = p?.id ?? p?.personId ?? p?.pid ?? p?.tc ?? p?.kod ?? p?.code ?? "";
        const name = p?.fullName || p?.name || [p?.firstName, p?.lastName].filter(Boolean).join(" ");
        const pid = String(id || "").trim();
        return {
          ...p,
          id: pid,
          personId: pid,
          name: name || "",
          fullName: name || "",
          service: p?.service || p?.serviceId || p?.department || null,
        };
      })
      .filter((x) => x.id);
  }, [effectivePeopleAllProp]);

  const [allLeaves, setAllLeaves] = useState(() => effectivePersonLeaves || getAllLeaves());
  useEffect(() => {
    if (effectivePersonLeaves) {
      setAllLeaves(effectivePersonLeaves);
      return undefined;
    }
    const refreshLeaves = () => setAllLeaves(getAllLeaves());
    window.addEventListener("leaves:changed", refreshLeaves);
    return () => window.removeEventListener("leaves:changed", refreshLeaves);
  }, [effectivePersonLeaves]);

  const leaveTypes = useMemo(
    () => (Array.isArray(effectiveLeaveTypesProp) ? effectiveLeaveTypesProp : []),
    [effectiveLeaveTypesProp]
  );

  const handleTabClick = useCallback((id) => {
    setActiveId(id);
    try { window.location.hash = `#/cizelgeler/${encodeURIComponent(id)}`; } catch {}
  }, []);

  /* ======== SERVİS KAPSAMI (3.5) ======== */
  const scope = useServiceScope();
  // Servis ve rol seçimi artık Zustand store üzerinden yönetiliyor.
  // PlanTab da aynı store'u kullandığı için sekmeler arası otomatik senkronize.
  const storeServiceId = useAppStore((s) => s.activeServiceId);
  const setStoreServiceId = useAppStore((s) => s.setActiveServiceId);
  const svc = storeServiceId || scope.defaultServiceId || "";
  const setSvc = useCallback((id) => setStoreServiceId(id), [setStoreServiceId]);

  /* ======== ROL SENKRONIZASYONU (PlanTab ile — Zustand store) ======== */
  const activeRole = useAppStore((s) => s.activeRole);
  const setActiveRole = useAppStore((s) => s.setActiveRole);

  // Person kaydından servisId nasıl okunur?
  const getPersonServiceId = useCallback((p) =>
    String(p?.service ?? p?.serviceId ?? p?.department ?? p?.departmentId ?? p?.sectionId ?? ""), []);

  // Kapsama göre people filtresi
  const scopedPeople = useMemo(() => {
    const all = Array.isArray(peopleAll) ? peopleAll : [];
    if (scope.isAdmin) {
      if (!svc) return all; // Tümü
      return all.filter((p) => getPersonServiceId(p) === String(svc));
    }
    const allow = new Set(scope.allowedIds.map(String));
    return all.filter((p) => allow.has(getPersonServiceId(p)));
  }, [peopleAll, scope.isAdmin, scope.allowedIds, svc, getPersonServiceId]);

  const selectedServiceId = scope.isAdmin ? (svc || "") : scope.defaultServiceId;
  const selectedServiceName = scope.isAdmin
    ? (selectedServiceId
        ? (scope.servicesById.get(String(selectedServiceId))?.name
            || scope.servicesById.get(String(selectedServiceId))?.code
            || String(selectedServiceId))
        : "Tümü")
    : (
        scope.servicesById.get(scope.defaultServiceId)?.name
        || scope.servicesById.get(scope.defaultServiceId)?.code
        || scope.defaultServiceId
        || "-"
      );

  const activeMeta = getSectionMeta(active?.id, active?.name);
  const ActiveIcon = activeMeta.icon;
  const monthLabel = `${MONTHS_TR[Math.max(0, Math.min(11, Number(month || 1) - 1))]} ${year}`;
  const scopeBadgeLabel = scope.isAdmin ? (selectedServiceName || "Tümü") : selectedServiceName;
  const roleLabel = activeRole === "Doctor" ? "Doktor" : "Hemşire";

  return (
    <div className="p-4 space-y-5">
      <WorkspaceHero
        badges={[
          { icon: ActiveIcon, label: "Çizelge Odaklı Workspace", tone: "border-slate-200 bg-slate-50 text-slate-500" },
          { icon: ShieldCheck, label: scope.isAdmin ? "Yönetim Kapsamı" : "Servis Kapsamı", tone: "border-emerald-200 bg-emerald-50 text-emerald-700" },
        ]}
        title={active?.name || "Çizelgeler"}
        description="Çizelgeyi ana çalışma yüzeyi yaptık. Çizelge türü, servis ve rol kontrolleri tabloya yaklaştırıldı; böylece kullanıcı önce bağlamı seçip sonra doğrudan veri üzerinde çalışır."
        metrics={[
          { icon: CalendarClock, accent: "sky", label: "Dönem", value: monthLabel },
          { icon: Stethoscope, accent: "emerald", label: "Servis", value: scopeBadgeLabel || "Tümü" },
          { icon: Users, accent: "violet", label: "Personel", value: `${scopedPeople.length} kişi` },
          { icon: ClipboardList, accent: "amber", label: "Görünüm", value: activeMeta.shortLabel },
        ]}
      />

      <section className="space-y-4">
        <WorkspacePanel
          title="Çizelge Türü"
          description="Aktif çizelgeyi seçin, sonra aynı bağlam içinde ilgili çalışma alanına geçin."
          aside={
            <div>
              <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">Çalışma Bağlamı</div>
              <div className="mt-3 rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                <div className="space-y-4">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-700">Servis</label>
                    {scope.isAdmin ? (
                      <select
                        className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none transition focus:border-sky-300 focus:bg-white"
                        value={svc}
                        onChange={(e) => setSvc(e.target.value)}
                      >
                        <option value="">Tümü</option>
                        {(scope.allowedIds || []).map((id) => {
                          const s = scope.servicesById.get(String(id));
                          const name = s?.name || s?.code || id;
                          return (
                            <option key={id} value={id}>
                              {name}
                            </option>
                          );
                        })}
                      </select>
                    ) : (
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
                        {selectedServiceName || "-"}
                      </div>
                    )}
                  </div>

                  <div>
                    <div className="mb-2 text-sm font-medium text-slate-700">Rol</div>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => setActiveRole("Nurse")}
                        className={`h-11 rounded-2xl border text-sm font-medium transition ${
                          activeRole === "Nurse"
                            ? "border-slate-900 bg-slate-950 text-white"
                            : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-white"
                        }`}
                      >
                        Hemşire
                      </button>
                      <button
                        onClick={() => setActiveRole("Doctor")}
                        className={`h-11 rounded-2xl border text-sm font-medium transition ${
                          activeRole === "Doctor"
                            ? "border-slate-900 bg-slate-950 text-white"
                            : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-white"
                        }`}
                      >
                        Doktor
                      </button>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-600">
                    <div className="font-medium text-slate-800">Aktif bağlam</div>
                    <div className="mt-1 leading-6">
                      {activeMeta.shortLabel} · {scopeBadgeLabel || "Tümü"} · {monthLabel}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          }
        >
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {sections.map((s) => {
                const meta = getSectionMeta(s.id, s.name);
                const Icon = meta.icon;
                const isActive = s.id === activeId;
                return (
                  <button
                    key={s.id}
                    onClick={() => handleTabClick(s.id)}
                    className={`w-full rounded-[22px] border px-3 py-3 text-left transition ${
                      isActive
                        ? "border-slate-900 bg-slate-950 text-white shadow-[0_18px_40px_-28px_rgba(15,23,42,0.75)]"
                        : "border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border ${
                        isActive ? "border-white/15 bg-white/10 text-white" : "border-slate-200 bg-white text-slate-700"
                      }`}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <div className={`text-[11px] font-medium uppercase tracking-[0.16em] ${isActive ? "text-white/65" : "text-slate-500"}`}>
                          {meta.eyebrow}
                        </div>
                        <div className={`mt-1 text-sm font-semibold ${isActive ? "text-white" : "text-slate-900"}`}>{s.name}</div>
                        <p className={`mt-1 text-xs leading-5 ${isActive ? "text-white/72" : "text-slate-600"}`}>
                          {meta.shortLabel}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
          </div>
        </WorkspacePanel>

        <div className="min-w-0 rounded-[30px] border border-slate-200 bg-white p-3 shadow-sm md:p-4">
          <div className="sticky top-3 z-10 mb-4 rounded-[24px] border border-slate-200 bg-white/92 px-4 py-3 shadow-sm backdrop-blur">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">Tablo Çalışma Alanı</div>
                <div className="mt-1 text-lg font-semibold text-slate-900">{active?.name || "Çizelgeler"}</div>
              </div>
              <div className="flex flex-wrap gap-2 text-sm text-slate-600">
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5">Servis: <span className="font-medium text-slate-800">{scopeBadgeLabel || "Tümü"}</span></span>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5">Rol: <span className="font-medium text-slate-800">{roleLabel}</span></span>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5">Kişi: <span className="font-medium text-slate-800">{scopedPeople.length}</span></span>
              </div>
            </div>
          </div>

          {visitedInOrder.map((id) => {
            const section = sections.find((s) => s.id === id);
            if (!section) return null;
            const isActive = id === activeId;
            return (
              <div
                key={id}
                className={isActive ? "" : "hidden"}
                hidden={!isActive}
                aria-hidden={isActive ? "false" : "true"}
              >
                <SectionContent
                  sectionId={section.id}
                  year={year}
                  month={month}
                  setYear={setYear}
                  setMonth={setMonth}
                  peopleAll={scopedPeople}
                  allLeaves={allLeaves}
                  leaveTypes={leaveTypes}
                  workingHours={effectiveWorkingHours}
                  selectedServiceId={selectedServiceId}
                  selectedServiceName={selectedServiceName}
                  activeRole={activeRole}
                  servicesById={scope.servicesById}
                />
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
