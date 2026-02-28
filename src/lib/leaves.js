// src/lib/leaves.js
// Leaves store (Mongo-first):
// - Kaynak: /api/settings/personLeaves
// - Tek şema: { [personId]: { "YYYY-MM": { [dayNumber]: {code, note?} } } }
// - set/unset nesne parametreleriyle çalışır (optimistic + debounce save)
// - leavesToUnavailable => { [personId]: { [dayNumber]: true } }

import { LS } from "../utils/storage";
import { API, getToken } from "./api.js";

const NAME_STORE_KEY = "allLeavesByNameV1";
const SUPPRESS_KEY = "leaveSuppressV1";

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

function emitLeavesChanged() {
  try { window.dispatchEvent(new Event("leaves:changed")); } catch {}
}

export function setLeavesStore(raw, { emit = true } = {}) {
  leavesCache = normalizeLeaves(raw);
  leavesLoaded = true;
  leavesDirty = false;
  if (emit) emitLeavesChanged();
}

export async function loadLeavesFromBackend() {
  if (loadPromise) return loadPromise;
  const token = getToken();
  if (!token) {
    leavesLoaded = true;
    return Promise.resolve(leavesCache);
  }
  loadPromise = API.http
    .get(`/api/settings/personLeaves?serviceId=`)
    .then((res) => {
      if (leavesDirty) return leavesCache;
      const value = res?.value && typeof res.value === "object" ? res.value : {};
      setLeavesStore(value);
      return leavesCache;
    })
    .catch((err) => {
      console.warn("Leaves fetch failed:", err?.message || err);
      leavesLoaded = true;
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
    await API.http.req(`/api/settings/personLeaves`, {
      method: "PUT",
      body: { value: leavesCache, serviceId: "" },
    });
    leavesDirty = false;
  } catch (err) {
    console.warn("personLeaves save failed:", err?.message || err);
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
  return leavesCache;
}

function readSuppress() {
  return (
    LS.get(SUPPRESS_KEY, {
      ids: {},
      canon: {},
    }) || { ids: {}, canon: {} }
  );
}

function writeSuppress(map) {
  LS.set(SUPPRESS_KEY, map);
}

export function getLeaveSuppress() {
  return readSuppress();
}

// Nesne-parametreli set
function setNameLeave({ canon, year, month, day, rec }) {
  if (!canon) return;
  const store = LS.get(NAME_STORE_KEY, {});
  const ym = ymKey(year, month);
  store[canon] ??= {};
  store[canon][ym] ??= {};
  if (rec) store[canon][ym][String(day)] = rec;
  else delete store[canon][ym][String(day)];
  if (store[canon][ym] && !Object.keys(store[canon][ym]).length) delete store[canon][ym];
  if (store[canon] && !Object.keys(store[canon]).length) delete store[canon];
  LS.set(NAME_STORE_KEY, store);
}

function updateSuppress({ pid, canon, year, month, day, suppress }) {
  const map = readSuppress();
  const ym = ymKey(year, month);
  if (pid) {
    map.ids[pid] ??= {};
    map.ids[pid][ym] ??= {};
    if (suppress) map.ids[pid][ym][String(day)] = true;
    else {
      delete map.ids[pid][ym][String(day)];
      if (!Object.keys(map.ids[pid][ym]).length) delete map.ids[pid][ym];
      if (!Object.keys(map.ids[pid] || {}).length) delete map.ids[pid];
    }
  }
  if (canon) {
    map.canon[canon] ??= {};
    map.canon[canon][ym] ??= {};
    if (suppress) map.canon[canon][ym][String(day)] = true;
    else {
      delete map.canon[canon][ym][String(day)];
      if (!Object.keys(map.canon[canon][ym]).length) delete map.canon[canon][ym];
      if (!Object.keys(map.canon[canon] || {}).length) delete map.canon[canon];
    }
  }
  writeSuppress(map);
}

export function setLeave({ personId, personName, year, month, day, code, note }) {
  const pidRaw = personId ?? "";
  const pid = typeof pidRaw === "string" ? pidRaw : String(pidRaw);
  const Y = toInt(year);
  const M1 = toInt(month);
  const D = toInt(day);
  const c = (code ?? "").toString().trim();
  const canon = personName ? canonName(personName) : null;
  if (!Number.isFinite(Y) || !Number.isFinite(M1) || !Number.isFinite(D) || !c) return;

  if (pid && pid !== "undefined" && pid !== "null" && pid !== "") {
    const ym = ymKey(Y, M1);
    leavesCache[pid] ??= {};
    leavesCache[pid][ym] ??= {};
    leavesCache[pid][ym][String(D)] = note ? { code: c, note } : { code: c };
    leavesLoaded = true;
    leavesDirty = true;
    scheduleSave();
  }

  if ((!pid || pid === "undefined" || pid === "null" || pid === "") && !canon) {
    return;
  }

  if (canon) {
    const rec = note ? { code: c, note } : { code: c };
    setNameLeave({ canon, year: Y, month: M1, day: D, rec });
  }

  updateSuppress({ pid, canon, year: Y, month: M1, day: D, suppress: false });

  emitLeavesChanged();
}

// Nesne-parametreli unset
export function unsetLeave({ personId, personName, year, month, day }) {
  const pidRaw = personId ?? "";
  const pid = typeof pidRaw === "string" ? pidRaw : String(pidRaw);
  const Y = toInt(year);
  const M1 = toInt(month);
  const D = toInt(day);
  const canon = personName ? canonName(personName) : null;
  if (!Number.isFinite(Y) || !Number.isFinite(M1) || !Number.isFinite(D)) return;

  if (pid && pid !== "undefined" && pid !== "null" && pid !== "") {
    const ym = ymKey(Y, M1);
    if (leavesCache?.[pid]?.[ym]) {
      delete leavesCache[pid][ym][String(D)];
      if (!Object.keys(leavesCache[pid][ym]).length) delete leavesCache[pid][ym];
      if (!Object.keys(leavesCache[pid]).length) delete leavesCache[pid];
      leavesLoaded = true;
      leavesDirty = true;
      scheduleSave();
    }
  }

  if (canon) {
    setNameLeave({ canon, year: Y, month: M1, day: D, rec: null });
  }

  updateSuppress({ pid, canon, year: Y, month: M1, day: D, suppress: true });

  emitLeavesChanged();
}

// Planlayıcıya uygun: { [pid]: { [day]: true } }
export function leavesToUnavailable(allLeaves = {}, year, month1) {
  const out = {};
  const ym = ymKey(year, month1);
  const suppress = readSuppress();
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
      if (suppress.ids?.[pid]?.[ym]?.[String(d)]) continue;
      out[pid] ??= {};
      out[pid][d] = true;
    }
  }
  try {
    const nameStore = LS.get(NAME_STORE_KEY, {});
    for (const [canon, byYm] of Object.entries(nameStore || {})) {
      const monthObj = byYm?.[ym];
      if (!isObj(monthObj)) continue;
      const pseudoId = `__name__:${canon}`;
      for (const [k, rec] of Object.entries(monthObj)) {
        let d = NaN;
        if (/^\d{4}-\d{2}-\d{2}$/.test(k)) d = parseInt(k.slice(8, 10), 10);
        else d = parseInt(k, 10);
        if (!Number.isFinite(d) || d < 1 || d > 31) continue;
        const code = isObj(rec) ? rec.code : String(rec || "");
        if (!code) continue;
        if (suppress.canon?.[canon]?.[ym]?.[String(d)]) continue;
        out[pseudoId] ??= {};
        out[pseudoId][d] = true;
      }
    }
  } catch {}
  return out;
}

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

    for (const pid of idCandidates(person)) {
      addDays(canon, base?.[pid]);
    }
    addDays(canon, base?.[`__name__:${canon}`]);

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
