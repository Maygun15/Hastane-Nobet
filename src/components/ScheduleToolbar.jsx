// src/components/ScheduleToolbar.jsx
import React from "react";
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  RefreshCw,
  ListChecks,
  FileUp as ImportIcon,   // ← import için
  FileDown as ExportIcon, // ← export için
  Save as SaveIcon,
  Printer,
  Mail,
  Maximize,
  Minimize,
  User,
} from "lucide-react";

export default function ScheduleToolbar({
  title = "Çalışma Çizelgesi",
  year,
  month, // 1..12 beklenir
  setYear,
  setMonth,
  onToday,
  onAi,
  onBuild,
  onExport,
  onImport,
  onReset,
  onPrint,
  onEmail,
  onSave,
  onFullscreen,
  isFullscreen = false,
  saving = false,
  role,
  onRoleChange,
  onToggleMyShifts,
  onlyMyShifts,
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
      <div className="flex flex-wrap items-center justify-between gap-2 p-2 md:p-3">
        <h2 className="text-base md:text-lg font-semibold text-slate-800 truncate max-w-[200px] md:max-w-none">{title}</h2>

        <div className="flex items-center gap-1 md:gap-2">
          <button onClick={prevMonth} className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-2 py-1.5 md:px-3 md:py-2 text-xs md:text-sm hover:bg-slate-50" title="Önceki Ay" type="button">
            <ChevronLeft className="w-3 h-3 md:w-4 md:h-4" />
          </button>

          {onToday && (
            <button onClick={onToday} className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-2 py-1.5 md:px-3 md:py-2 text-xs md:text-sm hover:bg-slate-50" title="Bugüne Git" type="button">
              <Calendar className="w-3 h-3 md:w-4 md:h-4" />
              <span className="hidden sm:inline">Bugün</span>
            </button>
          )}

          <div className="min-w-[120px] md:min-w-[180px] text-center font-medium text-sm md:text-base">
            {MONTHS_TR[monthIndex]} {safeYear}
          </div>

          <button onClick={nextMonth} className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-2 py-1.5 md:px-3 md:py-2 text-xs md:text-sm hover:bg-slate-50" title="Sonraki Ay" type="button">
            <ChevronRight className="w-3 h-3 md:w-4 md:h-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1 md:gap-2">
          {/* Rol Seçici */}
          {role && onRoleChange && (
            <div className="flex bg-slate-100 p-1 rounded-xl mr-1 md:mr-2 border border-slate-200">
              <button
                type="button"
                onClick={() => onRoleChange("Nurse")}
                className={`px-2 py-1 md:px-3 md:py-1.5 text-[10px] md:text-xs font-medium rounded-lg transition-all ${
                  role === "Nurse" || role === "Hemşire" ? "bg-white text-sky-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                Hemşire
              </button>
              <button
                type="button"
                onClick={() => onRoleChange("Doctor")}
                className={`px-2 py-1 md:px-3 md:py-1.5 text-[10px] md:text-xs font-medium rounded-lg transition-all ${
                  role === "Doctor" || role === "Doktor" ? "bg-white text-sky-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                Doktor
              </button>
            </div>
          )}

          {onToggleMyShifts && (
            <button
              type="button"
              onClick={() => onToggleMyShifts(!onlyMyShifts)}
              className={`inline-flex items-center gap-1 md:gap-2 rounded-xl border px-2 py-1.5 md:px-3 md:py-2 text-xs md:text-sm transition-colors ${
                onlyMyShifts ? "bg-sky-100 border-sky-200 text-sky-700" : "border-slate-200 hover:bg-slate-50 text-slate-700"
              }`}
              title="Sadece Benim Nöbetlerim"
            >
              <User className="w-3 h-3 md:w-4 md:h-4" />
              <span className="hidden sm:inline">Sadece Ben</span>
            </button>
          )}

          {onAi && (
            <button type="button" onClick={onAi} className="inline-flex items-center gap-1 md:gap-2 rounded-xl bg-indigo-600 px-2 py-1.5 md:px-3 md:py-2 text-xs md:text-sm font-medium text-white hover:bg-indigo-700" title="Yapay Zeka">
              <Sparkles className="w-3 h-3 md:w-4 md:h-4" />
              <span className="hidden sm:inline">Yapay Zeka</span>
            </button>
          )}
          {onPrint && (
            <button type="button" onClick={onPrint} className="inline-flex items-center gap-1 md:gap-2 rounded-xl border border-slate-200 px-2 py-1.5 md:px-3 md:py-2 text-xs md:text-sm hover:bg-slate-50" title="Yazdır">
              <Printer className="w-3 h-3 md:w-4 md:h-4" />
              <span className="hidden sm:inline">Yazdır</span>
            </button>
          )}
          {onEmail && (
            <button type="button" onClick={onEmail} className="inline-flex items-center gap-1 md:gap-2 rounded-xl border border-slate-200 px-2 py-1.5 md:px-3 md:py-2 text-xs md:text-sm hover:bg-slate-50" title="E-posta Gönder">
              <Mail className="w-3 h-3 md:w-4 md:h-4" />
              <span className="hidden sm:inline">E-posta</span>
            </button>
          )}
          {onFullscreen && (
            <button type="button" onClick={onFullscreen} className="inline-flex items-center gap-1 md:gap-2 rounded-xl border border-slate-200 px-2 py-1.5 md:px-3 md:py-2 text-xs md:text-sm hover:bg-slate-50" title={isFullscreen ? "Tam Ekrandan Çık" : "Tam Ekran"}>
              {isFullscreen ? <Minimize className="w-3 h-3 md:w-4 md:h-4" /> : <Maximize className="w-3 h-3 md:w-4 md:h-4" />}
              <span className="hidden sm:inline">{isFullscreen ? "Küçült" : "Tam Ekran"}</span>
            </button>
          )}
          {onSave && (
            <button
              type="button"
              onClick={onSave}
              disabled={saving}
              className={`inline-flex items-center gap-1 md:gap-2 rounded-xl border border-slate-200 px-2 py-1.5 md:px-3 md:py-2 text-xs md:text-sm ${
                saving ? "cursor-wait bg-slate-100 text-slate-500" : "hover:bg-slate-50"
              }`}
              title="Kaydet"
            >
              <SaveIcon className="w-3 h-3 md:w-4 md:h-4" />
              <span className="hidden sm:inline">{saving ? "Kaydediliyor…" : "Kaydet"}</span>
            </button>
          )}
          {onBuild && (
            <button type="button" onClick={onBuild} className="inline-flex items-center gap-1 md:gap-2 rounded-xl border border-slate-200 px-2 py-1.5 md:px-3 md:py-2 text-xs md:text-sm hover:bg-slate-50" title="Liste Oluştur">
              <ListChecks className="w-3 h-3 md:w-4 md:h-4" />
              <span className="hidden sm:inline">Liste Oluştur</span>
            </button>
          )}
          {onExport && (
            <button type="button" onClick={onExport} className="inline-flex items-center gap-1 md:gap-2 rounded-xl border border-slate-200 px-2 py-1.5 md:px-3 md:py-2 text-xs md:text-sm hover:bg-slate-50" title="Excel'e Aktar">
              <ExportIcon className="w-3 h-3 md:w-4 md:h-4" />
              <span className="hidden sm:inline">Excel'e Aktar</span>
            </button>
          )}
          {onImport && (
            <button type="button" onClick={onImport} className="inline-flex items-center gap-1 md:gap-2 rounded-xl border border-slate-200 px-2 py-1.5 md:px-3 md:py-2 text-xs md:text-sm hover:bg-slate-50" title="Excel'den Yükle">
              <ImportIcon className="w-3 h-3 md:w-4 md:h-4" />
              <span className="hidden sm:inline">Excel'den Yükle</span>
            </button>
          )}
          {onReset && (
            <button type="button" onClick={onReset} className="inline-flex items-center gap-1 md:gap-2 rounded-xl border border-rose-200 bg-rose-50 px-2 py-1.5 md:px-3 md:py-2 text-xs md:text-sm text-rose-700 hover:bg-rose-100" title="Sıfırla">
              <RefreshCw className="w-3 h-3 md:w-4 md:h-4" />
              <span className="hidden sm:inline">Sıfırla</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
