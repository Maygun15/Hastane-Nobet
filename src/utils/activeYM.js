// src/utils/activeYM.js
import { LS } from "./storage.js";

/* === Tek ortak anahtar === */
export const LS_YM_KEY = "activeYM:v2";

/* === Yardımcı === */
function clampMonth(m) {
  m = Number(m);
  if (m < 1) return 1;
  if (m > 12) return 12;
  return m;
}

/* === Okuma === */
export function getActiveYM() {
  try {
    const saved = LS.get(LS_YM_KEY);
    if (saved && saved.year && saved.month) {
      return {
        year: Number(saved.year),
        month: clampMonth(saved.month),
      };
    }
  } catch (_) {}

  // fallback: bugünkü yıl/ay
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

/* === Yazma === */
export function setActiveYM({ year, month }) {
  if (!year || !month) return;
  const payload = {
    year: Number(year),
    month: clampMonth(month),
  };

  try {
    LS.set(LS_YM_KEY, payload);
  } catch (_) {}

  try {
    // Sekme içi canlı güncelleme
    window.dispatchEvent(new CustomEvent("activeYM:change", { detail: payload }));
  } catch (_) {}
}

/* === Key formatı (opsiyonel) === */
export function ymKey({ year, month }) {
  return `${year}-${String(month).padStart(2, "0")}`;
}
