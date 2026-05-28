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
  const controlled = typeof setExternal === "function";

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
      const current = Array.isArray(external) ? external : [];
      const next = typeof updater === "function" ? updater(current) : updater;
      setExternal(sortByKeyTR(next ?? [], "code"));
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

  const list = controlled ? (Array.isArray(external) ? external : []) : (inner ?? []);

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
    <div className="px-8 py-6 max-w-7xl mx-auto space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-800">Çalışma Saatleri</h2>
          <p className="text-sm text-slate-500 mt-1">Vardiya tanımlarını yönetin; Excel ile toplu içe/dışa aktarın.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button type="button" className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white hover:bg-slate-50" onClick={exportXLSX}>
            Excele Aktar
          </button>
          <label className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white hover:bg-slate-50 cursor-pointer">
            Excel'den Yükle
            <input ref={importRef} type="file" accept=".xls,.xlsx" className="hidden" onChange={importXLSX} />
          </label>
          <button
            type="button"
            className="px-3 py-2 text-sm border border-red-200 rounded-lg text-red-600 hover:bg-red-50"
            onClick={() => {
              if (!window.confirm("Kritik işlem: Tüm vardiya tanımları sıfırlanacak. Devam edilsin mi?")) return;
              clearWorkingHours();
            }}
          >
            Vardiyeleri Sıfırla
          </button>
        </div>
      </div>

      {/* İki sütun: Yeni Ekle | Mevcut Liste */}
      <div className="grid grid-cols-1 xl:grid-cols-[340px_minmax(0,1fr)] gap-6 items-start">
        {/* Yeni Vardiya Ekle */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
            <div className="text-sm font-medium text-slate-700">
              {editingId ? "Vardiyayı Düzenle" : "Yeni Vardiya Ekle"}
            </div>
            <div className="text-xs text-slate-500 mt-1">Kod, başlangıç ve bitiş saatini girin.</div>
          </div>
          <form onSubmit={upsert} className="p-4 space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Kod</label>
              <input
                value={form.code}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                placeholder=""
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Başlangıç</label>
                <input
                  type="time"
                  value={form.start}
                  onChange={(e) => setForm((f) => ({ ...f, start: e.target.value.slice(0, 5) }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Bitiş</label>
                <input
                  type="time"
                  value={form.end}
                  onChange={(e) => setForm((f) => ({ ...f, end: e.target.value.slice(0, 5) }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>
            </div>
            <div className="text-sm text-slate-500">
              Süre: <span className="font-semibold text-slate-700">{formDuration} saat</span>
            </div>
            <div className="flex gap-2 pt-1">
              <button type="submit" className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">
                {editingId ? "Güncelle" : "Ekle"}
              </button>
              {editingId && (
                <button type="button" onClick={reset} className="px-4 py-2 text-sm border border-slate-200 rounded-lg bg-white hover:bg-slate-50">
                  İptal
                </button>
              )}
            </div>
          </form>
        </div>

        {/* Mevcut Vardiyalar */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-slate-700">Mevcut Vardiyalar</div>
              <div className="text-xs text-slate-500 mt-1">{list?.length ?? 0} vardiya tanımı kayıtlı.</div>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full table-fixed text-sm">
              <colgroup>
                <col className="w-28" />
                <col className="w-28" />
                <col className="w-28" />
                <col className="w-28" />
                <col />
              </colgroup>
              <thead className="text-slate-500">
                <tr className="border-b border-slate-100">
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
                    <td colSpan={5} className="px-3 py-8 text-center text-slate-400">
                      Henüz kayıt yok.
                    </td>
                  </tr>
                )}
                {(list ?? []).map((r) => (
                  <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50/50">
                    <td className="px-3 py-2 font-medium">{r.code}</td>
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
                        <button onClick={() => edit(r)} className="px-2 py-1 text-xs border border-slate-200 rounded-lg bg-white hover:bg-slate-50">
                          Düzenle
                        </button>
                        <button onClick={() => del(r.id)} className="px-2 py-1 text-xs border border-red-200 rounded-lg text-red-600 hover:bg-red-50">
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
      </div>
    </div>
  );
}
