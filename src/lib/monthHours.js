// src/lib/monthHours.js
/**
 * Aylık çalışma saatini hesaplar (memur mantığı: 40s/hafta ≈ 8s/gün).
 * - Hafta sonları: çalışılmaz
 * - Resmî tatil (full): 0 saat
 * - Resmî tatil (half/arife): günlük saatin yarısı
 * - İdarî izin (full/half): çalışılmış sayılır (full = günlük saat, half = yarım)
 *
 * @param {object} p
 * @param {number} p.year            - Örn: 2025
 * @param {number} p.month           - 1..12
 * @param {number} [p.dailyHours=8]  - Kuruma göre 7.5/8 gibi
 * @param {Array<{date:string,type:'full'|'half',kind:'official'|'admin'}>} [p.holidays=[]]
 * @param {Set<number>} [p.weekendDays=new Set([0,6])]  // 0=Sun,6=Sat (JS Date.getDay)
 *
 * @returns {{
 *   totalHours: number,
 *   fullWorkDays: number,
 *   halfWorkDays: number,
 *   businessDaysCount: number, // (tam+yarım) işgünü adedi
 *   details: Array<{date:string, hours:number, tag:string}>
 * }}
 */
export function monthlyWorkingHours({
  year,
  month,
  dailyHours = 8,
  holidays = [],
  weekendDays = new Set([0, 6]),
}) {
  const half = dailyHours / 2;
  const last = new Date(year, month, 0).getDate(); // month: 1..12
  const hmap = new Map(holidays.map(h => [h.date, h]));

  let totalHours = 0;
  let fullWorkDays = 0;
  let halfWorkDays = 0;
  const details = [];

  for (let d = 1; d <= last; d++) {
    const dt = new Date(year, month - 1, d);
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const dd = String(d).padStart(2, "0");
    const ymd = `${y}-${m}-${dd}`;
    const dow = dt.getDay(); // 0=Sun..6=Sat

    // Hafta sonu -> çalışılmaz
    if (weekendDays.has(dow)) {
      details.push({ date: ymd, hours: 0, tag: "weekend" });
      continue;
    }

    // Tatil/izin kontrolü
    const h = hmap.get(ymd);
    if (h) {
      if (h.kind === "official") {
        if (h.type === "full") {
          details.push({ date: ymd, hours: 0, tag: "official-full" });
          continue;
        } else {
          totalHours += half;
          halfWorkDays += 1;
          details.push({ date: ymd, hours: half, tag: "official-half" });
          continue;
        }
      }
      if (h.kind === "admin") {
        if (h.type === "full") {
          totalHours += dailyHours;
          fullWorkDays += 1;
          details.push({ date: ymd, hours: dailyHours, tag: "admin-full" });
          continue;
        } else {
          totalHours += half;
          halfWorkDays += 1;
          details.push({ date: ymd, hours: half, tag: "admin-half" });
          continue;
        }
      }
    }

    // Normal iş günü
    totalHours += dailyHours;
    fullWorkDays += 1;
    details.push({ date: ymd, hours: dailyHours, tag: "workday" });
  }

  return {
    totalHours,
    fullWorkDays,
    halfWorkDays,
    businessDaysCount: fullWorkDays + halfWorkDays,
    details,
  };
}

/** YYYY-MM filtresi (opsiyonel) */
export function filterHolidaysForYM(holidays, year, month) {
  const ym = `${year}-${String(month).padStart(2, "0")}`;
  return (holidays || []).filter(h => (h.date || "").startsWith(ym));
}
