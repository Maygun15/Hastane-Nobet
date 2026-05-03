// src/components/DayCard.jsx
import React from "react";
import { Plus, MoreVertical } from "lucide-react";

const dayNameTR = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];

export default function DayCard({
  dayNum,
  dateObj,
  leaveCode,
  assignments = [],
  isWeekend = false,
  requiredCount = 1,
  showCoverageStatus = true,
  isOutsideMonth = false,
  onAddShift,
  onRemoveShift,
  onEditShift,
  renderLeave,
  renderAssignments,
  hasConflict = false,
  conflictLeaveCode = "",
  holiday = null,
}) {
  const isCritical = showCoverageStatus && assignments.length < requiredCount;
  const dayOfWeek = dateObj?.getDay?.() ?? -1;
  const dow = dayOfWeek >= 0 ? dayNameTR[(dayOfWeek + 6) % 7] : "—";

  const isHoliday = !!holiday;
  const holidayKind = holiday?.kind || "";

  return (
    <div
      className={`relative min-h-[128px] rounded-xl border-2 p-2.5 flex flex-col transition-all ${
        isOutsideMonth
          ? "bg-slate-50/80 border-slate-200 text-slate-400"
          : hasConflict
          ? "bg-amber-50 border-amber-400 shadow-sm hover:border-amber-500"
          : isHoliday
          ? "bg-orange-50/70 border-orange-200 hover:border-orange-300 hover:shadow-sm"
          : isCritical
          ? "bg-white border-slate-200 shadow-sm hover:border-sky-300 hover:shadow-md"
          : isWeekend
          ? "bg-slate-50 border-slate-200 hover:border-sky-300 hover:shadow-sm"
          : "bg-white border-slate-200 hover:border-sky-300 hover:shadow-sm"
      }`}
    >
      {/* Başlık: Gün Numarası + Haftanın Günü */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-baseline gap-1.5">
          <span className={`text-base font-bold ${
            isOutsideMonth ? "text-slate-400" : isHoliday ? "text-orange-800" : "text-slate-800"
          }`}>
            {dayNum}
          </span>
          <span className={`text-xs uppercase font-medium ${isOutsideMonth ? "text-slate-300" : "text-slate-400"}`}>
            {dow}
          </span>
        </div>
        {!isOutsideMonth && isHoliday && (
          <span
            className={`text-[9px] font-semibold px-1 rounded ${
              holidayKind === "arife" ? "bg-amber-100 text-amber-700" :
              holidayKind === "half" ? "bg-yellow-100 text-yellow-700" :
              "bg-orange-100 text-orange-700"
            }`}
            title={holiday?.name || "Tatil"}
          >
            {holidayKind === "arife" ? "ARİFE" : holidayKind === "half" ? "YARI" : "TATİL"}
          </span>
        )}
      </div>

      {/* Tatil adı */}
      {!isOutsideMonth && isHoliday && holiday?.name && (
        <div className="text-[9px] text-orange-700 leading-tight mb-1 truncate" title={holiday.name}>
          {holiday.name}
        </div>
      )}

      {/* Çakışma uyarısı: aynı gün izin + vardiya */}
      {!isOutsideMonth && hasConflict && conflictLeaveCode && (
        <div className="mb-1 rounded bg-amber-100 border border-amber-400 px-1.5 py-0.5 text-[10px] text-amber-800 font-medium flex items-center gap-1">
          <span>⚠️</span>
          <span>İzin ({conflictLeaveCode}) + Vardiya</span>
        </div>
      )}

      {/* İzin */}
      {!isOutsideMonth && leaveCode && !hasConflict && (
        <div className="mb-1">
          {renderLeave?.(leaveCode) || (
            <div className="rounded bg-rose-100 border border-rose-300 px-1.5 py-0.5 text-[10px] text-rose-700 font-medium">
              📌 {leaveCode}
            </div>
          )}
        </div>
      )}

      {/* Nöbetler Listesi */}
      <div className="flex-1 overflow-y-auto min-h-0 mb-1.5">
        {assignments.length > 0 ? (
          <div className="space-y-0.5">
            {renderAssignments?.(assignments) || (
              assignments.map((assg, idx) => (
                <div
                  key={assg.id ?? `${assg.shiftCode || ""}-${assg.roleLabel || ""}-${idx}`}
                  className="rounded bg-blue-50 border border-blue-200 px-1.5 py-0.5 text-[10px] text-blue-700 font-medium flex items-center justify-between group hover:bg-blue-100"
                >
                  <span>{assg.shiftCode || "—"}</span>
                  {onRemoveShift && (
                    <button
                      onClick={() => onRemoveShift(assg)}
                      className="opacity-0 group-hover:opacity-100 text-blue-500 hover:text-red-600 transition-opacity"
                      title="Sil"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        ) : leaveCode ? null : (
          <div className="text-[10px] text-slate-300 text-center py-1.5">—</div>
        )}
      </div>

      {/* Aksiyon Butonları */}
      {!isOutsideMonth && !leaveCode && (
        <div className="flex items-center gap-1 pt-1 border-t border-slate-100">
          {onAddShift && (
            <button
              onClick={onAddShift}
              className="flex-1 inline-flex items-center justify-center gap-1 px-3 py-2 rounded-lg bg-sky-100 hover:bg-sky-200 text-sky-700 text-xs font-medium transition-colors min-h-[36px]"
              title="Nöbet ekle"
            >
              <Plus className="w-3 h-3" />
              Nöbet
            </button>
          )}
          {onEditShift && (
            <button
              onClick={onEditShift}
              className="px-2 py-2 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center"
              title="İşlemler"
            >
              <MoreVertical className="w-3 h-3" />
            </button>
          )}
        </div>
      )}

      {/* Kritik Uyarı */}
      {!isOutsideMonth && isCritical && !hasConflict && (
        <div className="absolute top-1 right-1 w-2 h-2 bg-amber-400 rounded-full animate-pulse" />
      )}

      {/* Çakışma İkonu */}
      {!isOutsideMonth && hasConflict && (
        <div className="absolute top-1 right-1 w-4 h-4 bg-amber-500 rounded-full flex items-center justify-center text-white text-[8px] font-bold animate-pulse" title="İzin ve vardiya çakışması">
          !
        </div>
      )}
    </div>
  );
}
