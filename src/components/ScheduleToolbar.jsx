// src/components/ScheduleToolbar.jsx
import React from "react";
import {
  ChevronLeft,
  ChevronRight,
  Sparkles,
  RefreshCw,
  ListChecks,
  FileUp as ImportIcon,   // ← import için
  FileDown as ExportIcon, // ← export için
  Save as SaveIcon,
} from "lucide-react";

export default function ScheduleToolbar({
  title = "Çalışma Çizelgesi",
  year,
  month, // 1..12 beklenir
  setYear,
  setMonth,
  onAi,
  onBuild,
  onExport,
  onImport,
  onReset,
  onSave,
  saving = false,
}) {
  const safeYear = Number.isFinite(year) ? year : new Date().getFullYear();
  const monthIndex = Number.isFinite(month) ? Math.min(Math.max(Number(month) - 1, 0), 11) : 0;

  const prevMonth = () => {
    let y = safeYear;
    let idx = monthIndex - 1;
    if (idx < 0) {
      idx = 11;
      setYear?.(y - 1);
    }
    setMonth?.(idx + 1);
  };

  const nextMonth = () => {
    let y = safeYear;
    let idx = monthIndex + 1;
    if (idx > 11) {
      idx = 0;
      setYear?.(y + 1);
    }
    setMonth?.(idx + 1);
  };

  const MONTHS_TR = ["Ocak","Şubat","Mart","Nisan","Mayıs","Haziran","Temmuz","Ağustos","Eylül","Ekim","Kasım","Aralık"];

  return (
    <div className="w-full mb-3 rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 p-3">
        <h2 className="text-lg font-semibold text-slate-800">{title}</h2>

        <div className="flex items-center gap-2">
          <button onClick={prevMonth} className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50" title="Önceki Ay" type="button">
            <ChevronLeft className="w-4 h-4" />
          </button>

          <div className="min-w-[180px] text-center font-medium">
            {MONTHS_TR[monthIndex]} {safeYear}
          </div>

          <button onClick={nextMonth} className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50" title="Sonraki Ay" type="button">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onAi && (
            <button type="button" onClick={onAi} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700" title="Yapay Zeka">
              <Sparkles className="w-4 h-4" />
              Yapay Zeka
            </button>
          )}
          {onSave && (
            <button
              type="button"
              onClick={onSave}
              disabled={saving}
              className={`inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm ${
                saving ? "cursor-wait bg-slate-100 text-slate-500" : "hover:bg-slate-50"
              }`}
              title="Kaydet"
            >
              <SaveIcon className="w-4 h-4" />
              {saving ? "Kaydediliyor…" : "Kaydet"}
            </button>
          )}
          {onBuild && (
            <button type="button" onClick={onBuild} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50" title="Liste Oluştur">
              <ListChecks className="w-4 h-4" />
              Liste Oluştur
            </button>
          )}
          {onExport && (
            <button type="button" onClick={onExport} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50" title="Excel'e Aktar">
              <ExportIcon className="w-4 h-4" />
              Excel'e Aktar
            </button>
          )}
          {onImport && (
            <button type="button" onClick={onImport} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50" title="Excel'den Yükle">
              <ImportIcon className="w-4 h-4" />
              Excel'den Yükle
            </button>
          )}
          {onReset && (
            <button type="button" onClick={onReset} className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 hover:bg-rose-100" title="Sıfırla">
              <RefreshCw className="w-4 h-4" />
              Sıfırla
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
