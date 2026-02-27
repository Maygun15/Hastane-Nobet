// src/components/MonthStats.jsx
import React, { useMemo } from "react";
import { AlertTriangle, CheckCircle, TrendingUp } from "lucide-react";

export default function MonthStats({
  year,
  month,
  cells = [],
  assignments = {},
  requiredPerDay = 1,
  onlyMissingDays = false,
}) {
  const stats = useMemo(() => {
    if (!Array.isArray(cells)) return null;

    const daysWithDates = cells.filter((dt) => dt instanceof Date);
    const totalDays = daysWithDates.length;

    let filledDays = 0;
    let missingDays = 0;
    let criticalDays = [];
    let totalShifts = 0;

    daysWithDates.forEach((dt) => {
      const dayNum = dt.getDate();
      const assignmentList = assignments.get?.(dayNum) || [];
      const count = assignmentList.length || 0;

      totalShifts += count;

      if (count >= requiredPerDay) {
        filledDays++;
      } else {
        missingDays++;
        criticalDays.push({
          day: dayNum,
          needed: requiredPerDay - count,
        });
      }
    });

    const avgShiftsPerDay = totalDays > 0 ? (totalShifts / totalDays).toFixed(1) : 0;
    const fillPercentage = totalDays > 0 ? Math.round((filledDays / totalDays) * 100) : 0;

    return {
      totalDays,
      filledDays,
      missingDays,
      criticalDays,
      totalShifts,
      avgShiftsPerDay,
      fillPercentage,
    };
  }, [cells, assignments, requiredPerDay]);

  if (!stats) {
    return (
      <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-3 text-sm text-slate-500">
        İstatistik yükleniyor...
      </div>
    );
  }

  const isCritical = stats.missingDays > 0;

  return (
    <div
      className={`rounded-xl border-2 p-4 ${
        isCritical
          ? "bg-red-50 border-red-200"
          : "bg-emerald-50 border-emerald-200"
      }`}
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-slate-800 flex items-center gap-2">
          {isCritical ? (
            <>
              <AlertTriangle className="w-4 h-4 text-red-600" />
              <span className="text-red-700">Ayın Özeti - Uyarı</span>
            </>
          ) : (
            <>
              <CheckCircle className="w-4 h-4 text-emerald-600" />
              <span className="text-emerald-700">Ayın Özeti</span>
            </>
          )}
        </h3>
        <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-white border border-slate-200 text-slate-600">
          {stats.fillPercentage}% tamamlanmış
        </span>
      </div>

      {/* İlerleme Çubuğu */}
      <div className="mb-4">
        <div className="h-2 bg-white rounded-full overflow-hidden border border-slate-200">
          <div
            className={`h-full transition-all ${
              isCritical ? "bg-red-500" : "bg-emerald-500"
            }`}
            style={{ width: `${stats.fillPercentage}%` }}
          />
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {/* Doldurulmuş Günler */}
        <div className="rounded-lg bg-white/60 p-3 border border-emerald-100">
          <div className="text-xs text-slate-500 font-medium mb-1">Doldurulmuş</div>
          <div className="text-2xl font-bold text-emerald-700">
            {stats.filledDays}
            <span className="text-xs text-slate-400 ml-1 font-normal">/ {stats.totalDays}</span>
          </div>
        </div>

        {/* Eksik Günler */}
        <div className={`rounded-lg p-3 border ${
          isCritical
            ? "bg-white/60 border-red-100"
            : "bg-white/60 border-slate-100"
        }`}>
          <div className="text-xs text-slate-500 font-medium mb-1">Eksik</div>
          <div className={`text-2xl font-bold ${
            isCritical ? "text-red-700" : "text-slate-400"
          }`}>
            {stats.missingDays}
            {isCritical && <span className="text-sm ml-1">⚠️</span>}
          </div>
        </div>

        {/* Toplam Nöbet */}
        <div className="rounded-lg bg-white/60 p-3 border border-sky-100">
          <div className="text-xs text-slate-500 font-medium mb-1">Toplam Nöbet</div>
          <div className="text-2xl font-bold text-sky-700">{stats.totalShifts}</div>
        </div>

        {/* Ortalama Nöbet/Gün */}
        <div className="rounded-lg bg-white/60 p-3 border border-purple-100">
          <div className="text-xs text-slate-500 font-medium mb-1">
            <TrendingUp className="w-3 h-3 inline mr-1" />
            Ort. Nöbet
          </div>
          <div className="text-2xl font-bold text-purple-700">{stats.avgShiftsPerDay}</div>
        </div>
      </div>

      {/* Kritik Günler Listesi */}
      {isCritical && stats.criticalDays.length > 0 && (
        <div className="mt-4 pt-4 border-t border-red-200">
          <div className="text-xs font-semibold text-red-700 mb-2">
            🔴 {stats.criticalDays.length} gün eksik nöbet var:
          </div>
          <div className="flex flex-wrap gap-2">
            {stats.criticalDays.slice(0, 10).map((item) => (
              <span
                key={item.day}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-red-100 text-red-700 text-xs font-medium"
              >
                {item.day}. gün
                <span className="text-[10px] opacity-75">({item.needed} eksik)</span>
              </span>
            ))}
            {stats.criticalDays.length > 10 && (
              <span className="text-xs text-red-600">
                +{stats.criticalDays.length - 10} daha...
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
