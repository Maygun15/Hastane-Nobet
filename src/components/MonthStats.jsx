// src/components/MonthStats.jsx
import React, { useMemo } from "react";
import { AlertTriangle, CheckCircle, Clock, TrendingDown, TrendingUp } from "lucide-react";
import { shiftDurationHours } from "../utils/date.js";

function formatHours(val) {
  if (!Number.isFinite(val)) return "0";
  return val % 1 === 0 ? String(val) : val.toFixed(1);
}

export default function MonthStats({
  year,
  month,
  cells = [],
  assignments = {},
  requiredPerDay = 1,
  onlyMissingDays = false,
  workingHours = [],
  overtimeStats = null,
}) {
  const stats = useMemo(() => {
    if (!Array.isArray(cells)) return null;

    const workingHoursMap = new Map();
    (Array.isArray(workingHours) ? workingHours : []).forEach((item) => {
      if (!item) return;
      const codeRaw = item.code ?? item.id ?? item.shiftCode ?? "";
      const code = String(codeRaw).trim();
      if (!code) return;
      const start = String(item.start ?? "").trim();
      const end = String(item.end ?? "").trim();
      const labelRaw = String(item.label ?? item.name ?? "").trim();
      const hours = start && end ? shiftDurationHours(start, end) : null;
      workingHoursMap.set(code.toUpperCase(), { code, label: labelRaw || code, hours });
    });

    const daysWithDates = cells.filter((dt) => dt instanceof Date);
    const totalDays = daysWithDates.length;

    let filledDays = 0;
    let missingDays = 0;
    let criticalDays = [];
    let totalShifts = 0;
    let totalHours = 0;
    const shiftStatsMap = new Map();

    daysWithDates.forEach((dt) => {
      const dayNum = dt.getDate();
      const assignmentList = assignments.get?.(dayNum) || [];
      const count = assignmentList.length || 0;
      totalShifts += count;

      for (const assg of assignmentList) {
        const shiftRaw = assg?.shiftCode ?? assg?.shiftId ?? assg?.shift ?? assg?.code ?? "";
        const shiftCode = String(shiftRaw || "").trim();
        const shiftKey = shiftCode ? shiftCode.toUpperCase() : "__UNKNOWN__";
        const wh = shiftKey === "__UNKNOWN__" ? null : workingHoursMap.get(shiftKey);
        const label = shiftKey === "__UNKNOWN__" ? "Bilinmiyor" : wh?.label || shiftCode || "Bilinmiyor";
        const hours = Number.isFinite(wh?.hours) ? wh.hours : 0;

        totalHours += hours;
        const existing = shiftStatsMap.get(shiftKey) || { key: shiftKey, label, count: 0, hours: 0 };
        existing.count += 1;
        existing.hours = Math.round((existing.hours + hours) * 100) / 100;
        shiftStatsMap.set(shiftKey, existing);
      }

      if (count >= requiredPerDay) filledDays++;
      else {
        missingDays++;
        criticalDays.push({ day: dayNum, needed: requiredPerDay - count });
      }
    });

    const fillPercentage = totalDays > 0 ? Math.round((filledDays / totalDays) * 100) : 0;
    const shiftStats = Array.from(shiftStatsMap.values()).sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return String(a.label).localeCompare(String(b.label), "tr", { sensitivity: "base" });
    });

    return {
      totalDays, filledDays, missingDays, criticalDays,
      totalShifts,
      totalHours: Math.round(totalHours * 100) / 100,
      shiftStats, fillPercentage,
    };
  }, [cells, assignments, requiredPerDay, workingHours]);

  if (!stats) {
    return (
      <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-3 text-sm text-slate-500">
        İstatistik yükleniyor...
      </div>
    );
  }

  const isCritical = stats.missingDays > 0;

  const ot = overtimeStats?.overtime ?? null;
  const requiredBase = overtimeStats?.requiredBase ?? null;
  const leaveCredit = overtimeStats?.leaveCredit ?? null;
  const requiredFinal = overtimeStats?.requiredFinal ?? null;
  const workedHours = Number.isFinite(overtimeStats?.worked) ? overtimeStats.worked : stats.totalHours;
  const otColor = ot === null ? "text-slate-400" : ot > 0 ? "text-emerald-700" : ot < 0 ? "text-red-600" : "text-slate-600";
  const otSign = ot === null ? "" : ot > 0 ? "+" : "";
  const OtIcon = ot !== null && ot >= 0 ? TrendingUp : TrendingDown;

  return (
    <div className={`rounded-xl border-2 p-4 ${isCritical ? "bg-red-50 border-red-200" : "bg-emerald-50 border-emerald-200"}`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-slate-800 flex items-center gap-2">
          {isCritical ? (
            <><AlertTriangle className="w-4 h-4 text-red-600" /><span className="text-red-700">Ayın Özeti - Uyarı</span></>
          ) : (
            <><CheckCircle className="w-4 h-4 text-emerald-600" /><span className="text-emerald-700">Ayın Özeti</span></>
          )}
        </h3>
        <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-white border border-slate-200 text-slate-600">
          {stats.fillPercentage}% tamamlanmış
        </span>
      </div>

      <div className="mb-4">
        <div className="h-2 bg-white rounded-full overflow-hidden border border-slate-200">
          <div className={`h-full transition-all ${isCritical ? "bg-red-500" : "bg-emerald-500"}`}
            style={{ width: `${stats.fillPercentage}%` }} />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="rounded-lg bg-white/60 p-3 border border-sky-100">
          <div className="text-xs text-slate-500 font-medium mb-1">Toplam Nöbet</div>
          <div className="text-2xl font-bold text-sky-700">{stats.totalShifts}</div>
        </div>

        <div className="rounded-lg bg-white/60 p-3 border border-amber-100">
          <div className="text-xs text-slate-500 font-medium mb-1">Aylık Gereken</div>
          <div className="text-2xl font-bold text-amber-700">
            {requiredBase !== null ? formatHours(requiredBase) : "—"}
            {requiredBase !== null && <span className="text-xs text-slate-400 ml-1 font-normal">s</span>}
          </div>
        </div>

        <div className="rounded-lg bg-white/60 p-3 border border-rose-100">
          <div className="text-xs text-slate-500 font-medium mb-1">İzin (ÇS)</div>
          <div className="text-2xl font-bold text-rose-600">
            {leaveCredit !== null ? formatHours(leaveCredit) : "—"}
            {leaveCredit !== null && <span className="text-xs text-slate-400 ml-1 font-normal">s</span>}
          </div>
        </div>

        <div className="rounded-lg bg-white/60 p-3 border border-indigo-100">
          <div className="text-xs text-slate-500 font-medium mb-1 flex items-center gap-1">
            <Clock className="w-3 h-3" />Kişinin Gerekeni
          </div>
          <div className="text-2xl font-bold text-indigo-700">
            {requiredFinal !== null ? formatHours(requiredFinal) : "—"}
            {requiredFinal !== null && <span className="text-xs text-slate-400 ml-1 font-normal">s</span>}
          </div>
        </div>

        <div className="rounded-lg bg-white/60 p-3 border border-emerald-100">
          <div className="text-xs text-slate-500 font-medium mb-1">Çalıştığı Toplam</div>
          <div className="text-2xl font-bold text-emerald-700">
            {formatHours(workedHours)}
            <span className="text-xs text-slate-400 ml-1 font-normal">s</span>
          </div>
        </div>

        <div className="rounded-lg bg-white/60 p-3 border border-slate-100">
          <div className="text-xs text-slate-500 font-medium mb-1 flex items-center gap-1">
            <OtIcon className="w-3 h-3" />
            {ot !== null && ot < 0 ? "Eksik Mesai" : "Fazla Mesai"}
          </div>
          <div className={`text-2xl font-bold ${otColor}`}>
            {ot !== null ? `${otSign}${formatHours(Math.abs(ot))}` : "—"}
            {ot !== null && <span className="text-xs text-slate-400 ml-1 font-normal">s</span>}
          </div>
        </div>
      </div>

      {stats.shiftStats.length > 0 && (
        <div className="mt-4 pt-4 border-t border-slate-200">
          <div className="text-xs font-semibold text-slate-600 mb-2">Vardiya Dağılımı</div>
          <div className="flex flex-wrap gap-2">
            {stats.shiftStats.map((item) => (
              <span key={item.key}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 text-xs font-medium">
                {item.label}
                <span className="text-[10px] opacity-70">
                  ({item.count} nöbet{item.hours ? `, ${formatHours(item.hours)}s` : ""})
                </span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
