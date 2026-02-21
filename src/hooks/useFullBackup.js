// src/hooks/useServicesModel.js
import { useEffect, useMemo, useState } from "react";
import { LS_KEYS } from "../utils/lsKeys.js";

const uuid = () =>
  (globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : String(Date.now() + Math.random()));

function readLS(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}
function writeLS(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

// Sayfa içi senkron için event helpers
const EV_CHANGED = "services:changed";
const EV_REPLACE = "services:replace";
const emit = (name, detail) => {
  try { window.dispatchEvent(new CustomEvent(name, { detail })); } catch {}
};

export default function useServicesModel() {
  const [items, setItems] = useState(() => readLS(LS_KEYS.SERVICES, []));

  // LS’e yaz ve değişikliği duyur
  useEffect(() => {
    writeLS(LS_KEYS.SERVICES, items);
    emit(EV_CHANGED, { items });
  }, [items]);

  // Dışarıdan toplu değişim (backup restore vb.) geldiğinde güncelle
  useEffect(() => {
    const onReplace = (e) => {
      const next = Array.isArray(e?.detail?.items) ? e.detail.items : [];
      setItems(next);
    };
    window.addEventListener(EV_REPLACE, onReplace);
    return () => window.removeEventListener(EV_REPLACE, onReplace);
  }, []);

  const api = useMemo(() => ({
    list() { return items; },
    add(part) {
      const it = { id: uuid(), code: "", name: "Yeni Servis", active: true, ...part };
      setItems(prev => [...prev, it]);
      return it;
    },
    update(id, patch) { setItems(prev => prev.map(x => x.id === id ? { ...x, ...patch } : x)); },
    remove(id) { setItems(prev => prev.filter(x => x.id !== id)); },
    toggle(id) { setItems(prev => prev.map(x => x.id === id ? { ...x, active: !x.active } : x)); },

    // 🔹 Toplu set: backup restore veya dış entegrasyon için
    replaceAll(list) {
      const safe = Array.isArray(list) ? list : [];
      // Hem state’i güncelle, hem de diğer hook örneklerine haber ver
      writeLS(LS_KEYS.SERVICES, safe);
      emit(EV_REPLACE, { items: safe });
    },
  }), [items]);

  return api;
}

// (Opsiyonel) Harici import/export yardımcıları
export function exportServices() {
  return readLS(LS_KEYS.SERVICES, []);
}
export function importServices(list) {
  const safe = Array.isArray(list) ? list : [];
  writeLS(LS_KEYS.SERVICES, safe);
  emit(EV_REPLACE, { items: safe });
}
