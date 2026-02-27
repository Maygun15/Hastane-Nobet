// src/components/DayCard.jsx
import React from "react";
import { AlertCircle, Plus, MoreVertical } from "lucide-react";

const dayNameTR = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];

export default function DayCard({
  dayNum,
  dateObj,
  leaveCode,
  assignments = [],
  isWeekend = false,
  requiredCount = 1,
  onAddShift,
  onRemoveShift,
  onEditShift,
  renderLeave,
  renderAssignments,
}) {
  const isCritical = assignments.length < requiredCount;
  const dayOfWeek = dateObj?.getDay?.() ?? -1;
  const dow = dayOfWeek >= 0 ? dayNameTR[(dayOfWeek + 6) % 7] : "—";

  return (
    <div
      className={`relative h-32 rounded-xl border-2 p-2.5 flex flex-col transition-all ${
        isCritical
          ? "bg-white border-slate-200 shadow-sm"
          : isWeekend
          ? "bg-slate-50 border-slate-200"
          : "bg-white border-slate-200 hover:border-sky-300 hover:shadow-sm"
      }`}
    >
      {/* Başlık: Gün Numarası + Haftanın Günü */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-baseline gap-1.5">
          <span className="text-base font-bold text-slate-800">{dayNum}</span>
          <span className="text-xs text-slate-400 uppercase font-medium">{dow}</span>
        </div>
        
        {/* Nöbet Sayısı Badge */}
        <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${
          isCritical
            ? "bg-red-200 text-red-700"
            : assignments.length >= requiredCount
            ? "bg-emerald-100 text-emerald-700"
            : "bg-amber-100 text-amber-700"
        }`}>
          <span className="text-[10px]">
            {assignments.length}/{requiredCount}
          </span>
          {isCritical && <AlertCircle className="w-3 h-3" />}
        </div>
      </div>

      {/* İzin */}
      {leaveCode && (
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
                  key={idx}
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
      {!leaveCode && (
        <div className="flex items-center gap-1 pt-1 border-t border-slate-100">
          {onAddShift && (
            <button
              onClick={onAddShift}
              className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1 rounded-lg bg-sky-100 hover:bg-sky-200 text-sky-700 text-xs font-medium transition-colors"
              title="Nöbet ekle"
            >
              <Plus className="w-3 h-3" />
              Nöbet
            </button>
          )}
          {onEditShift && (
            <button
              onClick={onEditShift}
              className="px-1.5 py-1 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors"
              title="İşlemler"
            >
              <MoreVertical className="w-3 h-3" />
            </button>
          )}
        </div>
      )}

      {/* Kritik Uyarı */}
      {isCritical && (
        <div className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full animate-pulse" />
      )}
    </div>
  );
}
