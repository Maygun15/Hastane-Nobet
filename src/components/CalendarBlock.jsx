import React, { useMemo } from "react";
import { weekDaysTR } from "../constants/enums.js";
import { buildMonthDays } from "../utils/date.js";
import { cn } from "../utils/classnames.js";

export default function CalendarBlock({ month, year }) {
  const { cells } = useMemo(() => buildMonthDays(year, month), [year, month]);
  return (
    <div className="bg-white rounded-2xl shadow-sm p-4">
      <div className="grid grid-cols-7 text-xs font-medium text-slate-500 px-1">
        {weekDaysTR.map((d) => (
          <div key={d} className="px-2 py-1">
            {d}
          </div>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-7 gap-2">
        {cells.map((dt, idx) => (
          <div
            key={idx}
            className={cn(
              "relative min-h-[90px] rounded-xl border bg-slate-50/40",
              dt ? "border-slate-200" : "border-transparent opacity-40"
            )}
          >
            {dt && <div className="absolute top-1 right-1 text-xs text-slate-500">{dt.getDate()}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
