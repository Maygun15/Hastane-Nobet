// src/tabs/SchedulesTab.jsx
import React, { useMemo, useState, useEffect, useCallback, useRef } from "react";
import { LS } from "../utils/storage.js";
import DutyRowsEditor from "../components/DutyRowsEditor.jsx";
import ScheduleToolbar from "../components/ScheduleToolbar.jsx";
import MonthlyHoursSheet from "../components/MonthlyHoursSheet.jsx";
import OvertimeTab from "./OvertimeTab.jsx";
import MonthlyLeavesMatrixGeneric from "./MonthlyLeavesMatrixGeneric.jsx";
import { getAllLeaves, setLeave, unsetLeave, buildNameUnavailability } from "../lib/leaves.js";
import { collectRequestsByPerson } from "../lib/requestParser.js";
import useActiveYM from "../hooks/useActiveYM.js";
import useServiceScope from "../hooks/useServiceScope.js"; // ⬅️ YENİ: servis kapsamı

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

      if (row.gorev.includes("SERVİS SORUMLUSU")) {
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

/* People / LeaveTypes helpers (güvenli okuma) */
function readPeopleAll() {
  try {
    const keys = ["peopleAll", "peopleV2", "people", "personList", "personnel", "nurses", "staff"];
    const normalize = (arr) =>
      (arr || [])
        .map((p) => {
          const id = p?.id ?? p?.personId ?? p?.pid ?? p?.tc ?? p?.kod ?? p?.code ?? "";
          const name = p?.fullName || p?.name || [p?.firstName, p?.lastName].filter(Boolean).join(" ");
          return {
            id: String(id || "").trim(),
            name: name || "",
            fullName: name || "",
            service: p?.service || p?.serviceId || p?.department || null,
            ...p
          };
        })
        .filter((x) => x.id);
    for (const k of keys) {
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      const val = JSON.parse(raw);
      if (Array.isArray(val)) return normalize(val);
      if (val && typeof val === "object") {
        if (Array.isArray(val.items)) return normalize(val.items);
        const flattened = Object.values(val).flatMap((v) => (Array.isArray(v) ? v : []));
        if (flattened.length) return normalize(flattened);
      }
    }
  } catch {}
  return [];
}

function readLeaveTypes() {
  try {
    const tryKeys = ["leaveTypesV1", "leaveTypes", "izinTurleri", "izinTurleriV1", "vacationTypes", "rules"];
    let arr = null;
    for (const k of tryKeys) {
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      const val = JSON.parse(raw);
      if (Array.isArray(val) && val.length) { arr = val; break; }
      if (val && typeof val === "object") {
        if (Array.isArray(val.leaveTypes))    { arr = val.leaveTypes;    break; }
        if (Array.isArray(val.izinTurleri))   { arr = val.izinTurleri;   break; }
        if (Array.isArray(val.vacationTypes)) { arr = val.vacationTypes; break; }
      }
    }
    if (!arr) return [];
    return arr
      .map((x) => {
        if (typeof x === "string") {
          const [codeRaw, nameRaw] = x.split(/[-—–]/).map((s) => s.trim());
          const code = codeRaw?.length ? codeRaw : x.trim();
          const name = nameRaw?.length ? nameRaw : "";
          return { code, name };
        }
        const id   = (x?.id ?? x?.code ?? x?.key ?? x?.type) ?? "";
        const code = (x?.code ?? x?.id ?? x?.key ?? x?.type) ?? "";
        const name = (x?.name ?? x?.title ?? x?.label) ?? "";
        return { id: String(id), code: String(code).trim(), name: String(name).trim() };
      })
      .filter((t) => t.code);
  } catch { return []; }
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
  const XLSX = await import("xlsx");
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
  selectedServiceId, // ⬅️ YENİ
}) {
  const editorRef = useRef(null);
  const monthlyRef = useRef(null);
  const templateFileRef = useRef(null);
  const overtimeRef = useRef(null);
  const fileInputRef = useRef(null); // Toplu İzin içe aktar
  const handleBuild = useCallback(() => generateScheduleFromLS(year, month), [year, month]);

  // Toplu İzin export (gerçek)
  const handleExportLeaves = useCallback(async () => {
    const mIdx = toZeroBased(month);
    const month1 = mIdx + 1;
    const XLSX = await import("xlsx");
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
      if (!header.length) return alert("Dosya boş veya hatalı.");

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
      if (!dayColsClean.length) return alert("Gün sütunları (1..31) bulunamadı.");

      const peopleByName = Object.fromEntries(
        (peopleAll || []).map((p) => [(p.fullName || p.name || "").trim().toLowerCase(), p])
      );

      let updates = 0;
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
          if (val) { setLeave({ personId: pid, personName, year, month: month1, day: d, code: val }); updates++; }
          else     { unsetLeave({ personId: pid, personName, year, month: month1, day: d }); }
        }
      });

      alert(`İçe aktarma tamamlandı. Güncellenen hücre: ${updates}`);
      try { window.dispatchEvent(new Event("leaves:changed")); } catch {}
    } catch (e) {
      console.error(e);
      alert("Dosya okunurken hata oluştu.");
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
      alert("Dosya seçici açılamadı.");
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
          alert("İçe aktarım desteklenmiyor.");
        }
      } finally {
        ev.target.value = "";
      }
    },
    []
  );

  switch (sectionId) {
    case "calisma-cizelgesi":
      return (
        <div className="space-y-3">
          <ScheduleToolbar
            title="Çalışma Çizelgesi"
            {...commonToolbarProps}
            onAi={() => editorRef.current?.ai?.() ?? commonToolbarProps.onAi()}
            onBuild={() => editorRef.current?.build?.() ?? handleBuild()}
            onExport={() => editorRef.current?.exportExcel?.() ?? commonToolbarProps.onExport()}
            onImport={triggerTemplateImport}
            onReset={() => editorRef.current?.reset?.() ?? commonToolbarProps.onReset()}
          />
          <input
            ref={templateFileRef}
            type="file"
            accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            className="hidden"
            onChange={handleTemplateFile}
          />
          <div className="rounded-lg border bg-white p-4">
            <DutyRowsEditor
              ref={editorRef}
              year={year}
              month={month}
              sectionId={sectionId}
              serviceId={selectedServiceId}
            />
          </div>
        </div>
      );

    case "aylik-calisma-ve-mesai-saatleri-cizelgesi":
      return (
        <div className="space-y-3">
          <ScheduleToolbar
            title="Aylık Çalışma ve Mesai Saatleri Çizelgesi"
            {...commonToolbarProps}
            onBuild={() => monthlyRef.current?.importFromRoster?.() ?? commonToolbarProps.onBuild()}
            onExport={() => monthlyRef.current?.exportExcel?.() ?? commonToolbarProps.onExport()}
            onImport={() => monthlyRef.current?.importExcel?.() ?? commonToolbarProps.onImport()}
            onReset={() => monthlyRef.current?.reset?.() ?? commonToolbarProps.onReset()}
          />
          <div className="rounded-lg border bg-white p-4">
            <MonthlyHoursSheet
              ref={monthlyRef}
              ym={{ year, month }}
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
          <ScheduleToolbar
            title="Fazla Mesai Takip Formu"
            {...commonToolbarProps}
            onBuild={() => overtimeRef.current?.importFromRoster?.() ?? commonToolbarProps.onBuild()}
            onExport={() => overtimeRef.current?.exportExcel?.() ?? commonToolbarProps.onExport()}
            onReset={() => overtimeRef.current?.reset?.() ?? commonToolbarProps.onReset()}
          />
          <div className="rounded-lg border bg-white p-4">
            <OvertimeTab ref={overtimeRef} hideToolbar />
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
export default function SchedulesTab() {
  const initialSections = useMemo(() => {
    const v = LS.get(LS_KEY, DEFAULT_SECTIONS);
    return Array.isArray(v) && v.length ? v : DEFAULT_SECTIONS;
  }, []);
  const [sections, setSections] = useState(initialSections);

  useEffect(() => {
    const refresh = () => {
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

  const [peopleAll, setPeopleAll] = useState(() => readPeopleAll());
  useEffect(() => {
    const refreshPeople = () => setPeopleAll(readPeopleAll());
    const onStorage = (e) => {
      if (!e || ["peopleV2","peopleAll","people","personList","personnel","nurses","staff","doctors"].includes(e.key)) {
        refreshPeople();
      }
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("people:changed", refreshPeople);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("people:changed", refreshPeople);
    };
  }, []);

  const [allLeaves, setAllLeaves] = useState(() => getAllLeaves());
  useEffect(() => {
    const refreshLeaves = () => setAllLeaves(getAllLeaves());
    window.addEventListener("leaves:changed", refreshLeaves);
    return () => window.removeEventListener("leaves:changed", refreshLeaves);
  }, []);

  const [leaveTypes, setLeaveTypes] = useState(() => readLeaveTypes());
  useEffect(() => {
    const refreshLT = () => setLeaveTypes(readLeaveTypes());
    window.addEventListener("storage", refreshLT);
    window.addEventListener("leaveTypes:changed", refreshLT);
    return () => {
      window.removeEventListener("storage", refreshLT);
      window.removeEventListener("leaveTypes:changed", refreshLT);
    };
  }, []);

  const handleTabClick = useCallback((id) => {
    setActiveId(id);
    try { window.location.hash = `#/cizelgeler/${encodeURIComponent(id)}`; } catch {}
  }, []);

  /* ======== SERVİS KAPSAMI (3.5) ======== */
  const scope = useServiceScope();
  const [svc, setSvc] = useState(scope.defaultServiceId);

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

  return (
    <div className="p-4 space-y-4">
      {/* Sekme pill’leri */}
      <div className="flex flex-wrap items-center gap-3">
        <div
          className="flex items-center gap-2 overflow-x-auto pr-2"
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
        >
          {sections.map((s) => (
            <button
              key={s.id}
              onClick={() => handleTabClick(s.id)}
              title={s.id}
              className={`shrink-0 rounded-full border px-4 h-10 text-sm ${
                s.id === activeId
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white hover:bg-gray-50"
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
      </div>

      {/* Servis filtresi (admin için seçim, kullanıcı için rozet) */}
      <div className="flex items-center gap-2">
        {scope.isAdmin ? (
          <>
            <label className="text-sm text-slate-600">Servis:</label>
            <select
              className="h-9 px-2 rounded-lg border"
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
          </>
        ) : (
          <span className="text-xs px-2 py-1 rounded-lg bg-slate-100 text-slate-700">
            Servis:&nbsp;
            {
              scope.servicesById.get(scope.defaultServiceId)?.name
              || scope.servicesById.get(scope.defaultServiceId)?.code
              || scope.defaultServiceId || "-"
            }
          </span>
        )}
      </div>

      {/* Alt sekmeleri canlı tut (diğerlerine geçince state kaybolmasın) */}
      <div>
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
                month={month}       // 1..12
                setYear={setYear}
                setMonth={setMonth}
                peopleAll={scopedPeople}      /* ⬅️ sadece kapsam içindekiler */
                allLeaves={allLeaves}
                leaveTypes={leaveTypes}
                selectedServiceId={selectedServiceId} /* ⬅️ içeriğe geçir */
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
