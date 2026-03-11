// src/engine/rosterEngine.js
import { getAllLeaves } from "../lib/leaves.js";

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
function isServiceSupervisorLabel(label = "") {
  return stripDiacritics(U(label)).includes("SERVIS SORUMLU");
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

/* ========== LEAVE okuma — tek kaynak: getAllLeaves() ========== */
function buildLeaveIndexFromStore({ year, month0, staff }) {
  const ym = `${year}-${String(month0 + 1).padStart(2, "0")}`;
  const byId = {};
  const byCanon = {};

  const canon2id = new Map();
  for (const p of staff) {
    canon2id.set(p.nameCanon, p.id);
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

  const store = getAllLeaves() || {};
  for (const [pidRaw, byYm] of Object.entries(store)) {
    const monthObj = byYm?.[ym];
    if (!monthObj || typeof monthObj !== "object") continue;
    const pid = String(pidRaw);
    const person = staff.find((p) => p.id === pid) || null;
    const canon = person?.nameCanon || null;
    for (const key of Object.keys(monthObj || {})) {
      let day = NaN;
      if (/^\d{4}-\d{2}-\d{2}$/.test(key)) day = Number(key.slice(8, 10));
      else day = Number(key);
      if (!Number.isFinite(day) || day < 1 || day > 31) continue;
      putId(pid, day);
      if (canon) putCanon(canon, day);
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
  leavePolicy = "hard", forcePins = true, requireEligibility = true, pins: explicitPins = [],
}) {
  const ym = `${year}-${String(month0 + 1).padStart(2, "0")}`;
  const rng = mulberry32(year * 100 + (month0 + 1));

  // 1) staff
  const staffRaw = readJSON(STAFF_KEY, []);
  const staff = buildStaffIndex(staffRaw);
  const id2person = new Map(staff.map((p) => [p.id, p]));
  const canon2person = new Map(staff.map((p) => [p.nameCanon, p]));

  // 2) LEAVES (tek kaynak)
  const leaves = buildLeaveIndexFromStore({ year, month0, staff });
  const isOnLeave = (person, d) => {
    const pid = person.id;
    const canon = person.nameCanon;
    return !!(leaves.byId?.[pid]?.[ym]?.[String(d)] || leaves.byCanon?.[canon]?.[ym]?.[String(d)]);
  };

  // 3) Pins
  let pins = {};
  if (explicitPins && explicitPins.length > 0) {
    // DutyRowsEditor'den gelen array formatını { [day]: { [rowId]: [pid] } } formatına çevir
    for (const p of explicitPins) {
      const d = p.dayNum;
      const rid = p.rowId;
      const pid = p.personId;
      if (!pins[d]) pins[d] = {};
      if (!pins[d][rid]) pins[d][rid] = [];
      pins[d][rid].push(pid);
    }
  } else {
    const pinsTree = readJSON(PINS_KEY, {});
    pins = (pinsTree?.[role]?.[ym]) || {};
  }

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
      if (!isServiceSupervisorLabel(labelU)) continue;

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
      if (isServiceSupervisorLabel(labelU)) continue;

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
