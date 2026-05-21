// src/state/appStore.js
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

function todayYM() {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 }; // 1..12
}

/* LS okuma yardımcısı — store initialize olurken senkron çalışır */
function lsInit(keys, fallback = []) {
  try {
    for (const k of keys) {
      const raw = localStorage.getItem(k);
      if (raw) {
        const v = JSON.parse(raw);
        if (Array.isArray(v)) return v;
      }
    }
  } catch {}
  return fallback;
}

const initial = {
  ym: todayYM(),
  activeServiceId: "",   // Seçili servis — tüm sekmeler tarafından paylaşılır
  activeRole: "Nurse",   // Seçili rol (Nurse|Doctor) — tüm sekmeler tarafından paylaşılır
  // temel modeller
  personnelById: {},   // {id: {id, fullName, title, service, tckn? ...}}
  rulesById: {},       // {id: {...}}
  shiftsById: {},      // {id: {id, code, start, end, hours}}
  leaveTypesById: {},  // {id: {id, code, name}}
  leavesByPerson: {},  // {personId: [{id, start, end, partial, hours}]}
  shiftCodeHours: {},  // {"V1": 8, "N": 16, ...}
  // backend-sourced arrays (NOT persisted via Zustand; synced by HospitalRosterApp)
  workAreas: [],
  nurses: [],
  doctors: [],
  workingHours: lsInit(["workingHoursV2", "workingHours"]),
  leaveTypes: lsInit(["leaveTypesV2", "leaveTypes", "izinTurleri"]),
  personLeaves: {},  // {personId: [...]} — leaves:changed event'inde güncellenir
};

export const useAppStore = create(
  persist(
    (set, get) => ({
      ...initial,

      /* === AY/YIL === */
      setYM: (ym) => {
        const year = Number(ym?.year);
        const month = Number(ym?.month);
        if (!Number.isFinite(year) || year <= 0 || !Number.isFinite(month) || month < 1 || month > 12) return;
        set({ ym: { year, month } });
      },
      gotoPrev: () => {
        const { year, month } = get().ym;
        const d = new Date(year, month - 2, 1);
        set({ ym: { year: d.getFullYear(), month: d.getMonth() + 1 } });
      },
      gotoNext: () => {
        const { year, month } = get().ym;
        const d = new Date(year, month, 1);
        set({ ym: { year: d.getFullYear(), month: d.getMonth() + 1 } });
      },
      gotoToday: () => set({ ym: todayYM() }),

      /* === SERVİS & ROL === */
      setActiveServiceId: (id) => set({ activeServiceId: String(id ?? "") }),
      setActiveRole: (role) => {
        const val = role === "Doctor" ? "Doctor" : "Nurse";
        set({ activeRole: val });
        // Geriye dönük uyumluluk: LS ve event — eski bileşenler bunları dinliyor
        try {
          localStorage.setItem("activeRole", JSON.stringify(val));
          window.dispatchEvent(new CustomEvent("activeRole:changed", { detail: val }));
        } catch {}
      },

      /* === PERSONNEL === */
      upsertPersonnel: (list) =>
        set((state) => {
          const next = { ...state.personnelById };
          (list || []).forEach((p) => {
            const id = p.id || makeId();
            // DÜZELTME: { id, ...p, id } yerine { ...p, id }
            next[id] = { ...p, id };
          });
          return { personnelById: next };
        }),
      removePersonnel: (id) =>
        set((s) => {
          const next = { ...s.personnelById };
          delete next[id];
          return { personnelById: next };
        }),

      /* === SHIFT CODE HOURS === */
      setShiftCodeHours: (records) =>
        set(() => {
          const map = {};
          (records || []).forEach((x) => {
            if (!x?.code) return;
            const code = String(x.code).trim().toUpperCase();
            let h = 0;
            if (x.hours !== undefined && x.hours !== null && String(x.hours).trim() !== "") {
              const n = Number(x.hours);
              h = isNaN(n) ? 0 : n;
            } else if (x.start && x.end) {
              h = diffHours(x.start, x.end);
            }
            map[code] = h;
          });
          return { shiftCodeHours: map };
        }),

      /* === LEAVES === */
      setLeavesForPersonMonth: (personId, leavesArr) =>
        set((s) => ({
          leavesByPerson: { ...s.leavesByPerson, [personId]: Array.isArray(leavesArr) ? [...leavesArr] : [] },
        })),

      /* === BACKEND-SOURCED ARRAYS === */
      setWorkAreas: (arr) => set({ workAreas: Array.isArray(arr) ? arr : [] }),
      setNurses: (arr) => set({ nurses: Array.isArray(arr) ? arr : [] }),
      setDoctors: (arr) => set({ doctors: Array.isArray(arr) ? arr : [] }),
      setWorkingHours: (arr) => set({ workingHours: Array.isArray(arr) ? arr : [] }),
      setLeaveTypes: (arr) => set({ leaveTypes: Array.isArray(arr) ? arr : [] }),
      setPersonLeaves: (obj) => set({ personLeaves: (obj && typeof obj === "object") ? obj : {} }),

      /* === RULES & LEAVE TYPES (örnek) === */
      upsertRules: (rules) =>
        set((s) => {
          const next = { ...s.rulesById };
          (rules || []).forEach((r) => {
            const id = r.id || makeId();
            // DÜZELTME
            next[id] = { ...r, id };
          });
          return { rulesById: next };
        }),
      upsertLeaveTypes: (arr) =>
        set((s) => {
          const next = { ...s.leaveTypesById };
          (arr || []).forEach((x) => {
            const id = x.id || makeId();
            next[id] = { id, code: x.code, name: x.name };
          });
          return { leaveTypesById: next };
        }),
    }),
    {
      name: "appStoreV1",
      storage: createJSONStorage(() => localStorage),
      version: 1,
      // Backend-sourced arrays are large and managed separately; exclude from persist snapshot.
      partialize: ({ workAreas, nurses, doctors, workingHours, leaveTypes, personLeaves, ...rest }) => rest,
    }
  )
);

/* === Yardımcılar === */

function makeId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // ufak fallback
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0,
      v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function parseTimeStr(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = +m[1], mm = +m[2];
  if (hh < 0 || hh > 29 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function diffHours(start, end) {
  const a = parseTimeStr(start), b = parseTimeStr(end);
  if (a == null || b == null) return 0;
  let d = b - a;
  if (d < 0) d += 24 * 60;
  return Math.round((d / 60) * 100) / 100;
}
