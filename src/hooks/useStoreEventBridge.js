// src/hooks/useStoreEventBridge.js
//
// Zustand store değişikliklerini dinleyip legacy window event'lerini tetikler.
// Bileşenler doğrudan store'a geçiş yapana kadar geriye dönük uyumluluğu korur.
// Tek bir yerde yönetilir; HospitalRosterApp'taki dağınık dispatchEvent çağrıları
// kaldırılabilir.
import { useEffect } from "react";
import { useAppStore } from "../state/appStore.js";

const fire = (name) => {
  try { window.dispatchEvent(new Event(name)); } catch {}
};

export function useStoreEventBridge() {
  useEffect(() => {
    return useAppStore.subscribe((state, prev) => {
      if (state.workAreas !== prev.workAreas) {
        fire("workAreas:changed");
        fire("settings:changed");
      }
      if (state.nurses !== prev.nurses || state.doctors !== prev.doctors) {
        fire("people:changed");
      }
      if (state.workingHours !== prev.workingHours) {
        fire("workingHours:changed");
        fire("settings:changed");
      }
      if (state.leaveTypes !== prev.leaveTypes) {
        fire("leaveTypes:changed");
      }
      if (state.personLeaves !== prev.personLeaves) {
        fire("leaves:changed");
      }
    });
  }, []);
}
