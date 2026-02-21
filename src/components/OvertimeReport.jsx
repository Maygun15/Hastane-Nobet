import React, { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  Calendar as CalendarIcon,
  ChevronLeft, ChevronRight,
  FileSpreadsheet, Upload, RotateCcw, Settings, Trash2, Search
} from "lucide-react";
import {
  fetchPersonnel,
  fetchMonthlySchedule,
  fetchHolidayCalendar,
  fetchLeaves,
} from "../api/apiAdapter";
import useActiveYM from "../hooks/useActiveYM.js";

/* ================ Helpers ================ */
const pad2 = (n) => String(n).padStart(2, "0");
const ymKey = (y, m) => `${y}-${pad2(m)}`;
const clamp = (n, a, b) => Math.min(Math.max(n, a), b);
const daysInMonth = (y, m) => new Date(y, m, 0).getDate();
const iso = (y, m, d) => `${y}-${pad2(m)}-${pad2(d)}`;
const isWeekend = (y, m, d) => {
  const dow = new Date(y, m - 1, d).getDay(); // 0=Pa,6=Cts
  return dow === 0 || dow === 6;
};

const INPUT =
  "w-full outline-none text-center px-1.5 py-1 rounded-md border border-gray-300 bg-white " +
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
// holidays: [{date:"YYYY-MM-DD", kind:"full"|"arife"|"half"}]
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
function creditedLeaveHoursForMonth({ year, month, leaves, holidays }) {
  if (!leaves?.length) return 0;
  const hmap = new Map(holidays.map((h) => [h.date, h.kind]));
  const dim = daysInMonth(year, month);
  const dayCredit = Array(dim).fill(0);

  const eachDay = (startIso, endIso, cb) => {
    const s = new Date(startIso);
    const e = new Date(endIso ?? startIso);
    for (let dt = new Date(s); dt <= e; dt.setDate(dt.getDate() + 1)) cb(new Date(dt));
  };

  for (const lv of leaves) {
    eachDay(lv.start, lv.end, (dt) => {
      const y = dt.getFullYear(), m = dt.getMonth() + 1, d = dt.getDate();
      if (y !== year || m !== month) return;
      const std = dayStandardHours(y, m, d, hmap);
      if (std === 0) return;

      let credit = 0;
      const partial = (lv.partial || "none").toLowerCase();
      if (partial === "none") credit = std;
      else if (partial === "half_am" || partial === "half_pm") credit = std / 2;
      else if (partial === "hours") credit = Math.min(Number(lv.hours || 0), std);
      else credit = std;

      const idx = d - 1;
      dayCredit[idx] = Math.min(std, dayCredit[idx] + credit);
    });
  }
  return dayCredit.reduce((a, b) => a + b, 0);
}

/* ================ Component ================ */
export default function OvertimeTab() {
  // >>> Tek AY/YIL kaynağı <<<
  const { ym, setYear, setMonth, gotoPrev, gotoNext } = useActiveYM();
  const { year, month } = ym;

  const [cfg, setCfg] = useState(() => ({ ...DEFAULT_CFG, ...(JSON.parse(localStorage.getItem(LS_CFG) || "null") || {}) }));
  const [rows, setRows] = useState(() =>
    JSON.parse(localStorage.getItem(LS_DATA_PREFIX + ymKey(year, month)) || "[]")
  );

  const [people, setPeople] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [leavesByPerson, setLeavesByPerson] = useState({}); // {personId: leaves[]}
  const [search, setSearch] = useState("");
  const fileRef = useRef(null);
  const dcount = daysInMonth(year, month);

  /* persist */
  useEffect(() => localStorage.setItem(LS_CFG, JSON.stringify(cfg)), [cfg]);
  useEffect(() => {
    localStorage.setItem(LS_DATA_PREFIX + ymKey(year, month), JSON.stringify(rows));
  }, [rows, year, month]);

  /* ay/yıl değişince, bu aya ait kayıtları yükle (varsa) */
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

  /* personnel (G6 ile aynı kaynak) */
  useEffect(() => {
    (async () => {
      const list = await fetchPersonnel({ unitId: cfg.unitId || undefined, active: true /*, token */ });
      setPeople(list || []);
    })();
  }, [cfg.unitId]);

  /* holidays */
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const list = await fetchHolidayCalendar({ year, month /*, token */ });
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

  /* hesaplar */
  const computed = useMemo(() => {
    const stdMonthly = computeMonthlyStdHours(year, month, holidays); // kişi başı
    const perRowBase = rows.map((r) => {
      const work = (r.days || []).reduce((a, b) => a + (Number(b) || 0), 0);
      return { id: r.id, work };
    });
    const perRowLeave = rows.map((r) => {
      const leaves = leavesByPerson[r.personId] || [];
      const credited = creditedLeaveHoursForMonth({ year, month, leaves, holidays });
      return { id: r.id, credited };
    });
    const perRow = rows.map((r) => {
      const work = perRowBase.find((x) => x.id === r.id)?.work || 0;
      const credited = perRowLeave.find((x) => x.id === r.id)?.credited || 0;
      const required = Math.max(0, stdMonthly - credited); // Gereken Saat
      const overtime = Math.max(0, work - required);       // Fazla Mesai
      return { id: r.id, work, credited, required, overtime };
    });
    const grandWork = perRow.reduce((a, b) => a + b.work, 0);
    const grandOT = perRow.reduce((a, b) => a + b.overtime, 0);
    return { stdMonthly, perRow, grandWork, grandOT };
  }, [rows, year, month, holidays, leavesByPerson]);

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

    // Vardiya
    const plan = await fetchMonthlySchedule({ personId, year, month /*, token */ });
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

    // İzin
    const lv = await fetchLeaves({ personId, year, month /*, token */ });
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
      "Unvan", "Adı Soyadı", "Servis",
      ...Array.from({ length: dcount }, (_, i) => `${i + 1}`),
      "Çalışma", "İzin(ÇS)", "Gereken", "Fazla Mesai",
    ];
    const body = rows.map((r) => {
      const rec = computed.perRow.find((x) => x.id === r.id) || { work: 0, credited: 0, required: 0, overtime: 0 };
      return [
        r.title || "", r.person || "", r.service || "",
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

  return (
    <div className="p-3 space-y-3">
      {/* toolbar */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={gotoPrev} className="p-2 rounded-xl hover:bg-gray-100"><ChevronLeft size={18} /></button>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-gray-50 border">
            <CalendarIcon size={16} />
            <input
              type="number"
              className="w-20 outline-none bg-transparent"
              value={year}
              onChange={(e) => setYear(clamp(parseInt(e.target.value || "0", 10) || year, 1970, 2099))}
            />
            <span>/</span>
            <input
              type="number"
              className="w-12 outline-none bg-transparent"
              value={month}
              onChange={(e) => setMonth(clamp(parseInt(e.target.value || "0", 10) || month, 1, 12))}
            />
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-gray-50 border">
            <Settings size={16} className="opacity-70" />
            <label className="text-sm">Birim:</label>
            <input className="w-48 outline-none bg-transparent" value={cfg.department} onChange={(e) => setCfg((c) => ({ ...c, department: e.target.value }))} />
            <label className="text-sm ml-2">UnitId:</label>
            <input className="w-32 outline-none bg-transparent" value={cfg.unitId} onChange={(e) => setCfg((c) => ({ ...c, unitId: e.target.value }))} />
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl border bg-white">
            <Search size={16} className="opacity-70" />
            <input className="outline-none bg-transparent" placeholder="Personel ara" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <button onClick={resetMonth} className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-rose-600 text-white hover:bg-rose-700"><RotateCcw size={16} /> Sıfırla</button>
          <button onClick={() => fileRef.current?.click()} className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700"><Upload size={16} /> Excel Yükle</button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={() => { /* içe aktarım eklenecekse buraya */ }} className="hidden" />
          <button onClick={exportExcel} className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700"><FileSpreadsheet size={16} /> .xlsx Dışa Aktar</button>
          <button onClick={gotoNext} className="p-2 rounded-xl hover:bg-gray-100"><ChevronRight size={18} /></button>
        </div>
      </div>

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
              <th className="p-2 text-left">Servis</th>
              {Array.from({ length: dcount }, (_, i) => (
                <th key={i} className="p-2 text-center w-12 font-mono tabular-nums border-l border-gray-200">{i + 1}</th>
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
                        people={filteredPeople}
                        onChange={(pid) => onSelectPerson(r.id, pid)}
                        displayValue={r.person}
                      />
                    </td>
                    <td className="p-1 min-w-[160px]">
                      <input className={TXT} value={r.service} onChange={(e) => updateField(r.id, "service", e.target.value)} placeholder="Servis" />
                    </td>
                    {r.days.map((v, i) => (
                      <td key={i} className="p-0.5 w-12 text-center">
                        <input className={`${INPUT} h-8 md:h-9`} value={v} inputMode="decimal" onChange={(e) => updateDay(r.id, i, e.target.value)} />
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
          {filteredPeople.map((p) => (
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
}

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
