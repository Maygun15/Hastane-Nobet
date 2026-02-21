import React from "react";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from "lucide-react";
import useActiveYM from "../../hooks/useActiveYM";

const monthsTR = ["Ocak","Şubat","Mart","Nisan","Mayıs","Haziran","Temmuz","Ağustos","Eylül","Ekim","Kasım","Aralık"];

export default function ToolbarYM({
  title,
  leftExtras = null,
  rightExtras = null,
  sticky = false,
}) {
  const { ym, setYear, setMonth, gotoPrev, gotoNext, gotoToday } = useActiveYM();
  const { year, month } = ym;

  return (
    <div className={`${sticky ? "sticky top-0 z-30" : ""} flex items-center justify-between gap-2 p-2 rounded-2xl border bg-white`}>
      <div className="flex items-center gap-2 flex-wrap">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-gray-50 border">
          <CalendarIcon size={16} />
          <span className="font-semibold">{title || "Takvim"}</span>
        </div>

        <button onClick={gotoPrev} className="p-2 rounded-xl hover:bg-gray-100" title="Önceki Ay">
          <ChevronLeft size={18} />
        </button>

        <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-gray-50 border">
          <input
            type="number"
            className="w-20 outline-none bg-transparent"
            value={year}
            onChange={(e)=> setYear(parseInt(e.target.value || year, 10))}
          />
          <span>/</span>
          <select
            className="outline-none bg-transparent"
            value={month}
            onChange={(e)=> setMonth(parseInt(e.target.value, 10))}
          >
            {monthsTR.map((m, i)=>(
              <option key={m} value={i+1}>{m}</option>
            ))}
          </select>
        </div>

        <button onClick={gotoNext} className="p-2 rounded-xl hover:bg-gray-100" title="Sonraki Ay">
          <ChevronRight size={18} />
        </button>

        <button onClick={gotoToday} className="px-3 py-1.5 rounded-xl border hover:bg-gray-50">
          Bugün
        </button>

        {leftExtras}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {rightExtras}
      </div>
    </div>
  );
}
