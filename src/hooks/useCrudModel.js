// src/hooks/useCrudModel.js
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Generic CRUD + localStorage persist.
 * @param {string} lsKey  localStorage anahtarı (ör. "dutyRowDefs_Nurse")
 * @param {string} idKey  benzersiz alan adı (varsayılan: "id")
 */
export default function useCrudModel(lsKey, idKey = "id") {
  // Başlangıç yüklemesi
  const [items, setItems] = useState(() => {
    try {
      const raw = localStorage.getItem(lsKey);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  // 🔁 lsKey değişince veriyi yeniden yükle (ör. role değişimi)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(lsKey);
      setItems(raw ? JSON.parse(raw) : []);
    } catch {
      setItems([]);
    }
  }, [lsKey]);

  // Her değişimde persist et
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    try { localStorage.setItem(lsKey, JSON.stringify(items)); } catch {}
  }, [items, lsKey]);

  // CRUD
  const create = useCallback((obj) => {
    const hasId = Object.prototype.hasOwnProperty.call(obj ?? {}, idKey);
    const id = hasId ? obj[idKey] : (crypto?.randomUUID?.() ?? Date.now());
    setItems((prev) => [...prev, { ...obj, [idKey]: id }]);
    return id;
  }, [idKey]);

  const update = useCallback((id, patch) => {
    setItems((prev) => prev.map((it) => (it[idKey] === id ? { ...it, ...patch } : it)));
  }, [idKey]);

  const remove = useCallback((id) => {
    setItems((prev) => prev.filter((it) => it[idKey] !== id));
  }, [idKey]);

  const replaceAll = useCallback((next) => {
    setItems(Array.isArray(next) ? next : []);
  }, []);

  return { items, create, update, remove, replaceAll };
}
