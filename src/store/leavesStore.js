// src/store/leavesStore.js
// Toplu izin listesi (dizi formatı) için veri kaynağı.
// NOT: Bireysel nöbet izinleri için leaves.js kullanılır.
// Bu iki sistem farklı formatlarda veri tutar ve ayrı event kanalları kullanır.

import { LS } from "../utils/storage.js";

const LS_KEY = "allLeavesV2";
// Çakışmayı önlemek için kendi event adını kullan (leaves.js ile karışmaz)
const CHANGE_EVENT = "leavesArray:changed";

function readLS() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeLS(next) {
  localStorage.setItem(LS_KEY, JSON.stringify(next || []));
  try {
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: next }));
  } catch {}
}

let _cache = readLS();

export function getLeaves() {
  return Array.isArray(_cache) ? _cache : [];
}

export function setLeaves(updater) {
  const prev = getLeaves();
  const next = typeof updater === "function" ? updater(prev) : updater;
  _cache = Array.isArray(next) ? next : [];
  writeLS(_cache);
  return _cache;
}

export function addLeave(leave) {
  return setLeaves((arr) => [...arr, leave]);
}

export function removeLeave(predicateOrId) {
  return setLeaves((arr) => {
    if (typeof predicateOrId === "function") return arr.filter((x) => !predicateOrId(x));
    return arr.filter((x) => x.id !== predicateOrId);
  });
}

export function replaceLeaves(nextArray) {
  return setLeaves(nextArray);
}

export function onLeavesChange(cb) {
  const handler = (e) => cb(e.detail);
  window.addEventListener(CHANGE_EVENT, handler);
  return () => window.removeEventListener(CHANGE_EVENT, handler);
}
