// src/engine/rosterEngine.js
import { getAllLeaves, getLeaveSuppress } from "../lib/leaves.js";

export const STAFF_KEY = "personCards";
const PINS_KEY = "rosterPins";
const SUP_POOL_KEY = "supervisorPool";
const SUP_CFG_KEY = "supervisorConfig";

const NIGHT = new Set(["N", "V1", "V2", "SV"]);

const U = (s) => (s || "").toString().trim().toLocaleUpperCase("tr-TR");
const daysIn = (y, m0) => new Date(y, m0 + 1, 0).getDate();

function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function readJSON(key, defVal) { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : defVal; } catch { return defVal; } }
function writeJSON(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }

/* ========== Kanonikleştirme (isim eşleşmesi sağlam olsun) ========== */
function stripDiacritics(str) {
  return (str || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/Ğ/g, "G").replace(/Ü/g, "U").replace(/Ş/g, "S").replace(/İ/g, "I")
    .replace(/Ö/g, "O").replace(/Ç/g, "C")
    .replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ş/g, "s").replace(/ı/g, "i")
    .replace(/ö/g, "o").replace(/ç/g, "c");
}
function canonName(s) {
  return stripDiacritics(U(s)).replace(/\s+/g, " ").trim();
}
function tokens(s) {
  return canonName(s).split(" ").filter(Boolean);
}

/* ========== Alan eşleşmesi ========== */
function areaKeywords(label) {
  const s = U(label);
  const map = {
    "SERVİS SORUMLUSU": ["SERVİS SORUMLUSU", "SORUMLU"],
    "SÜPERVİZÖR": ["SÜPERVİZÖR", "SUPERVISOR", "SV"],
    "EKİP SORUMLUSU": ["EKİP SORUMLUSU", "SORUMLU"],
    "RESÜSİTASYON": ["RESÜSİTASYON"],
    "KIRMIZI VE SARI GÖREVLENDİRME": ["KIRMIZI", "SARI"],
    "KIRMIZI": ["KIRMIZI"],
    "SARI": ["SARI"],
    "ÇOCUK": ["ÇOCUK"],
    "YEŞİL": ["YEŞİL"],
    "ECZANE": ["ECZANE"],
    "CERRAHİ MÜDAHELE": ["CERRAHİ MÜDAHELE", "CERRAHİ"],
    "CERRAHİ": ["CERRAHİ"],
    "AŞI": ["AŞI"],
    "TRİAJ": ["TRİAJ"],
  };
  for (const k of Object.keys(map)) if (s.includes(k)) return map[k];
  return s ? [s.split(" ")[0]] : [];
}

/* ========== Personel normalize ========== */
function arrFromAny(v) {
  if (!v && v !== 0) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === "string") return v.split(/[;,|]/).map((x) => x.trim()).filter(Boolean);
  return [];
}
function buildStaffIndex(staffRaw) {
  const out = [];
  for (const s of staffRaw || []) {
    const id = String(s?.id ?? s?.pid ?? s?.tc ?? s?.code ?? "");
    const name = s?.name || s?.fullName || s?.displayName || s?.["AD SOYAD"];
    if (!id || !name) continue;

    const areas = new Set();
    [s.areas, s.workAreas, s.skills, s.tags, s?.meta?.areas, s?.meta?.workAreas, s?.meta?.skills, s?.meta?.tags]
      .forEach((src) => arrFromAny(src).forEach((a) => areas.add(U(a))));

    const shiftCodes = new Set();
    [s.shiftCodes, s.shifts, s.allowedShifts, s.vardiyaKodlari, s.vardiya, s.vardiyalar, s?.meta?.shiftCodes, s?.meta?.shifts]
      .forEach((src) => arrFromAny(src).forEach((c) => shiftCodes.add(U(c))));

    out.push({
      id,
      name,
      nameCanon: canonName(name),
      role: s.role || s?.meta?.role || null,
      code: s.code || s?.meta?.code || null,
      areas,
      shiftCodes,
      weekendOff: !!(s.weekendOff || s?.meta?.weekendOff),
      nightAllowed: !(s.nightAllowed === false || s?.meta?.nightAllowed === false || s?.meta?.geceYasak === true),
      meta: s,
    });
  }
  return out;
}
function isEligible(person, row, year, month0, day, requireEligibility = true) {
  const wd = new Date(year, month0, day).getDay();
  if (person.weekendOff && (wd === 0 || wd === 6)) return false;
  if (!requireEligibility) return true;
  const keys = areaKeywords(row.label);
  if (person.areas?.size && !keys.some((k) => person.areas.has(U(k)))) return false;
  if (row.shiftCode && person.shiftCodes?.size && !person.shiftCodes.has(U(row.shiftCode))) return false;
  return true;
}

/* ========== Pins ========== */
function getPinsTree() { return readJSON(PINS_KEY, {}); }
function setPinsTree(tree) { writeJSON(PINS_KEY, tree); }
export function setRosterPin({ role = "Nurse", year, month0, rowId, day, personId }) {
  const ym = `${year}-${String(month0 + 1).padStart(2, "0")}`;
  const tree = getPinsTree(); const byRole = tree[role] || {}; const byYm = byRole[ym] || {};
  const byDay = byYm[day] || {}; const arr = Array.from(new Set([...(byDay[rowId] || []), String(personId)]));
  byDay[rowId] = arr; byYm[day] = byDay; byRole[ym] = byYm; tree[role] = byRole; setPinsTree(tree);
}
export function clearRosterPin({ role = "Nurse", year, month0, rowId, day, personId }) {
  const ym = `${year}-${String(month0 + 1).padStart(2, "0")}`;
  const tree = getPinsTree(); const byRole = tree[role] || {}; const byYm = byRole[ym] || {};
  const byDay = byYm[day] || {}; if (!byDay[rowId]) return;
  byDay[rowId] = personId ? (byDay[rowId] || []).filter((x) => String(x) !== String(personId)) : [];
  byYm[day] = byDay; byRole[ym] = byYm; tree[role] = byRole; setPinsTree(tree);
}

/* ========== Supervisor havuzu ========== */
function resolveIdLike(x, name2id) { if (x == null) return null; const s = String(x); return name2id.get(canonName(s)) || s; }
function loadSupervisorPoolIDs(name2id) {
  const raw = readJSON(SUP_POOL_KEY, []);
  const ids = new Set();
  for (const x of raw || []) { const id = resolveIdLike(x, name2id); if (id) ids.add(String(id)); }
  return ids;
}
function deriveSupervisorCandidates(staff) {
  const keyWords = ["SORUMLU", "SERVİS SORUMLUSU", "SÜPERVİZÖR", "SUPERVISOR", "SV"];
  return staff.filter((p) => {
    if (p.role && /sorumlu|supervis/i.test(p.role)) return true;
    for (const kw of keyWords) {
      if (p.areas?.has(kw) || p.shiftCodes?.has(kw)) return true;
      if (arrFromAny(p.meta?.skills).some((t) => U(t) === kw)) return true;
      if (arrFromAny(p.meta?.tags).some((t) => U(t) === kw)) return true;
    }
    return false;
  });
}
function readSupervisorConfig(name2id) {
  const cfg = readJSON(SUP_CFG_KEY, null) || {};
  const primaryId = resolveIdLike(cfg.primary, name2id) || null;
  const assistants = (cfg.assistants || []).map((x) => resolveIdLike(x, name2id)).filter(Boolean).map(String);
  const fallbackPool = (cfg.fallbackPool || []).map((x) => resolveIdLike(x, name2id)).filter(Boolean).map(String);
  const weekdayOnly = cfg.weekdayOnly !== false;
  const ensureAssistCount = Number(cfg.ensureAssistCount ?? 1) || 1;
  const toSet = (v) => {
    if (!v) return new Set();
    if (Array.isArray(v)) return new Set(v.map((n) => Number(n)));
    if (typeof v === "object") return new Set(Object.keys(v).map((k) => Number(k)));
    return new Set();
  };
  const assistDays = toSet(cfg.assistDays);
  const offDays = toSet(cfg.offDays);
  return { primaryId: primaryId ? String(primaryId) : null, assistants, fallbackPool, weekdayOnly, assistDays, offDays, ensureAssistCount };
}

/* ========== İhtiyaç matrisi ========== */
function buildRowNeedMatrix(rows, overrides, year, month0) {
  const dim = daysIn(year, month0);
  const byDay = {};
  for (const r of rows || []) {
    const base = Math.max(0, Number(r?.defaultCount || 0));
    const pat = Array.isArray(r?.pattern) && r.pattern.length === 7
      ? r.pattern.map((x) => Math.max(0, Number(x) || 0))
      : [base, base, base, base, base, base, base];
    const ovr = overrides?.[r.id] || {};
    for (let d = 1; d <= dim; d++) {
      const wd = new Date(year, month0, d).getDay();
      const pztIdx = (wd + 6) % 7;
      let v = ovr[d];
      if (v == null) v = pat[pztIdx] ?? base;
      if (r.weekendOff && (wd === 0 || wd === 6)) v = 0;
      v = Math.max(0, Number(v) || 0);
      if (!byDay[d]) byDay[d] = {};
      byDay[d][r.id] = v;
    }
  }
  return byDay;
}

/* ========== LEAVE okuma — her formatı, bulanık eşleşme ile ========== */
function scanLeavesCandidates() {
  const out = [];
  const prefer = ["leavesV2", "leaves", "topluIzin", "izinToplu", "leavesGrid", "leaveGrid", "toplu-izin-listesi"];
  prefer.forEach((k) => { const v = readJSON(k, null); if (v != null) out.push({ key: k, data: v }); });
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!/leave|izin/i.test(k)) continue;
    try { const v = JSON.parse(localStorage.getItem(k)); if (v != null) out.push({ key: k, data: v }); } catch {}
  }
  return out;
}
function dayFromKey(key) {
  const s = String(key);
  const all = s.match(/\d{1,2}/g);
  if (!all) return null;
  for (const tok of all) {
    const n = Number(tok);
    if (n >= 1 && n <= 31) return n;
  }
  return null;
}
function isLeaveCell(v) {
  if (v == null) return false;
  const s = String(v).trim();
  if (s === "" || s === "0") return false;
  const low = s.toLocaleLowerCase("tr-TR");
  if (["hayır", "hayir", "no"].includes(low)) return false;
  return true;
}
function mergeIdx(dst, src) {
  for (const k of Object.keys(src || {})) {
    dst[k] = dst[k] || {};
    for (const ym of Object.keys(src[k])) {
      dst[k][ym] = Object.assign(dst[k][ym] || {}, src[k][ym]);
    }
  }
  return dst;
}

function buildLeaveIndexFromAny(cands, { year, month0, staff }) {
  const ym = `${year}-${String(month0 + 1).padStart(2, "0")}`;
  const byId = {};
  const byCanon = {};

  const canon2id = new Map();
  const lastNameMap = new Map(); // soyad→tekil id ise
  for (const p of staff) {
    canon2id.set(p.nameCanon, p.id);
    const t = tokens(p.nameCanon);
    const last = t[t.length - 1];
    if (last) {
      const arr = lastNameMap.get(last) || [];
      arr.push(p.id);
      lastNameMap.set(last, arr);
    }
    if (p.code) canon2id.set(canonName(p.code), p.id);
  }

  const putId = (pid, d) => {
    if (!pid || !d) return;
    byId[pid] = byId[pid] || {};
    byId[pid][ym] = byId[pid][ym] || {};
    byId[pid][ym][String(d)] = true;
  };
  const putCanon = (canon, d) => {
    if (!canon || !d) return;
    byCanon[canon] = byCanon[canon] || {};
    byCanon[canon][ym] = byCanon[canon][ym] || {};
    byCanon[canon][ym][String(d)] = true;
  };

  const tryResolveName = (raw) => {
    const c = canonName(raw);
    if (canon2id.has(c)) return { pid: canon2id.get(c), canon: c };
    const t = tokens(c);
    if (!t.length) return { pid: null, canon: c };
    // 1) ad+soyad ilk & son
    const guess1 = `${t[0]} ${t[t.length - 1]}`;
    if (canon2id.has(guess1)) return { pid: canon2id.get(guess1), canon: guess1 };
    // 2) sadece soyad tekilse
    const last = t[t.length - 1];
    const ids = lastNameMap.get(last);
    if (ids && ids.length === 1) return { pid: ids[0], canon: c };
    // 3) eşleşme yoksa kanonik isim olarak sakla
    return { pid: null, canon: c };
  };

  for (const { data } of cands) {
    // Tekil event listesi
    if (Array.isArray(data)) {
      const seemsEvents = data.some((x) => x && (x.personId != null || x.id != null || x.pid != null || x.personCode) && (x.date || (x.year && x.month && x.day)));
      if (seemsEvents) {
        for (const x of data) {
          const idRaw = x?.personId ?? x?.id ?? x?.pid ?? null;
          const codeRaw = x?.personCode || x?.code;
          const nameRaw = x?.personName || x?.name || x?.fullName || x?.["AD SOYAD"];
          let pid = idRaw ? String(idRaw) : null;
          if (!pid && (codeRaw || nameRaw)) {
            const c = codeRaw ? canonName(codeRaw) : canonName(nameRaw);
            pid = canon2id.get(c) || null;
          }
          let y, m1, d;
          if (x?.date) { const dt = new Date(x.date); if (!Number.isNaN(dt)) { y = dt.getFullYear(); m1 = dt.getMonth() + 1; d = dt.getDate(); } }
          else { y = Number(x.year); m1 = Number(x.month); d = Number(x.day); }
          if (y === year && m1 === (month0 + 1) && d) {
            if (pid) putId(pid, d);
            else if (nameRaw) putCanon(canonName(nameRaw), d);
          }
        }
        continue;
      }
      // Grid listesi
      if (data.length && typeof data[0] === "object") {
        for (const row of data) {
          const name = row.fullName || row.name || row["AD SOYAD"] || row.personName || row.employeeName || row.title;
          const code = row.code || row.personCode;
          const idRaw = row.id ?? row.pid ?? row.tc ?? row.tcNo;
          let pid = idRaw ? String(idRaw) : null;
          let canon = null;
          if (!pid && (name || code)) {
            const r = tryResolveName(code || name);
            pid = r.pid;
            canon = r.canon;
          }
          const daySources = [row, row.days || row.DAYS || row.gunler || null].filter((o) => o && typeof o === "object");
          for (const obj of daySources) {
            for (const k of Object.keys(obj)) {
              const d = dayFromKey(k);
              if (!d) continue;
              const val = obj[k];
              if (!isLeaveCell(val)) continue;
              if (pid) putId(pid, d);
              else if (canon || name) putCanon(canon || canonName(name), d);
            }
          }
        }
        continue;
      }
      // {rows:[...]} / {items:[...]} sarmalayıcı
      if (Array.isArray(data.rows) || Array.isArray(data.items)) {
        const inner = Array.isArray(data.rows) ? data.rows : data.items;
        const nested = buildLeaveIndexFromAny([{ data: inner }], { year, month0, staff });
        mergeIdx(byId, nested.byId);
        mergeIdx(byCanon, nested.byCanon);
        continue;
      }
    }
    // Obje tipleri
    if (data && typeof data === "object") {
      if (Array.isArray(data.rows) || Array.isArray(data.items)) {
        const inner = Array.isArray(data.rows) ? data.rows : data.items;
        const nested = buildLeaveIndexFromAny([{ data: inner }], { year, month0, staff });
        mergeIdx(byId, nested.byId);
        mergeIdx(byCanon, nested.byCanon);
      } else {
        const vals = Object.values(data);
        if (vals.length && typeof vals[0] === "object") {
          const nested = buildLeaveIndexFromAny([{ data: vals }], { year, month0, staff });
          mergeIdx(byId, nested.byId);
          mergeIdx(byCanon, nested.byCanon);
        }
      }
    }
  }

  try {
    console.info("[leaves] merged", { ym, byId: Object.keys(byId).length, byCanon: Object.keys(byCanon).length });
  } catch {}
  return { byId, byCanon };
}

/* ========== Ana motor ========== */
/**
 * leavePolicy: "hard" | "soft" | "ignore"
 * forcePins:   true => pin izin/uygunluk kısıtlarını ezer
 * requireEligibility: true => alan + vardiya kodu uyumu gerekli
 */
export function generateRoster({
  year, month0, role = "Nurse", rows, overrides,
  leavePolicy = "hard", forcePins = true, requireEligibility = true,
}) {
  const ym = `${year}-${String(month0 + 1).padStart(2, "0")}`;
  const rng = mulberry32(year * 100 + (month0 + 1));

  // 1) staff
  const staffRaw = readJSON(STAFF_KEY, []);
  const staff = buildStaffIndex(staffRaw);
  const id2person = new Map(staff.map((p) => [p.id, p]));
  const canon2person = new Map(staff.map((p) => [p.nameCanon, p]));

  // 2) LEAVES
  const leaves = buildLeaveIndexFromAny(scanLeavesCandidates(), { year, month0, staff });
  try {
    const extra = getAllLeaves() || {};
    const extraByName = readJSON("allLeavesByNameV1", {}) || {};
    const suppress = getLeaveSuppress() || { ids: {}, canon: {} };
    const ymKey = `${year}-${String(month0 + 1).padStart(2, "0")}`;
    for (const [pidRaw, byYm] of Object.entries(extra)) {
      const monthObj = byYm?.[ymKey];
      if (!monthObj) continue;
      const pid = String(pidRaw);
      const person = id2person.get(pid);
      const canon = person?.nameCanon;
      for (const [k, rec] of Object.entries(monthObj || {})) {
        let d = NaN;
        if (/^\d{4}-\d{2}-\d{2}$/.test(k)) d = parseInt(k.slice(8, 10), 10);
        else d = parseInt(k, 10);
        if (!Number.isFinite(d) || d < 1 || d > 31) continue;
        if (suppress.ids?.[pid]?.[ymKey]?.[String(d)]) continue;
        leaves.byId[pid] ??= {};
        leaves.byId[pid][ymKey] ??= {};
        leaves.byId[pid][ymKey][String(d)] = true;
        if (canon) {
          leaves.byCanon[canon] ??= {};
          leaves.byCanon[canon][ymKey] ??= {};
          leaves.byCanon[canon][ymKey][String(d)] = true;
        }
      }
    }
    for (const [canonKey, byYm] of Object.entries(extraByName)) {
      const monthObj = byYm?.[ymKey];
      if (!monthObj) continue;
      const canon = canonName(canonKey);
      for (const [k, rec] of Object.entries(monthObj || {})) {
        let d = NaN;
        if (/^\d{4}-\d{2}-\d{2}$/.test(k)) d = parseInt(k.slice(8, 10), 10);
        else d = parseInt(k, 10);
        if (!Number.isFinite(d) || d < 1 || d > 31) continue;
        if (suppress.canon?.[canon]?.[ymKey]?.[String(d)]) continue;
        leaves.byCanon[canon] ??= {};
        leaves.byCanon[canon][ymKey] ??= {};
        leaves.byCanon[canon][ymKey][String(d)] = true;
      }
    }
  } catch (err) {
    console.warn("[roster] merge allLeaves fallback failed:", err);
  }
  const isOnLeave = (person, d) => {
    const pid = person.id;
    const canon = person.nameCanon;
    return !!(leaves.byId?.[pid]?.[ym]?.[String(d)] || leaves.byCanon?.[canon]?.[ym]?.[String(d)]);
  };

  // 3) Pins
  const pinsTree = readJSON(PINS_KEY, {});
  const pins = (pinsTree?.[role]?.[ym]) || {};

  // 4) Supervisor config + pool
  const supCfgRaw = readJSON(SUP_CFG_KEY, {}) || {};
  const name2idCanon = new Map(staff.map((p) => [p.nameCanon, p.id]));
  const resolveIdLike = (x) => (x == null ? null : (name2idCanon.get(canonName(x)) || String(x)));
  const supCfg = {
    primaryId: resolveIdLike(supCfgRaw.primary),
    assistants: (supCfgRaw.assistants || []).map(resolveIdLike).filter(Boolean).map(String),
    fallbackPool: (supCfgRaw.fallbackPool || []).map(resolveIdLike).filter(Boolean).map(String),
    weekdayOnly: supCfgRaw.weekdayOnly !== false,
    ensureAssistCount: Number(supCfgRaw.ensureAssistCount ?? 1) || 1,
    assistDays: new Set(Array.isArray(supCfgRaw.assistDays) ? supCfgRaw.assistDays.map(Number) :
      (supCfgRaw.assistDays && typeof supCfgRaw.assistDays === "object" ? Object.keys(supCfgRaw.assistDays).map(Number) : [])),
    offDays: new Set(Array.isArray(supCfgRaw.offDays) ? supCfgRaw.offDays.map(Number) :
      (supCfgRaw.offDays && typeof supCfgRaw.offDays === "object" ? Object.keys(supCfgRaw.offDays).map(Number) : [])),
  };

  const supPoolFromLS = loadSupervisorPoolIDs(new Map(staff.map((p) => [p.nameCanon, p.id])));
  let supPool = Array.from(supPoolFromLS).map((id) => id2person.get(id)).filter(Boolean);
  if (!supPool.length) supPool = deriveSupervisorCandidates(staff);
  const supUseCount = Object.fromEntries(staff.map((p) => [p.id, 0]));

  // 5) need
  const needByDay = buildRowNeedMatrix(rows, overrides, year, month0);
  const dim = daysIn(year, month0);

  const namedAssignments = {};
  const issues = [];

  for (let d = 1; d <= dim; d++) {
    namedAssignments[d] = {};
    const usedToday = new Set();
    const jsDay = new Date(year, month0, d).getDay();
    const isWeekend = (jsDay === 0 || jsDay === 6);

    /* --- Servis Sorumlusu --- */
    for (const r of (rows || [])) {
      const labelU = U(r?.label || "");
      if (!labelU.includes("SERVİS SORUMLUSU")) continue;

      const need0 = needByDay[d]?.[r.id] || 0;
      let need = need0;

      if (supCfg.weekdayOnly && isWeekend) { namedAssignments[d][r.id] = []; continue; }
      if (supCfg.assistDays.has(d)) {
        const minAssist = Math.max(0, Number(supCfg.ensureAssistCount || 1));
        need = Math.max(need0, 1 + minAssist);
      }

      const names = [];
      const addIfOk = (person) => {
        if (!person) return false;
        if (leavePolicy !== "ignore" && isOnLeave(person, d)) return false;
        if (!isEligible(person, r, year, month0, d, requireEligibility)) return false;
        if (usedToday.has(person.id)) return false;
        names.push(person.name);
        usedToday.add(person.id);
        supUseCount[person.id] = (supUseCount[person.id] || 0) + 1;
        return true;
      };

      // pins
      const pinIds = (pins?.[d]?.[r.id]) || [];
      for (const pid of pinIds) {
        const person = id2person.get(String(pid));
        if (!person) continue;
        if (!(leavePolicy === "ignore")) {
          if (isOnLeave(person, d)) continue;
          if (!isEligible(person, r, year, month0, d, requireEligibility)) continue;
        }
        if (usedToday.has(person.id)) continue;
        names.push(person.name);
        usedToday.add(person.id);
        supUseCount[person.id] = (supUseCount[person.id] || 0) + 1;
        if (names.length >= need) break;
      }

      // primary
      if (names.length < need && !supCfg.offDays.has(d) && supCfg.primaryId) {
        const p = id2person.get(supCfg.primaryId);
        if (p) addIfOk(p);
      }

      // assistants
      if (names.length < need) {
        for (const aid of supCfg.assistants) {
          const p = id2person.get(aid);
          if (!p) continue;
          if (addIfOk(p) && names.length >= need) break;
        }
      }

      // fallback pool
      if (names.length < need) {
        const poolIds = supCfg.fallbackPool.length ? supCfg.fallbackPool : supPool.map((pp) => pp.id);
        let candidates = poolIds
          .map((id) => id2person.get(id))
          .filter(Boolean)
          .filter((p) => !usedToday.has(p.id))
          .filter((p) => isEligible(p, r, year, month0, d, requireEligibility))
          .filter((p) => leavePolicy === "ignore" ? true : !isOnLeave(p, d));

        candidates.sort((a, b) => (supUseCount[a.id] - supUseCount[b.id]) || (rng() - 0.5));
        for (const c of candidates) { if (addIfOk(c) && names.length >= need) break; }
      }

      if (names.length < need) issues.push({ day: d, label: r.label, need, assigned: names.length, note: "Supervisor aday yok" });
      namedAssignments[d][r.id] = names;
    }

    /* --- Diğer satırlar --- */
    for (const r of (rows || [])) {
      const labelU = U(r?.label || "");
      if (labelU.includes("SERVİS SORUMLUSU")) continue;

      const need = needByDay[d]?.[r.id] || 0;
      if (need <= 0) { namedAssignments[d][r.id] = []; continue; }

      const chosen = [];

      // pins
      const pinIds = (pins?.[d]?.[r.id]) || [];
      for (const pid of pinIds) {
        const person = id2person.get(String(pid));
        if (!person) continue;
        if (!(leavePolicy === "ignore")) {
          if (isOnLeave(person, d)) continue;
          if (!isEligible(person, r, year, month0, d, requireEligibility)) continue;
        }
        if (usedToday.has(person.id)) continue;
        chosen.push(person.name);
        usedToday.add(person.id);
        if (chosen.length >= need) break;
      }

      // havuz
      let pool = staff
        .filter((p) => !usedToday.has(p.id))
        .filter((p) => isEligible(p, r, year, month0, d, requireEligibility))
        .filter((p) => leavePolicy === "ignore" ? true : !isOnLeave(p, d));

      // gece üstüne gece yok
      const isNightToday = NIGHT.has(U(r?.shiftCode || ""));
      if (isNightToday && d > 1) {
        const prev = namedAssignments[d - 1] || {};
        const prevNightCanon = new Set();
        for (const rr of (rows || [])) {
          if (!NIGHT.has(U(rr?.shiftCode || ""))) continue;
          for (const nm of (prev[rr.id] || [])) prevNightCanon.add(canonName(nm));
        }
        pool = pool.filter((p) => !prevNightCanon.has(p.nameCanon));
      }

      while (chosen.length < need && pool.length) {
        const idx = Math.floor(rng() * pool.length);
        const person = pool.splice(idx, 1)[0];
        chosen.push(person.name);
        usedToday.add(person.id);
      }

      if (chosen.length < need) issues.push({ day: d, label: r.label, need, assigned: chosen.length });
      namedAssignments[d][r.id] = chosen;
    }
  }

  return { namedAssignments, issues };
}
