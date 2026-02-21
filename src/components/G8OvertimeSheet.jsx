// src/components/G8OvertimeSheet.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Calendar as CalendarIcon, FileSpreadsheet, Upload, RotateCcw } from "lucide-react";
import { overtimeHours } from "../utils/overtime.js";
import { SHIFT_HOURS, LEAVE_RULES } from "../constants/rules.js";
import { LS } from "../utils/storage.js";
import { buildLeaveCreditRules } from "../utils/leaveTypeRules.js";

/* ==== LS keyler ==== */
const LS_KEY_CFG = "g8_cfg";   // yıl/ay ve resmi tatiller
const LS_KEY_DATA = "g8_rows"; // kişi satırları

const pad2 = (n) => String(n).padStart(2, "0");
const ymKey = (y, m) => `${y}-${pad2(m)}`;

/* LS yardımcıları */
function loadLS(k, fallback) {
  try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; }
}
function saveLS(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch {}
}

export default function G8OvertimeSheet({
  year: propYear,
  month: propMonth1to12,
  people = [],      // [{id, fullName, role, tckn, serviceName}]
  allLeaves = {},   // { [personId]: { "YYYY-MM": { [day]: code } } }
  allShifts = {},   // { [personId]: { "YYYY-MM": { [day]: "M"/"N"/... } } }
  leaveRules,
  shiftHoursMap = SHIFT_HOURS,
}) {
  const today = new Date();
  const [cfg, setCfg] = useState(() => loadLS(LS_KEY_CFG, {
    year: propYear ?? today.getFullYear(),
    month: propMonth1to12 ?? (today.getMonth() + 1),
    officialHolidays: [], // ["2025-08-30"]
    arifeDays: [],        // ["2025-08-09"]
  }));

  const [rows, setRows] = useState(() => loadLS(LS_KEY_DATA, people.map(p => ({
    personId: p.id ?? p.personId ?? "",
    tckn: p.tckn ?? p.tc ?? "",
    fullName: p.fullName ?? p.name ?? "",
    role: p.role ?? p.title ?? "",
    serviceName: p.serviceName ?? p.service ?? p.department ?? "",
    leaves: {}, shifts: {},
  }))));

  const [derivedLeaveRules, setDerivedLeaveRules] = useState(() =>
    buildLeaveCreditRules(LS.get("leaveTypesV2", []), LEAVE_RULES)
  );

  useEffect(() => {
    const refresh = () => {
      setDerivedLeaveRules(buildLeaveCreditRules(LS.get("leaveTypesV2", []), LEAVE_RULES));
    };
    window.addEventListener("leaveTypes:changed", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("leaveTypes:changed", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const effectiveLeaveRules = leaveRules || derivedLeaveRules;

  const importRef = useRef(null);

  useEffect(() => { saveLS(LS_KEY_CFG, cfg); }, [cfg]);
  useEffect(() => { saveLS(LS_KEY_DATA, rows); }, [rows]);

  const ymk = ymKey(cfg.year, cfg.month);

  /* hesaplama */
  const computed = useMemo(() => {
    const off = new Set(cfg.officialHolidays || []);
    const arife = new Set(cfg.arifeDays || []);
    return rows.map((r) => {
      const leavesDays = (allLeaves?.[r.personId]?.[ymk]) ?? r.leaves ?? {};
      const shiftsDays = (allShifts?.[r.personId]?.[ymk]) ?? r.shifts ?? {};
      const calc = overtimeHours({
        year: cfg.year,
        month1to12: cfg.month,
        officialHolidaysYmd: off,
        arifeDaysYmd: arife,
        personLeavesByDay: leavesDays,
        leaveRules: effectiveLeaveRules,
        personShiftsByDay: shiftsDays,
        shiftHoursMap,
      });
      return { ...r, ...calc };
    });
  }, [rows, cfg, allLeaves, allShifts, effectiveLeaveRules, shiftHoursMap]);

  const totalOvertime = useMemo(() => computed.reduce((a, c) => a + (c.overtime || 0), 0), [computed]);

  /* excel dışa aktar */
  function exportXlsx() {
    const header = [
      "Sıra", "TC", "Ad Soyad", "Ünvan", "Servis",
      "Zorunlu (Taban)", "İzin Kredisi", "Zorunlu (Final)",
      "Fiili Çalışma", "Fazla Mesai"
    ];
    const data = computed.map((c, i) => ([
      i + 1, c.tckn || "", c.fullName || c.name || "", c.role || "", c.serviceName || "",
      c.requiredBase ?? 0, c.leaveCredit ?? 0, c.requiredFinal ?? 0,
      c.worked ?? 0, c.overtime ?? 0
    ]));
    const ws = XLSX.utils.aoa_to_sheet([header, ...data]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `G8_${ymk}`);
    XLSX.writeFile(wb, `g8-fazla-mesai_${ymk}.xlsx`, { compression: true });
  }

  /* excel içe aktar */
  function importXlsx(file) {
    const fr = new FileReader();
    fr.onload = () => {
      const wb = XLSX.read(new Uint8Array(fr.result), { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
      const head = aoa[0].map(h => h.toString().trim().toLowerCase());
      const iTc   = head.indexOf("tc");
      const iName = head.indexOf("ad soyad");
      const iRole = head.indexOf("ünvan");
      const iSrv  = head.indexOf("servis");
      const next = [];
      for (let r = 1; r < aoa.length; r++) {
        const row = aoa[r];
        if (!row || row.every(x => (x ?? "").toString().trim() === "")) continue;
        next.push({
          personId: `${row[iTc] || row[iName] || r}`,
          tckn: row[iTc] || "",
          fullName: row[iName] || "",
          role: row[iRole] || "",
          serviceName: row[iSrv] || "",
          leaves: {}, shifts: {},
        });
      }
      setRows(next);
    };
    fr.readAsArrayBuffer(file);
  }

  function resetAll() {
    if (!confirm("G8 verileri sıfırlansın mı?")) return;
    setRows([]);
  }

  return (
    <div className="tl-card p-4 space-y-4">
      {/* başlık */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CalendarIcon size={18} />
          <div className="font-medium">
            {cfg.year} / {String(cfg.month).padStart(2, "0")} — G8 Fazla Mesai Hesap
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select className="tl-btn" value={cfg.month} onChange={e => setCfg(v => ({ ...v, month: Number(e.target.value) }))}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>{String(m).padStart(2, "0")}</option>)}
          </select>
          <input className="tl-btn w-24 text-center" type="number" value={cfg.year}
            onChange={e => setCfg(v => ({ ...v, year: Number(e.target.value) }))} />
          <button className="tl-btn" onClick={exportXlsx}><FileSpreadsheet size={16} className="mr-1" />Dışa Aktar</button>
          <button className="tl-btn" onClick={resetAll}><RotateCcw size={16} className="mr-1" />Sıfırla</button>
          <button className="tl-btn" onClick={() => importRef.current?.click()}><Upload size={16} className="mr-1" />İçe Al</button>
          <input ref={importRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => e.target.files?.[0] && importXlsx(e.target.files[0])} />
        </div>
      </div>

      {/* resmi tatil + arife */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="tl-card p-3">
          <div className="tl-sub mb-2 font-medium">Resmî Tatiller (YYYY-MM-DD)</div>
          <TagInput value={(cfg.officialHolidays || [])} onChange={(arr) => setCfg(v => ({ ...v, officialHolidays: arr }))} />
        </div>
        <div className="tl-card p-3">
          <div className="tl-sub mb-2 font-medium">Arife Günleri (YYYY-MM-DD) — her biri 4 saat</div>
          <TagInput value={(cfg.arifeDays || [])} onChange={(arr) => setCfg(v => ({ ...v, arifeDays: arr }))} />
        </div>
      </div>

      {/* tablo */}
      <div className="overflow-auto">
        <table className="min-w-full">
          <thead>
            <tr className="border-b">
              {["Sıra","TC","Ad Soyad","Ünvan","Servis","Zorunlu (Taban)","İzin Kredisi","Zorunlu (Final)","Fiili","Fazla Mesai"].map((h) => (
                <th key={h} className="tl-th text-left px-3 py-2">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {computed.map((r, idx) => (
              <tr key={r.personId || idx} className="border-b last:border-0">
                <td className="tl-td px-3 py-1">{idx + 1}</td>
                <td className="tl-td px-3 py-1">{r.tckn || ""}</td>
                <td className="tl-td px-3 py-1">{r.fullName || r.name || ""}</td>
                <td className="tl-td px-3 py-1">{r.role || ""}</td>
                <td className="tl-td px-3 py-1">{r.serviceName || ""}</td>
                <td className="tl-td px-3 py-1">{r.requiredBase?.toFixed(1)}</td>
                <td className="tl-td px-3 py-1">{r.leaveCredit?.toFixed(1)}</td>
                <td className="tl-td px-3 py-1">{r.requiredFinal?.toFixed(1)}</td>
                <td className="tl-td px-3 py-1">{r.worked?.toFixed(1)}</td>
                <td className="tl-td px-3 py-1 font-medium">{(r.overtime || 0).toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="tl-td px-3 py-2 font-medium" colSpan={9}>Toplam Fazla Mesai</td>
              <td className="tl-td px-3 py-2 font-semibold">{totalOvertime.toFixed(1)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="tl-sub">
        Not: Zorunlu saat = işgünleri ×8 + arife işgünü ×4 − çalışılmış sayılan izinler. Fiilî çalışma vardiya saatlerinden hesaplanır.
      </div>
    </div>
  );
}

/* küçük tag input */
function TagInput({ value = [], onChange }) {
  const [txt, setTxt] = useState("");
  const add = () => {
    const v = txt.trim();
    if (!v) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) { alert("YYYY-MM-DD formatında gir."); return; }
    if (value.includes(v)) return;
    onChange([...(value || []), v]);
    setTxt("");
  };
  const del = (v) => onChange((value || []).filter(x => x !== v));
  return (
    <div>
      <div className="flex items-center gap-2">
        <input
          className="tl-btn flex-1 h-[34px]"
          placeholder="2025-08-30"
          value={txt}
          onChange={e => setTxt(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <button className="tl-btn tl-btn-primary" onClick={add}>Ekle</button>
      </div>
      <div className="flex flex-wrap gap-2 mt-2">
        {(value || []).map(v => (
          <span key={v} className="px-2 py-1 rounded-md border text-[12px]">
            {v}
            <button className="ml-2 text-red-600" onClick={() => del(v)}>×</button>
          </span>
        ))}
      </div>
    </div>
  );
}
