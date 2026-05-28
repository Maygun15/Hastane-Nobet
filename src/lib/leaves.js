// src/lib/leaves.js
// Leaves store (Mongo-first):
// - Kaynak: /api/leaves
// - Tek şema: { [personId]: { "YYYY-MM": { [dayNumber]: {code, note?} } } }
// - set/unset nesne parametreleriyle çalışır (optimistic + debounce save)
// - leavesToUnavailable => { [personId]: { [dayNumber]: true } }

import { LS } from "../utils/storage";
import { API, getToken } from "./api.js";

const PERSONNEL_STORE_KEY = "appStoreV1";

function stripDiacritics(str) {
  return (str || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/Ğ/g, "G").replace(/Ü/g, "U").replace(/Ş/g, "S").replace(/İ/g, "I")
    .replace(/Ö/g, "O").replace(/Ç/g, "C")
    .replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ş/g, "s").replace(/ı/g, "i")
    .replace(/ö/g, "o").replace(/ç/g, "c");
}
const canonName = (s) => stripDiacritics((s || "").toString().trim().toLocaleUpperCase("tr-TR"))
  .replace(/\s+/g, " ")
  .trim();

/* -------------------- yardımcılar -------------------- */
const ymKey = (y, m1) => `${y}-${String(m1).padStart(2, "0")}`;
const isObj = (o) => o && typeof o === "object" && !Array.isArray(o);
const toInt = (v) => (Number.isFinite(Number(v)) ? Number(v) : NaN);
const stableJson = (value) => JSON.stringify(value, (key, val) => {
  void key;
  if (!val || typeof val !== "object" || Array.isArray(val)) return val;
  return Object.keys(val).sort().reduce((acc, k) => {
    acc[k] = val[k];
    return acc;
  }, {});
});

function put(out, pid, year, month1, dayNum, rec) {
  const ym = ymKey(year, month1);
  if (!out[pid]) out[pid] = {};
  if (!out[pid][ym]) out[pid][ym] = {};
  const val = isObj(rec) ? rec : { code: String(rec || "").trim() };
  if (!val.code) return;
  out[pid][ym][String(dayNum)] = { code: val.code, ...(val.note ? { note: val.note } : {}) };
}

/* -------------------- cache + normalize -------------------- */
let leavesCache = {};
let leavesLoaded = false;
let loadPromise = null;
let saveTimer = null;
let leavesDirty = false;
let knownIdsCache = { ts: 0, ids: null };

function readKnownPersonnelIds() {
  const now = Date.now();
  if (knownIdsCache.ids && now - knownIdsCache.ts < 2000) return knownIdsCache.ids;
  const store = LS.get(PERSONNEL_STORE_KEY, null);
  const byId = store?.state?.personnelById || store?.personnelById;
  if (byId && typeof byId === "object") {
    const keys = Object.keys(byId);
    if (keys.length) {
      knownIdsCache = { ts: now, ids: new Set(keys.map(String)) };
      return knownIdsCache.ids;
    }
  }
  knownIdsCache = { ts: now, ids: null };
  return null;
}

function isKnownPersonId(pid) {
  const ids = readKnownPersonnelIds();
  if (!ids) return true; // personel listesi yüklenmediyse bloklama yapma
  return ids.has(String(pid));
}

function normalizeLeaves(raw) {
  const out = {};
  if (!isObj(raw)) return out;
  const keys = Object.keys(raw);
  if (!keys.length) return out;

  const firstKey = keys[0];
  const maybeYmFirst = firstKey.includes("-");

  if (maybeYmFirst) {
    // "YYYY-MM" -> pid -> gün
    for (const [ym, byPid] of Object.entries(raw)) {
      const [Y, M] = ym.split("-").map((x) => parseInt(x, 10));
      for (const [pid, days] of Object.entries(byPid || {})) {
        for (const [d, rec] of Object.entries(days || {})) {
          const day = parseInt(d, 10);
          if (Number.isFinite(day)) put(out, String(pid), Y, M, day, rec);
          else if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
            const dd = parseInt(d.slice(8, 10), 10);
            if (Number.isFinite(dd)) put(out, String(pid), Y, M, dd, rec);
          }
        }
      }
    }
  } else {
    const sample = raw[firstKey];
    const looksYearBuckets = sample && Object.keys(sample).some((k) => /^\d{4}$/.test(k));

    if (looksYearBuckets) {
      // pid -> Y -> M -> gün
      for (const [pid, byY] of Object.entries(raw)) {
        for (const [Ystr, byM] of Object.entries(byY || {})) {
          for (const [Mstr, days] of Object.entries(byM || {})) {
            const Y = parseInt(Ystr, 10);
            const M = parseInt(Mstr, 10);
            for (const [d, rec] of Object.entries(days || {})) {
              const day = parseInt(d, 10);
              if (Number.isFinite(day)) put(out, String(pid), Y, M, day, rec);
            }
          }
        }
      }
    } else {
      // pid -> "YYYY-MM" -> gün
      for (const [pid, byYm] of Object.entries(raw)) {
        for (const [ym, days] of Object.entries(byYm || {})) {
          const [Y, M] = ym.split("-").map((x) => parseInt(x, 10));
          for (const [d, rec] of Object.entries(days || {})) {
            const day = parseInt(d, 10);
            if (Number.isFinite(day)) put(out, String(pid), Y, M, day, rec);
            else if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
              const dd = parseInt(d.slice(8, 10), 10);
              if (Number.isFinite(dd)) put(out, String(pid), Y, M, dd, rec);
            }
          }
        }
      }
    }
  }

  return out;
}

export function emitLeavesChanged() {
  try { window.dispatchEvent(new Event("leaves:changed")); } catch {}
}

export function invalidateLeaves() {
  leavesLoaded = false;
  leavesDirty = false;
  loadPromise = null;
}

export function setLeavesStore(raw, { emit = true } = {}) {
  const next = normalizeLeaves(raw);
  const changed = stableJson(leavesCache) !== stableJson(next);
  leavesCache = next;
  leavesLoaded = true;
  leavesDirty = false;
  if (emit && changed) emitLeavesChanged();
  return leavesCache;
}

export async function loadLeavesFromBackend() {
  if (loadPromise) return loadPromise;
  const token = getToken();
  if (!token) {
    leavesLoaded = true;
    return Promise.resolve(leavesCache);
  }
  loadPromise = API.http
    .get(`/api/leaves?serviceId=`)
    .then((res) => {
      if (leavesDirty) return leavesCache;
      const value = res?.data && typeof res.data === "object" ? res.data : {};
      setLeavesStore(value);
      return leavesCache;
    })
    .catch((err) => {
      console.warn("Leaves fetch failed:", err?.message || err);
      // leavesLoaded intentionally NOT set — allows retry on next call
      return leavesCache;
    })
    .finally(() => {
      loadPromise = null;
    });
  return loadPromise;
}

async function saveLeavesNow() {
  const token = getToken();
  if (!token) return;
  try {
    await API.http.req(`/api/settings/leavesV2`, {
      method: "PUT",
      body: { value: leavesCache, serviceId: "" },
    });
    leavesDirty = false;
  } catch (err) {
    console.warn("leavesV2 save failed:", err?.message || err);
  }
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveLeavesNow();
  }, 600);
}

/* -------------------- dışa açılan API -------------------- */

// Tam normalize şema
export function getAllLeaves() {
  if (!leavesLoaded) loadLeavesFromBackend();
  return { ...leavesCache };
}

export function getLeaveSuppress() {
  // Geriye dönük API: local suppress devre dışı, backend tek kaynak.
  return { ids: {}, canon: {} };
}

export function setLeave({ personId, personName, year, month, day, code, note }) {
  void personName;
  const pidRaw = personId ?? "";
  const pid = typeof pidRaw === "string" ? pidRaw : String(pidRaw);
  const Y = toInt(year);
  const M1 = toInt(month);
  const D = toInt(day);
  const c = (code ?? "").toString().trim();
  if (!Number.isFinite(Y) || !Number.isFinite(M1) || !Number.isFinite(D) || !c) return;

  const pidSet = pid && pid !== "undefined" && pid !== "null" && pid !== "";
  const pidOk = pidSet ? isKnownPersonId(pid) : false;
  if (!pidSet || !pidOk) return;
  const token = getToken();
  if (!token) return;

  const ym = ymKey(Y, M1);
  leavesCache[pid] ??= {};
  leavesCache[pid][ym] ??= {};
  leavesCache[pid][ym][String(D)] = note ? { code: c, note } : { code: c };
  leavesLoaded = true;
  leavesDirty = true;
  scheduleSave();

  // Arka planda tek gün bazlı backend sync
  API.http.req(`/api/leaves`, {
    method: "PUT",
    body: { personId: pid, year: Y, month: M1, day: D, code: c, ...(note ? { note } : {}), serviceId: "" },
  }).catch((err) => console.warn("leave PUT failed:", err?.message));

  emitLeavesChanged();
}

/**
 * Çakışma kontrolü yaparak izin kaydeder. Optimistik değil — backend cevabı bekler.
 * 409 çakışmada err.status===409 ve err.data.conflict===true ile fırlatır.
 */
export async function setLeaveWithCheck({ personId, personName, year, month, day, code, note, force = false }) {
  void personName;
  const pidRaw = personId ?? "";
  const pid = typeof pidRaw === "string" ? pidRaw : String(pidRaw);
  const Y = toInt(year);
  const M1 = toInt(month);
  const D = toInt(day);
  const c = typeof code === "string" ? code.trim() : String(code ?? "").trim();

  if (!pid || !Number.isFinite(Y) || !Number.isFinite(M1) || !Number.isFinite(D) || !c) {
    throw new Error("Geçersiz parametre");
  }
  const token = getToken();
  if (!token) throw new Error("Oturum açılı değil");

  await API.http.req(`/api/leaves`, {
    method: "PUT",
    body: { personId: pid, year: Y, month: M1, day: D, code: c, ...(note ? { note } : {}), serviceId: "", ...(force ? { force: true } : {}) },
  });

  // Backend başarılı — şimdi yerel önbelleği güncelle
  const ym = ymKey(Y, M1);
  leavesCache[pid] ??= {};
  leavesCache[pid][ym] ??= {};
  leavesCache[pid][ym][String(D)] = note ? { code: c, note } : { code: c };
  leavesLoaded = true;
  leavesDirty = true;
  scheduleSave();
  emitLeavesChanged();
}

// Nesne-parametreli unset
export function unsetLeave({ personId, personName, year, month, day }) {
  void personName;
  const pidRaw = personId ?? "";
  const pid = typeof pidRaw === "string" ? pidRaw : String(pidRaw);
  const Y = toInt(year);
  const M1 = toInt(month);
  const D = toInt(day);
  if (!Number.isFinite(Y) || !Number.isFinite(M1) || !Number.isFinite(D)) return;

  const pidSet = pid && pid !== "undefined" && pid !== "null" && pid !== "";
  const pidOk = pidSet ? isKnownPersonId(pid) : false;
  if (!pidSet || !pidOk) return;
  const token = getToken();
  if (!token) return;

  const ym = ymKey(Y, M1);
  if (leavesCache?.[pid]?.[ym]) {
    delete leavesCache[pid][ym][String(D)];
    if (!Object.keys(leavesCache[pid][ym]).length) delete leavesCache[pid][ym];
    if (!Object.keys(leavesCache[pid]).length) delete leavesCache[pid];
    leavesLoaded = true;
    leavesDirty = true;
    scheduleSave();
  }

  // Arka planda tek gün bazlı backend sync
  API.http.req(`/api/leaves`, {
    method: "DELETE",
    body: { personId: pid, year: Y, month: M1, day: D, serviceId: "" },
  }).catch((err) => console.warn("leave DELETE failed:", err?.message));

  emitLeavesChanged();
}

// Planlayıcıya uygun: { [pid]: { [day]: true } }
export function leavesToUnavailable(allLeaves = {}, year, month1) {
  const out = {};
  const ym = ymKey(year, month1);
  for (const [pid, byYm] of Object.entries(allLeaves || {})) {
    const monthObj = byYm?.[ym];
    if (!isObj(monthObj)) continue;
    for (const [k, rec] of Object.entries(monthObj)) {
      let d = NaN;
      if (/^\d{4}-\d{2}-\d{2}$/.test(k)) d = parseInt(k.slice(8, 10), 10);
      else d = parseInt(k, 10);
      if (!Number.isFinite(d) || d < 1 || d > 31) continue;
      const code = isObj(rec) ? rec.code : String(rec || "");
      if (!code) continue;
      out[pid] ??= {};
      out[pid][d] = true;
    }
  }
  return out;
}

// Geriye uyumluluk: bazı eski chunk/importlar bu ismi doğrudan bekliyor.
export const leavesToUnavailableByPid = leavesToUnavailable;

export function buildNameUnavailability(people = [], year, month1) {
  const Y = toInt(year);
  const M1 = toInt(month1);
  if (!Number.isFinite(Y) || !Number.isFinite(M1)) return new Map();

  const base = leavesToUnavailable(getAllLeaves(), Y, M1);
  const result = new Map();

  const addDays = (canon, bucket) => {
    if (!canon || !isObj(bucket)) return;
    if (!result.has(canon)) result.set(canon, new Set());
    const target = result.get(canon);
    for (const key of Object.keys(bucket)) {
      const dayNum = parseInt(key, 10);
      if (Number.isFinite(dayNum)) target.add(dayNum);
    }
  };

  const idCandidates = (person) => [
    person?.id,
    person?.personId,
    person?.pid,
    person?.tc,
    person?.tcNo,
    person?.kod,
    person?.code,
  ]
    .map((v) => (v == null ? "" : String(v).trim()))
    .filter(Boolean);

  for (const person of people || []) {
    const rawName =
      person?.fullName ||
      person?.name ||
      person?.["AD SOYAD"] ||
      person?.["Ad Soyad"] ||
      person?.["ad soyad"] ||
      "";
    const canon = canonName(rawName);
    if (!canon) continue;

    const personIds = idCandidates(person);
    for (const pid of personIds) {
      addDays(canon, base?.[pid]);
    }

    if (!result.get(canon)?.size) result.delete(canon);
  }

  return result;
}

/* ===== Geriye uyumluluk alias'ları =====
 * Eski imza: upsertLeave(pid, "YYYY-MM-DD", code)
 *            removeLeave(pid, "YYYY-MM-DD")
 * Yeni imza: setLeave({ personId, year, month, day, code })
 *            unsetLeave({ personId, year, month, day })
 */
export function upsertLeave(arg1, arg2, arg3) {
  if (arg1 && typeof arg1 === "object") {
    return setLeave(arg1);
  }
  const personId = String(arg1 || "");
  const dateStr = String(arg2 || "").slice(0, 10);
  if (!personId || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return;
  const [Y, M, D] = dateStr.split("-").map((x) => parseInt(x, 10));
  const code = (arg3 ?? "").toString().trim();
  if (!code) return;
  return setLeave({ personId, year: Y, month: M, day: D, code });
}

export function removeLeave(arg1, arg2) {
  if (arg1 && typeof arg1 === "object") {
    return unsetLeave(arg1);
  }
  const personId = String(arg1 || "");
  const dateStr = String(arg2 || "").slice(0, 10);
  if (!personId || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return;
  const [Y, M, D] = dateStr.split("-").map((x) => parseInt(x, 10));
  return unsetLeave({ personId, year: Y, month: M, day: D });
}
