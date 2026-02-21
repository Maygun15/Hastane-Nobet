// src/lib/monthUtils.js
import { useMemo } from "react";

export const monthsTR = [
  "Ocak","Şubat","Mart","Nisan","Mayıs","Haziran",
  "Temmuz","Ağustos","Eylül","Ekim","Kasım","Aralık"
];

export const pad2  = (n) => String(n).padStart(2, "0");
export const ymKey = (year, month1) => `${year}-${pad2(month1)}`; // month1: 1..12

// 1..12 -> 0..11
export const toZeroBased = (m1) => Math.max(0, Math.min(11, Number(m1) - 1));

export function buildMonthDaysLocal(year, month1) {
  const m0 = toZeroBased(month1);
  const first = new Date(year, m0, 1);
  const next  = new Date(year, m0 + 1, 1);
  const days = [];
  for (let d = new Date(first); d < next; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    const day = d.getDate();
    const dow = d.getDay(); // 0=Pa,6=Cts
    days.push({
      ymd: `${year}-${pad2(m0 + 1)}-${pad2(day)}`,
      d: day,
      isWeekend: dow === 0 || dow === 6,
    });
  }
  return days;
}

export function useMonthDays(year, month1) {
  return useMemo(() => buildMonthDaysLocal(year, month1), [year, month1]);
}
