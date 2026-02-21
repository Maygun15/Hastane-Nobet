// src/state/bootAppStoreFromLegacy.js
import { useAppStore } from "./appStore";

export function bootAppStoreFromLegacy() {
  // activeYM -> store
  const y = Number(localStorage.getItem("activeYM.year"));
  const m = Number(localStorage.getItem("activeYM.month"));
  if (Number.isFinite(y) && Number.isFinite(m) && m >= 1 && m <= 12) {
    useAppStore.getState().setYM({ year: y, month: m });
  }
  // workingHours -> shiftCodeHours
  try {
    const arr = JSON.parse(localStorage.getItem("workingHours") || "[]");
    if (Array.isArray(arr) && arr.length) {
      useAppStore.getState().setShiftCodeHours(arr);
    }
  } catch {}
}
