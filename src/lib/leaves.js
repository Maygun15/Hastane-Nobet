// src/lib/leaves.js
// Evrensel uyumluluk katmanı:
// - Eski/alternatif depolama anahtarlarını okur (allLeavesV1, leavesV2, personLeaves, personLeavesV2, allLeaves)
// - Tek şema döndürür: { [personId]: { "YYYY-MM": { [dayNumber]: {code, note?} } } }
// - set/unset nesne parametreleriyle çalışır
// - leavesToUnavailable => { [personId]: { [dayNumber]: true } }

import { LS } from "../utils/storage";

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

/* -------------------- tüm kaynakları oku + normalize et -------------------- */
function readAllSourcesNormalized() {
  const out = {};

  // 1) Legacy buckets first (so newer kaynaklar üzerine yazabilsin)
  for (const KEY of ["personLeavesV2", "personLeaves", "allLeaves"]) {
    try {
      const v = LS.get(KEY);
      if (!isObj(v)) continue;

      const maybeYmFirst = Object.keys(v)[0]?.includes("-");
      const maybePidFirst = !maybeYmFirst;

      if (maybeYmFirst) {
        // "YYYY-MM" -> pid -> gün
        for (const [ym, byPid] of Object.entries(v)) {
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
      } else if (maybePidFirst) {
        const sample = v[Object.keys(v)[0]];
        const looksYearBuckets = sample && Object.keys(sample).some((k) => /^\d{4}$/.test(k));

        if (looksYearBuckets) {
          // pid -> Y -> M -> gün
          for (const [pid, byY] of Object.entries(v)) {
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
          for (const [pid, byYm] of Object.entries(v)) {
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
    } catch {}
  }

  // 2) leavesV2 (orta nesil)
  try {
    const v = LS.get("leavesV2");
    if (isObj(v)) {
      for (const [pid, byYm] of Object.entries(v)) {
        for (const [ym, days] of Object.entries(byYm || {})) {
          const [Y, M] = ym.split("-").map((x) => parseInt(x, 10));
          for (const [d, rec] of Object.entries(days || {})) {
            const day = parseInt(d, 10);
            if (Number.isFinite(day)) put(out, String(pid), Y, M, day, rec);
            else if (/^\d{2}$/.test(d)) put(out, String(pid), Y, M, parseInt(d, 10), rec);
            else if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
              const dd = parseInt(d.slice(8, 10), 10);
              if (Number.isFinite(dd)) put(out, String(pid), Y, M, dd, rec);
            }
          }
        }
      }
    }
  } catch {}

  // 3) allLeavesV1 (en güncel kaynak, en sonda yazılsın ki override etsin)
  try {
    const v = LS.get("allLeavesV1");
    if (isObj(v)) {
      for (const [pid, byYm] of Object.entries(v)) {
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
  } catch {}

  // 4) Suppress kayıtlarını uygula (eski kaynaklardaki kalıntıları silebilmek için)
  try {
    const suppress = readSuppress();
    const suppressIds = suppress?.ids && isObj(suppress.ids) ? suppress.ids : null;
    if (suppressIds) {
      for (const [pid, byYm] of Object.entries(suppressIds)) {
        const bucket = out[pid];
        if (!isObj(bucket)) continue;
        for (const [ym, days] of Object.entries(byYm || {})) {
          const monthObj = bucket?.[ym];
          if (!isObj(monthObj)) continue;
          for (const dayKey of Object.keys(days || {})) {
            delete monthObj[dayKey];
          }
          if (!Object.keys(monthObj).length) delete bucket[ym];
        }
        if (!Object.keys(bucket).length) delete out[pid];
      }
    }
  } catch {}

  return out;
}

/* -------------------- dışa açılan API -------------------- */

// Tam normalize şema
export function getAllLeaves() {
  return readAllSourcesNormalized();
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
    const all = LS.get("allLeavesV1", {});
    const ym = ymKey(Y, M1);
    all[pid] ??= {};
    all[pid][ym] ??= {};
    all[pid][ym][String(D)] = note ? { code: c, note } : { code: c };
    LS.set("allLeavesV1", all);
  }

  if ((!pid || pid === "undefined" || pid === "null" || pid === "") && !canon) {
    return;
  }

  if (canon) {
    const rec = note ? { code: c, note } : { code: c };
    setNameLeave({ canon, year: Y, month: M1, day: D, rec });
  }

  updateSuppress({ pid, canon, year: Y, month: M1, day: D, suppress: false });

  window.dispatchEvent(new Event("leaves:changed"));
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
    const all = LS.get("allLeavesV1", {});
    const ym = ymKey(Y, M1);
    if (all?.[pid]?.[ym]) {
      delete all[pid][ym][String(D)];
      if (!Object.keys(all[pid][ym]).length) delete all[pid][ym];
      if (!Object.keys(all[pid]).length) delete all[pid];
      LS.set("allLeavesV1", all);
    }
  }

  if (canon) {
    setNameLeave({ canon, year: Y, month: M1, day: D, rec: null });
  }

  updateSuppress({ pid, canon, year: Y, month: M1, day: D, suppress: true });

  window.dispatchEvent(new Event("leaves:changed"));
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
