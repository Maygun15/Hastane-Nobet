// src/tabs/WorkingHoursTab.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { sortByKeyTR } from "../utils/localeSort.js";
import { shiftDurationHours } from "../utils/date.js";

/**
 * Hibrit Çalışma:
 * - Eğer parent { workingHours, setWorkingHours } verirse onları kullanır (controlled).
 * - Yoksa kendi state + localStorage (workingHoursV2) ile çalışır (uncontrolled).
 */

const LS_KEY = "workingHoursV2";
const DEFAULTS = [
  { id: "g-8",  code: "G8",  start: "08:00", end: "16:00" },
  { id: "g-16", code: "G16", start: "08:00", end: "00:00" }, // 16 saatlik örnek
  { id: "n-24", code: "N24", start: "08:00", end: "08:00" }, // 24 saatlik örnek
];

function useHybridWorkingHours(external, setExternal) {
  const controlled = typeof setExternal === "function" && Array.isArray(external);

  const [inner, setInner] = useState(() => {
    if (controlled) return [];
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  const setWH = (updater) => {
    if (controlled) {
      setExternal((prev) => {
        const next = typeof updater === "function" ? updater(prev ?? []) : updater;
        return sortByKeyTR(next ?? [], "code");
      });
    } else {
      setInner((prev0) => {
        const prev = prev0 ?? [];
        const next = typeof updater === "function" ? updater(prev) : updater;
        const sorted = sortByKeyTR(next ?? [], "code");
        try { localStorage.setItem(LS_KEY, JSON.stringify(sorted)); } catch {}
        return sorted;
      });
    }
  };

  const list = controlled ? (external ?? []) : (inner ?? []);

  useEffect(() => {
    if (!controlled) {
      try { localStorage.setItem(LS_KEY, JSON.stringify(list ?? [])); } catch {}
    }
  }, [controlled, list]);

  return [list, setWH, controlled];
}

export default function WorkingHoursTab({ workingHours, setWorkingHours }) {
  const [list, setWH, controlled] = useHybridWorkingHours(workingHours, setWorkingHours);

  // --- form state
  const emptyForm = { id: undefined, code: "", start: "08:00", end: "17:00" };
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const importRef = useRef(null);

  useEffect(() => { if (!editingId) setForm(emptyForm); }, [editingId]);

  const reset = () => {
    setForm(emptyForm);
    setEditingId(null);
  };

  const upsert = (e) => {
    e.preventDefault();
    if (!form.code.trim()) return;

    const start5 = (form.start || "").slice(0, 5);
    const end5   = (form.end   || "").slice(0, 5);

    if (start5 === end5) {
      alert("Uyarı: Başlangıç ve bitiş aynı. Bu vardiya 24 saat olarak kabul edilecek.");
    } else {
      const [sh, sm] = start5.split(":").map(Number);
      const [eh, em] = end5.split(":").map(Number);
      const sMin = (sh % 24) * 60 + (sm % 60);
      const eMin = (eh % 24) * 60 + (em % 60);
      if (eMin < sMin) console.info("Bilgi: Bu vardiya gece devrediyor (ertesi güne taşıyor).");
    }

    const id = editingId ?? Date.now();
    const row = { ...form, id, code: form.code.trim(), start: start5, end: end5 };

    setWH((prev) => {
      const base = Array.isArray(prev) ? prev : [];
      const filtered = base.filter((r) => r.id !== id);
      return sortByKeyTR([...filtered, row], "code");
    });
    reset();
  };

  const edit = (r) => {
    setEditingId(r.id);
    setForm({
      id: r.id,
      code: r.code || "",
      start: (r.start || "08:00").slice(0, 5),
      end: (r.end || "17:00").slice(0, 5),
    });
  };

  const del = (id) => {
    setWH((prev) => (prev || []).filter((r) => r.id !== id));
  };

  const clearWorkingHours = () => {
    const ok = window.confirm("Tüm vardiya tanımları silinsin mi?\nBu işlem geri alınamaz.");
    if (!ok) return;
    setWH([]);
    if (!controlled) {
      try { localStorage.removeItem(LS_KEY); } catch {}
    }
  };

  // İstersen varsayılan ekleyi korumak için bu fonksiyon duruyor; UI'dan kaldırıldı.
  const loadDefaults = () => {
    const withIds = DEFAULTS.map((r, i) => ({ ...r, id: `def-${i}-${Date.now()}` }));
    setWH((prev) => sortByKeyTR([...(prev ?? []), ...withIds], "code"));
  };

  /* ---------- Excel ---------- */
  const exportXLSX = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["KOD", "BAŞLANGIÇ", "BİTİŞ", "SÜRE"],
      ...(list ?? []).map((r) => [
        r.code,
        (r.start || "").slice(0, 5),
        (r.end   || "").slice(0, 5),
        shiftDurationHours(r.start, r.end),
      ]),
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Vardiyalar");
    XLSX.writeFile(wb, "calisma_saatleri.xlsx");
  };

  const triggerImport = () => importRef.current?.click();

  const importXLSX = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = (evt) => {
      const data = new Uint8Array(evt.target.result);
      const wb = XLSX.read(data, { type: "array" });
      const sh = wb.Sheets["Vardiyalar"] ?? wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sh, { defval: "" });
      const parsed = rows
        .map((row, idx) => {
          const code  = (row["KOD"] || row["VARDİYE KODU"] || row["VARDIYE KODU"] || "").toString().trim();
          const start = (row["BAŞLANGIÇ"] || row["BASLANGIC"] || row["START"] || "08:00").toString().slice(0, 5);
          const end   = (row["BİTİŞ"]    || row["BITIS"]     || row["END"]   || "17:00").toString().slice(0, 5);
          if (!code) return null;
          return { id: Date.now() + idx, code, start, end };
        })
        .filter(Boolean);
      if (!parsed.length) {
        alert("Excel başlıkları: KOD, BAŞLANGIÇ, BİTİŞ");
        return;
      }
      setWH((prev) => sortByKeyTR([...(prev ?? []), ...parsed], "code"));
      if (importRef.current) importRef.current.value = "";
      alert(parsed.length + " kayıt yüklendi");
    };
    r.readAsArrayBuffer(f);
  };

  // Süre label'ı (formdaki)
  const formDuration = useMemo(
    () => shiftDurationHours(form.start, form.end),
    [form.start, form.end]
  );

  return (
    <div className="space-y-4">
      {/* Üst sağ butonlar — WorkAreas ile aynı stil */}
      <div className="flex items-center justify-end gap-2">
        <button type="button" className="px-3 py-2 text-sm border rounded" onClick={exportXLSX}>
          Excele Aktar
        </button>
        <label className="px-3 py-2 text-sm border rounded cursor-pointer">
          Excelden Yükle
          <input
            ref={importRef}
            type="file"
            accept=".xls,.xlsx"
            className="hidden"
            onChange={importXLSX}
          />
        </label>
        <button
          type="button"
          className="px-3 py-2 text-sm border rounded text-red-600"
          onClick={clearWorkingHours}
        >
          Vardiyeleri Sıfırla
        </button>
      </div>

      <h3 className="font-medium">Çalışma Saatleri</h3>

      {/* Form — placeholder'lar boş, WorkAreas ile aynı font */}
      <form
        onSubmit={upsert}
        className="bg-white rounded-2xl shadow-sm p-4 grid md:grid-cols-5 gap-3 items-end"
      >
        <input
          value={form.code}
          onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
          placeholder="" /* örnek metin yok */
          className="px-3 py-2 border rounded"
        />
        <input
          type="time"
          value={form.start}
          onChange={(e) => setForm((f) => ({ ...f, start: e.target.value.slice(0, 5) }))}
          className="px-3 py-2 border rounded"
          title="Başlangıç (örn. 08:00)"
        />
        <input
          type="time"
          value={form.end}
          onChange={(e) => setForm((f) => ({ ...f, end: e.target.value.slice(0, 5) }))}
          className="px-3 py-2 border rounded"
          title="Bitiş (örn. 17:00)"
        />
        <div className="text-sm text-slate-500 self-center">Süre: {formDuration} saat</div>
        <div className="flex gap-2">
          <button type="submit" className="px-3 py-2 text-sm border rounded bg-emerald-600 text-white">
            {editingId ? "Güncelle" : "Ekle"}
          </button>
          {editingId && (
            <button type="button" onClick={reset} className="px-3 py-2 text-sm border rounded bg-slate-100">
              İptal
            </button>
          )}
        </div>
      </form>

      {/* Tablo */}
      <div className="bg-white rounded-2xl shadow-sm p-4 overflow-x-auto">
        <table className="w-full table-fixed text-sm">
          <colgroup>
            <col className="w-28" />
            <col className="w-28" />
            <col className="w-28" />
            <col className="w-28" />
            <col />
          </colgroup>
        <thead className="text-slate-500">
          <tr className="border-b">
            <th className="px-3 py-2 text-left">Kod</th>
            <th className="px-3 py-2 text-center">Başlangıç</th>
            <th className="px-3 py-2 text-center">Bitiş</th>
            <th className="px-3 py-2 text-center">Süre (saat)</th>
            <th className="px-3 py-2 text-right">İşlem</th>
          </tr>
        </thead>
        <tbody>
          {(!list || list.length === 0) && (
            <tr>
              <td colSpan={5} className="px-3 py-6 text-center text-slate-400">
                Henüz kayıt yok.
              </td>
            </tr>
          )}
          {(list ?? []).map((r) => (
            <tr key={r.id} className="border-t">
              <td className="px-3 py-2">{r.code}</td>
              <td className="px-3 py-2 text-center font-mono tabular-nums">
                {(r.start || "").slice(0, 5)}
              </td>
              <td className="px-3 py-2 text-center font-mono tabular-nums">
                {(r.end || "").slice(0, 5)}
              </td>
              <td className="px-3 py-2 text-center font-mono tabular-nums">
                {shiftDurationHours(r.start, r.end)}
              </td>
              <td className="px-3 py-2 text-right">
                <div className="inline-flex gap-1">
                  <button onClick={() => edit(r)} className="px-2 py-1 text-xs border rounded bg-slate-100">
                    Düzenle
                  </button>
                  <button onClick={() => del(r.id)} className="px-2 py-1 text-xs border rounded bg-slate-100">
                    Sil
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
        </table>
      </div>
    </div>
  );
}
