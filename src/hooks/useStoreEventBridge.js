// src/hooks/useStoreEventBridge.js
//
// Zustand store değişikliklerini dinleyip legacy window event'lerini tetikler.
// Bileşenler doğrudan store'a geçiş yapana kadar geriye dönük uyumluluğu korur.
// Tek bir yerde yönetilir; HospitalRosterApp'taki dağınık dispatchEvent çağrıları
// kaldırılabilir.
import { useEffect } from "react";
import { useAppStore } from "../state/appStore.js";

const pendingEvents = new Set();
let flushHandle = 0;

const fire = (name) => {
  if (typeof window === "undefined") return;
  pendingEvents.add(name);
  if (flushHandle) return;

  const flush = () => {
    flushHandle = 0;
    const events = Array.from(pendingEvents);
    pendingEvents.clear();
    for (const eventName of events) {
      try { window.dispatchEvent(new Event(eventName)); } catch {}
    }
  };

  if (typeof window.requestAnimationFrame === "function") {
    flushHandle = window.requestAnimationFrame(flush);
  } else {
    flushHandle = window.setTimeout(flush, 0);
  }
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
