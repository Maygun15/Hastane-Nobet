// utils/date.js

// Ayın günlerini hücrelere böler (takvim için)
export function buildMonthDays(year, month) {
  const f = new Date(year, month, 1);
  const l = new Date(year, month + 1, 0);
  const d = l.getDate();
  const s = (f.getDay() + 6) % 7;
  const cells = [];
  for (let i = 0; i < s; i++) cells.push(null);
  for (let i = 1; i <= d; i++) cells.push(new Date(year, month, i));
  while (cells.length % 7 !== 0) cells.push(null);
  while (cells.length < 42) cells.push(null);
  return { cells, daysInMonth: d };
}

// Yıl-ay key üretir (örn: 2025-09)
export function ymKey(y, m) {
  return `${y}-${String(m + 1).padStart(2, "0")}`;
}

// YYYY-MM-DD formatına çevir
export function fmtYmd(dt) {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// hh:mm → dakika
export function toMinutes(hhmm) {
  const [h, m] = (hhmm || "00:00").split(":").map((x) => parseInt(x || "0", 10));
  // 24 saat modunda güvenli dönüşüm
  const H = Number.isFinite(h) ? h % 24 : 0;
  const M = Number.isFinite(m) ? m % 60 : 0;
  return H * 60 + M;
}

/**
 * Vardiya süresi (saat)
 * - 08:00–08:00 => 24
 * - Gece devreden (örn. 20:00–08:00) doğru hesaplanır
 * - Ondalık dakika varsa saat cinsinden döner (örn. 07:30 => 7.5)
 */
export function shiftDurationHours(start, end) {
  const s = toMinutes(start);
  const e = toMinutes(end);

  // Fark
  let diff = e - s;

  // Aynı saat veya geriye sarma (gece devreden) durumları
  if (diff <= 0) diff += 24 * 60;

  // Saat cinsine çevir (2 ondalıkla güvenli)
  return Math.round((diff / 60) * 100) / 100;
}

/**
 * calculateDurationHours: Aynı mantığı ayrı bir yardımcı olarak sunar.
 * (Bazı dosyalarda ismi daha okunaklı tercih edilebilir.)
 */
export function calculateDurationHours(start, end) {
  return shiftDurationHours(start, end);
}
