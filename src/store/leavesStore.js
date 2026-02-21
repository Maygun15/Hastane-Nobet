// src/store/leavesStore.js
// Toplu izinler için tek veri kaynağı (LS + publish/subscribe)

import { LS } from "../utils/storage.js";

const LS_KEY = "allLeavesV2"; // istersen mevcut anahtarı yazarsın

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
  window.dispatchEvent(new CustomEvent("leaves:changed", { detail: next }));
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
  window.addEventListener("leaves:changed", handler);
  return () => window.removeEventListener("leaves:changed", handler);
}
