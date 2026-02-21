/* src/utils/overtime.js
   Fazla mesai hesabı için çekirdek yardımcılar.

   Kurallar:
   - Zorunlu saat = (o ayın resmî ÇALIŞMA günleri) için saatlerin toplamı.
     * Normal işgünü: 8 saat
     * Arife işgünü:  4 saat
     * Hafta sonu (Cumartesi/Pazar) ve Resmî Tatil: 0 saat
   - “Çalışılmış sayılan izin” saatleri zorunlu saatten DÜŞÜLÜR.
   - Fiilî çalışma, vardiya saatlerinden hesaplanır.
   - Fazla mesai = Fiilî çalışma − (Zorunlu saat − Çalışılmış sayılan izin kredisi)
*/

const WEEKEND_SET = new Set([0, 6]); // 0=Sunday, 6=Saturday

/** Ayın gün sayısı (month: 1..12) */
export function daysInMonth(year, month1to12) {
  return new Date(year, month1to12, 0).getDate();
}

/**
 * Ay ızgarası üretir.
 * @returns {Array<{d:number,date:Date,ymd:string,isWeekend:boolean,isOfficialHoliday:boolean,isWorkday:boolean}>}
 */
export function buildMonthGrid(year, month1to12, officialHolidaysYmd = new Set()) {
  const total = daysInMonth(year, month1to12);
  const out = [];
  for (let d = 1; d <= total; d++) {
    const date = new Date(year, month1to12 - 1, d);
    const dow = date.getDay(); // 0..6 (0=Sun)
    const ymd = `${year}-${String(month1to12).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const isWeekend = WEEKEND_SET.has(dow);
    const isOfficialHoliday = officialHolidaysYmd.has(ymd);
    const isWorkday = !isWeekend && !isOfficialHoliday;
    out.push({ d, date, ymd, isWeekend, isOfficialHoliday, isWorkday });
  }
  return out;
}

/**
 * Zorunlu saat (taban) hesaplar.
 * - İşgünü 8 saat, arife işgünü 4 saat sayılır.
 * - Hafta sonu ve resmî tatiller 0 saat.
 *
 * @param {number} year
 * @param {number} month1to12
 * @param {Set<string>} officialHolidaysYmd  - "YYYY-MM-DD"
 * @param {Set<string>} arifeDaysYmd         - "YYYY-MM-DD"
 * @returns {number} hours
 */
export function requiredHoursBase(year, month1to12, officialHolidaysYmd = new Set(), arifeDaysYmd = new Set()) {
  const grid = buildMonthGrid(year, month1to12, officialHolidaysYmd);
  let hours = 0;
  for (const g of grid) {
    if (!g.isWorkday) continue;                 // hafta sonu / resmi tatil -> 0
    const isArife = arifeDaysYmd.has(g.ymd);    // sadece işgünü ise arife 4 saat
    hours += isArife ? 4 : 8;
  }
  return hours;
}

/**
 * Çalışılmış sayılan izinlerin sağladığı kredi (saat).
 * personLeavesByDay: { [day:number]: string | {code:string} }
 * leaveRules: { [code]: { countsAsWorked:boolean, hoursPerDay?:number } }
 */
export function workedLikeLeaveHours(year, month1to12, personLeavesByDay = {}, leaveRules = {}) {
  let sum = 0;
  const total = daysInMonth(year, month1to12);
  for (let d = 1; d <= total; d++) {
    const rec = personLeavesByDay[d];
    if (!rec) continue;
    const code = typeof rec === "string" ? rec : rec.code;
    if (!code) continue;
    const rule = leaveRules[code];
    if (rule && rule.countsAsWorked) {
      sum += Number.isFinite(rule.hoursPerDay) ? rule.hoursPerDay : 8; // varsayılan 8s
    }
  }
  return sum;
}

/**
 * Fiilî çalışma saatleri (vardiya kodlarından).
 * personShiftsByDay: { [day:number]: string }
 * shiftHoursMap: { [shiftCode:string]: number }  // ör: { M:8, N:16, OFF:0, SV:8 }
 */
export function actualWorkedHours(year, month1to12, personShiftsByDay = {}, shiftHoursMap = {}) {
  let sum = 0;
  const total = daysInMonth(year, month1to12);
  for (let d = 1; d <= total; d++) {
    const sc = personShiftsByDay[d];
    if (!sc) continue;
    const h = Number(shiftHoursMap[sc]) || 0;
    sum += h;
  }
  return sum;
}

/**
 * Fazla mesai özetini döndürür.
 * @returns {{
 *   requiredBase:number,
 *   leaveCredit:number,
 *   requiredFinal:number,
 *   worked:number,
 *   overtime:number
 * }}
 */
export function overtimeHours({
  year,
  month1to12,
  officialHolidaysYmd = new Set(),
  arifeDaysYmd = new Set(),
  personLeavesByDay = {},
  leaveRules = {},
  personShiftsByDay = {},
  shiftHoursMap = {},
}) {
  const requiredBase = requiredHoursBase(year, month1to12, officialHolidaysYmd, arifeDaysYmd);
  const leaveCredit  = workedLikeLeaveHours(year, month1to12, personLeavesByDay, leaveRules);
  const requiredFinal = Math.max(0, requiredBase - leaveCredit); // negatife düşmesin
  const worked = actualWorkedHours(year, month1to12, personShiftsByDay, shiftHoursMap);
  const overtime = worked - requiredFinal;
  return { requiredBase, leaveCredit, requiredFinal, worked, overtime };
}
