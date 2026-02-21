// src/lib/solver.js

// Kurallar dosyasını içe al (ilerleyen adımlarda kullanacağız)
import {
  GENERAL_RULES,
  CUSTOM_RULES,
  SHIFT_RULES,
  LEAVE_RULES,
  AREA_SHIFT_MATRIX,
  SHIFT_CERT_REQUIREMENTS,
} from "./rules.js";
import { buildLeaveTargetRules } from "../utils/leaveTypeRules.js";

// 🔸 Local storage helper (DutyRulesTab ile aynı anahtar)
import { LS } from "../utils/storage.js";

/* ============================
   VARDİYA / NÖBET KURALLARI
============================ */
export const NIGHT_ROLE_NAME = "GECE";
export const DEFAULT_RULES = {
  // Kural 1: Aynı gün aynı kişiye en fazla X atama
  maxPerDayPerPerson: 1,

  // ardışık gece sınırı (arka arkaya geceyi yasakla / sınırla)
  maxConsecutiveNights: 1,

  // saat dengesi için hedef (aylık)
  targetMonthlyHours: 168,

  // yeni: haftalık saat limiti (opsiyonel; 0/undefined => devre dışı)
  weeklyHourLimit: 80,

  // yeni: gece/uzun vardiya sonrası ertesi gün 24s dinlenme (true/false)
  restAfterNight24h: true,

  // yeni: aynı saat çakışması yasağı (true/false) — pratikte hep true
  distinctTasksSameHour: true,
};

/* ============================ 
   Dinamik Kurallar (DutyRulesTab) Okuyucu
============================ */
function getActiveDutyRules() {
  const rules = LS.get("dutyRulesV2", []) || [];
  const map = Object.fromEntries(
    rules.filter((r) => r?.active).map((r) => [r.id, r.value])
  );

  return {
    maxPerDayPerPerson:
      Number(map.maxPerDayPerPerson ?? DEFAULT_RULES.maxPerDayPerPerson),
    maxConsecutiveNights:
      Number(map.maxConsecutiveNights ?? DEFAULT_RULES.maxConsecutiveNights),
    targetMonthlyHours:
      Number(map.targetMonthlyHours ?? DEFAULT_RULES.targetMonthlyHours),
    weeklyHourLimit:
      map.weeklyHourLimit === undefined
        ? DEFAULT_RULES.weeklyHourLimit
        : Number(map.weeklyHourLimit || 0),
    restAfterNight24h:
      map.restAfterNight24h === undefined
        ? DEFAULT_RULES.restAfterNight24h
        : Boolean(map.restAfterNight24h),
    distinctTasksSameHour:
      map.distinctTasksSameHour === undefined
        ? DEFAULT_RULES.distinctTasksSameHour
        : Boolean(map.distinctTasksSameHour),
  };
}

/* ============================ 
   YARDIMCI FONKSİYONLAR
============================ */
const norm = (s = "") =>
  s.toString().trim().replace(/\s+/g, " ").toUpperCase();

const buildUnavailableSet = (unavailable = []) => {
  const s = new Set();
  (unavailable || []).forEach(([pid, day]) => s.add(`${pid}|${day}`));
  return s;
};

// İzinleri kolay erişim için map'e çevir: key = `${pid}|${ymd}`
const buildLeaveMap = (leaves = []) => {
  const m = new Map();
  for (const lv of leaves || []) {
    if (!lv) continue;
    const key = `${String(lv.personId)}|${lv.day}`;
    m.set(key, lv);
  }
  return m;
};

/** "HH:MM" → dakika */
const timeToMin = (hhmm = "00:00") => {
  const [h, m] = (hhmm || "0:0").split(":").map((x) => parseInt(x || "0", 10));
  return (h % 24) * 60 + (m % 60);
};

/**
 * Bir vardiyanın (start,end) tek **gün içindeki** zaman aralıkları.
 * Geceye taşan (örn. 16:00–08:00) vardiya için **bugünkü** parça [start, 1440).
 */
const intervalsForShiftOnDay = (shiftDef) => {
  if (!shiftDef) return [];
  const s = timeToMin(shiftDef.start);
  const e = timeToMin(shiftDef.end);
  if (Number.isNaN(s) || Number.isNaN(e)) return [];
  if (e > s) return [[s, e]];
  if (e < s) return [[s, 1440]]; // ertesi güne taşar: bugünün kısmı
  return [[s, 1440]]; // 24 saatlik
};

/** [a1,a2) ile [b1,b2) aralıkları çakışıyor mu? */
const intervalsOverlap = (a1, a2, b1, b2) => Math.max(a1, b1) < Math.min(a2, b2);

/** Kural 1 ihlali (aynı gün aynı kişiye X'ten fazla) var mı? */
const violatesDayLimit = (assignByDay, day, personId, rules) => {
  const roleMap = assignByDay.get(day);
  if (!roleMap) return false;
  let count = 0;
  roleMap.forEach((arr) => {
    for (const pid of arr) if (pid === personId) count++;
  });
  return count >= (rules?.maxPerDayPerPerson ?? 1);
};

// YYYY-MM-DD ↔️ Date
const ymdToDate = (ymd) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const dateAddDays = (dt, n) => {
  const c = new Date(dt);
  c.setDate(c.getDate() + n);
  return c;
};
const isWeekendYmd = (ymd) => {
  const day = ymdToDate(ymd).getDay(); // 0: Pazar, 6: Cumartesi
  return day === 0 || day === 6;
};
const isWeekdayYmd = (ymd) => {
  const d = ymdToDate(ymd).getDay();
  return d >= 1 && d <= 5;
};

// shiftIndex varsa onu, yoksa SHIFT_RULES'u kullan
const getShiftDef = (code, shiftIndex) =>
  (shiftIndex && shiftIndex[norm(code)]) ||
  SHIFT_RULES?.[norm(code)] ||
  SHIFT_RULES?.[code] ||
  null;

// Vardiya süresi (saat)
const hoursOfShiftCode = (code, shiftIndex) => {
  const def = getShiftDef(code, shiftIndex);
  if (!def) return 0;
  const s = timeToMin(def.start);
  const e = def.end === "00:00" ? 24 * 60 : timeToMin(def.end);
  return Math.max(0, (e > s ? e - s : (e === s ? 24 * 60 : 24 * 60 - s))) / 60;
};

// Vardiya “gece/uzun” mu? (ardışık gece kontrolü için)
const isNightish = (code, shiftIndex) => {
  const def = getShiftDef(code, shiftIndex);
  if (!def) return false;
  // Öncelik: kural dosyasında night:true işaretlenmişse
  if (def.night === true) return true;
  // Aksi halde: bitiş < başlangıç (geceye taşma) veya süre ≥ 16 saat
  const s = timeToMin(def.start);
  const e = timeToMin(def.end);
  if (e < s) return true;
  const durH = hoursOfShiftCode(code, shiftIndex);
  return durH >= 16;
};

// Kişinin bir önceki gün aldığı atama
const getPrevDayShiftForPerson = (assignments, personId, dayYmd) => {
  const prev = dateAddDays(ymdToDate(dayYmd), -1);
  const yyyy = prev.getFullYear();
  const mm = String(prev.getMonth() + 1).padStart(2, "0");
  const dd = String(prev.getDate()).padStart(2, "0");
  const prevYmd = `${yyyy}-${mm}-${dd}`;
  return assignments.find((a) => a.personId === personId && a.day === prevYmd) || null;
};

/* ------- Ardışık gece sayacı (bugünden geriye doğru) ------- */
const countConsecutiveNightsBefore = (assignments, personId, dayYmd, shiftIndex) => {
  let cnt = 0;
  let cur = ymdToDate(dayYmd);
  while (true) {
    cur = dateAddDays(cur, -1);
    const yyyy = cur.getFullYear();
    const mm = String(cur.getMonth() + 1).padStart(2, "0");
    const dd = String(cur.getDate()).padStart(2, "0");
    const ymd = `${yyyy}-${mm}-${dd}`;
    const a = assignments.find((x) => x.personId === personId && x.day === ymd);
    if (!a) break;
    if (isNightish(a.shiftCode, shiftIndex)) {
      cnt += 1;
    } else break;
  }
  return cnt;
};

/* ------- Haftalık saat limiti yardımcıları ------- */
const weekStartMonday = (d) => {
  const date = new Date(d);
  const day = date.getDay(); // 0..6 (Pazar..Cumartesi)
  const diff = (day === 0 ? -6 : 1) - day; // Pazartesiye çek
  return dateAddDays(date, diff);
};
const sameWeek = (aYmd, bYmd) => {
  const a0 = weekStartMonday(ymdToDate(aYmd));
  const b0 = weekStartMonday(ymdToDate(bYmd));
  return a0.toDateString() === b0.toDateString();
};
const weeklyHoursWith = (assignments, pidStr, dayYmd, addHrs = 0) => {
  let sum = addHrs;
  for (const a of assignments) {
    if (String(a.personId) !== String(pidStr)) continue;
    if (!sameWeek(a.day, dayYmd)) continue;
    sum += a.hours || 0;
  }
  return sum;
};

/* ============================
   SAAT DENGELİ COVERAGE ÇÖZÜCÜ
============================ */
export function solveHourBalanced({
  days,             // string[]  -> YYYY-MM-DD
  taskLines,        // {label, shiftCode, hours, defaultCount, counts{dnum->n}}[]
  people,           // {id, name, services?}[]
  unavailable,      // [personId, YYYY-MM-DD][]
  hardRules,        // override rules
  eligibleByLabel,  // { [label]: string[]personId }
  shiftIndex,       // { [norm(shiftCode)]: {start:"HH:MM", end:"HH:MM", night?:bool, restAfterHours?:number, nextDayAllowed?:string[], avoidNextDay?:string[] } }
  leaves,           // [{ personId, day:"YYYY-MM-DD", code:"Y|B|KN|AN|...", shiftCode?: "M|M4|..." , ... }]
  areaResolver,     // (opsiyonel) (roleLabel) => areaCode (örn: "YESIL")
  requestMatrix,    // isteklere bağlı yumuşak/sert kısıtlar
}) {
  // 🔸 Kurallar: DEFAULT + (DutyRulesTab/LS) + hardRules (en son gelen baskın)
  const uiRules = getActiveDutyRules();
  const rules = { ...DEFAULT_RULES, ...uiRules, ...(hardRules || {}) };
  const leaveTypes = LS.get("leaveTypesV2", []);
  const leaveRules = buildLeaveTargetRules(leaveTypes, LEAVE_RULES);

  const unavail = buildUnavailableSet(unavailable);
  const leaveMap = buildLeaveMap(leaves);
  const getLeave = (pidStr, ymd) => leaveMap.get(`${pidStr}|${ymd}`) || null;

  const personById = new Map((people || []).map((p) => [String(p.id), p]));
  const hoursByPerson = new Map((people || []).map((p) => [String(p.id), 0]));

  /* ===== (A) Kişiye özel aylık hedef saat ===== */
  const workdaySet = new Set(days.filter(isWeekdayYmd));
  const baseTarget = workdaySet.size * 8;

  // Kişi başı reduceMonthlyTarget toplama (yalnız plan günlerinde)
  const reduceByPerson = new Map((people || []).map(p => [String(p.id), 0]));
  for (const lv of leaves || []) {
    const pid = String(lv.personId);
    const lr = leaveRules?.[lv.code];
    const red = lr?.reduceMonthlyTarget || 0;
    if (red && workdaySet.has(lv.day)) {
      reduceByPerson.set(pid, (reduceByPerson.get(pid) || 0) + red);
    }
  }
  const targetByPerson = new Map((people || []).map(p => {
    const pid = String(p.id);
    return [pid, Math.max(0, baseTarget - (reduceByPerson.get(pid) || 0))];
  }));

  const requestAvoid =
    requestMatrix?.avoid instanceof Map ? requestMatrix.avoid : new Map();
  const requestPrefer =
    requestMatrix?.prefer instanceof Map ? requestMatrix.prefer : new Map();
  const requestAvoidCanon =
    requestMatrix?.avoidCanon instanceof Map ? requestMatrix.avoidCanon : new Map();
  const requestPreferCanon =
    requestMatrix?.preferCanon instanceof Map ? requestMatrix.preferCanon : new Map();
  const canonById =
    requestMatrix?.canonById instanceof Map ? requestMatrix.canonById : new Map();
  const matchesBucket = (bucket, shiftCode) => {
    if (!bucket) return false;
    if (bucket.all) return true;
    const set = bucket.shifts;
    if (!shiftCode) return Boolean(set?.size);
    const normShift = norm(shiftCode);
    return typeof set?.has === "function" ? set.has(normShift) : false;
  };
  const hasRequestAvoid = (pidStr, day, shiftCode) => {
    const key = `${pidStr}|${day}`;
    if (matchesBucket(requestAvoid.get(key), shiftCode)) return true;
    const variants = canonById.get(String(pidStr));
    if (variants && typeof variants[Symbol.iterator] === "function") {
      for (const variant of variants) {
        if (matchesBucket(requestAvoidCanon.get(`${variant}|${day}`), shiftCode)) {
          return true;
        }
      }
    }
    return false;
  };
  const requestPreferScore = (pidStr, day, shiftCode) => {
    let score = 0;
    const bucket = requestPrefer.get(`${pidStr}|${day}`);
    const computeScore = (b) => {
      if (!b) return 0;
      const base = Number(b.all || 0) || 0;
      if (!shiftCode) return base;
      const map = b.shifts;
      if (typeof map?.get === "function") {
        const val = map.get(norm(shiftCode));
        if (Number.isFinite(val) && val > 0) return base + Number(val);
      }
      return base;
    };
    score += computeScore(bucket);
    const variants = canonById.get(String(pidStr));
    const seenVariants = new Set();
    if (variants && typeof variants[Symbol.iterator] === "function") {
      for (const variant of variants) {
        if (seenVariants.has(variant)) continue;
        seenVariants.add(variant);
        score += computeScore(requestPreferCanon.get(`${variant}|${day}`));
      }
    }
    return score;
  };

  /* ===== (B) Yeşil Alan V1 kota sayaçları ===== */
  const areaDayCounts = new Map(); // key: `${day}|${area}|${shiftCode}` -> number
  const incAreaCount = (day, area, shift) => {
    const k = `${day}|${area}|${shift}`;
    areaDayCounts.set(k, (areaDayCounts.get(k) || 0) + 1);
  };
  const decAreaCount = (day, area, shift) => {
    const k = `${day}|${area}|${shift}`;
    const v = (areaDayCounts.get(k) || 0) - 1;
    if (v <= 0) areaDayCounts.delete(k); else areaDayCounts.set(k, v);
  };
  const getAreaCount = (day, area, shift) => areaDayCounts.get(`${day}|${area}|${shift}`) || 0;

  const canRespectGreenAreaQuota = (day, roleLabel, shiftCode) => {
    if (typeof areaResolver !== "function") return true; // alan bilinmiyorsa kota kontrolü pas
    const area = areaResolver(roleLabel);
    if (!area || area !== CUSTOM_RULES?.greenArea?.code) return true;
    if (shiftCode !== "V1") return true;
    const isWkend = isWeekendYmd(day);
    const quotas = isWkend ? CUSTOM_RULES.greenArea.quotas.weekend : CUSTOM_RULES.greenArea.quotas.weekday;
    const limit = quotas?.V1;
    if (!limit) return true;
    const used = getAreaCount(day, area, "V1");
    return used < limit;
  };

  // Çıktılar
  const assignments = [];
  const overrides = []; // soft kural istisna kayıtları

  // Gün -> (roleLabel -> personId[]), Kural 1 kontrolü için
  const assignByDay = new Map();

  const place = (day, roleLabel, shiftCode, personId, slotH) => {
    // Yeşil Alan sayacı
    if (typeof areaResolver === "function" && shiftCode === "V1") {
      const area = areaResolver(roleLabel);
      if (area === CUSTOM_RULES?.greenArea?.code) incAreaCount(day, area, "V1");
    }

    let roleMap = assignByDay.get(day);
    if (!roleMap) {
      roleMap = new Map();
      assignByDay.set(day, roleMap);
    }
    let arr = roleMap.get(roleLabel);
    if (!arr) {
      arr = [];
      roleMap.set(roleLabel, arr);
    }
    arr.push(personId);

    assignments.push({ day, roleLabel, shiftCode, personId, hours: slotH });
    hoursByPerson.set(
      String(personId),
      (hoursByPerson.get(String(personId)) || 0) + slotH
    );
  };

  const unplace = (day, roleLabel, shiftCode, personId, slotH) => {
    // Yeşil Alan sayacı geri al
    if (typeof areaResolver === "function" && shiftCode === "V1") {
      const area = areaResolver(roleLabel);
      if (area === CUSTOM_RULES?.greenArea?.code) decAreaCount(day, area, "V1");
    }

    const roleMap = assignByDay.get(day);
    if (roleMap) {
      const arr = roleMap.get(roleLabel);
      if (arr) {
        const idx = arr.lastIndexOf(personId);
        if (idx >= 0) arr.splice(idx, 1);
      }
    }
    const aIdx = assignments.findIndex(
      (a) =>
        a.day === day &&
        a.roleLabel === roleLabel &&
        a.personId === personId &&
        a.shiftCode === shiftCode
    );
    if (aIdx >= 0) assignments.splice(aIdx, 1);

    hoursByPerson.set(
      String(personId),
      Math.max(0, (hoursByPerson.get(String(personId)) || 0) - slotH)
    );
  };

  // Tüm slotları üret
  const slots = [];
  for (const day of days) {
    const dnum = Number(day.slice(-2)); // YYYY-MM-DD → DD
    for (const tl of taskLines || []) {
      const need = Math.max(0, tl?.counts?.[dnum] ?? tl?.defaultCount ?? 0);
      for (let i = 0; i < need; i++) {
        slots.push({
          day,
          roleLabel: tl.label,
          shiftCode: tl.shiftCode,
          hours: tl.hours || hoursOfShiftCode(tl.shiftCode, shiftIndex),
        });
      }
    }
  }

  // Zor slotlar önce: uygun kişi sayısı az olanlar
  const candidateCount = (s) => {
    const elig = eligibleByLabel?.[s.roleLabel] || [];
    return (elig || []).filter(
      (pid) =>
        !unavail.has(`${pid}|${s.day}`) &&
        !hasRequestAvoid(String(pid), s.day, s.shiftCode)
    ).length;
  };
  slots.sort((a, b) => candidateCount(a) - candidateCount(b));

  /* ------- Sert kural kontrolleri (tek kişi+slot düzeyinde) ------- */
  const violatesHard = ({ pidStr, day, roleLabel, shiftCode, slotH }) => {
    // Günlük limit
    if (violatesDayLimit(assignByDay, day, pidStr, rules)) return "Aynı gün limit";

    // Saat çakışması
    if (
      rules.distinctTasksSameHour &&
      (function checkOverlap() {
        const newDef = getShiftDef(shiftCode, shiftIndex);
        const newInts = intervalsForShiftOnDay(newDef);
        if (!newInts.length) return false;
        for (const a of assignments) {
          if (a.day !== day || String(a.personId) !== String(pidStr)) continue;
          const oldDef = getShiftDef(a.shiftCode, shiftIndex);
          const oldInts = intervalsForShiftOnDay(oldDef);
          for (const [ns, ne] of newInts) {
            for (const [os, oe] of oldInts) {
              if (intervalsOverlap(ns, ne, os, oe)) return true;
            }
          }
        }
        return false;
      })()
    ) {
      return "Saat çakışması";
    }

    // Haftasonu M4 yasak (örnek sert kural)
    if (shiftCode === "M4" && isWeekendYmd(day)) return "Haftasonu M4 yasak";

    // Haftalık saat limiti
    if (rules.weeklyHourLimit && rules.weeklyHourLimit > 0) {
      const wHrs = weeklyHoursWith(assignments, pidStr, day, slotH);
      if (wHrs > rules.weeklyHourLimit) return "Haftalık saat limiti";
    }

    // Önceki gün etkileri: dinlenme / nextDayAllowed / ardışık gece
    const prev = getPrevDayShiftForPerson(assignments, pidStr, day);
    if (prev && prev.shiftCode) {
      const prevDef = getShiftDef(prev.shiftCode, shiftIndex);

      // (A) Gece/uzun sonrası 24s dinlenme — iki kaynaktan:
      //  - Shift tanımı restAfterHours>=24 ise (vardiyaya özel)
      //  - Genel kural: restAfterNight24h && önceki vardiya nightish ise
      if ((prevDef?.restAfterHours || 0) >= 24) return "Gece/uzun sonrası 24s dinlenme";
      if (rules.restAfterNight24h && isNightish(prev.shiftCode, shiftIndex)) {
        return "Gece sonrası 24s dinlenme";
      }

      // (B) nextDayAllowed listesi varsa bugünkü vardiya orada olmalı
      if (prevDef?.nextDayAllowed && !prevDef.nextDayAllowed.includes(shiftCode))
        return "nextDayAllowed ihlali";
    }

    // (C) Ardışık gece sınırı
    if (isNightish(shiftCode, shiftIndex)) {
      const already = countConsecutiveNightsBefore(assignments, pidStr, day, shiftIndex);
      const maxN = Number(rules?.maxConsecutiveNights ?? 1);
      if (already >= (maxN - 1)) {
        if (already + 1 > maxN) return "Ardışık gece sınırı";
      }
    }

    // Yeşil Alan kotası sert (bu projede böyle kalsın)
    if (!canRespectGreenAreaQuota(day, roleLabel, shiftCode)) return "Yeşil alan kotası";

    return null;
  };

  /* ------- Aday sıralama: hedef saat dengesi, avoidNextDay, toplam saat ------- */
  const sortCandidates = (list, day, shiftCode) => {
    return [...list].sort((p1, p2) => {
      const h1 = hoursByPerson.get(String(p1)) || 0;
      const h2 = hoursByPerson.get(String(p2)) || 0;

      const t1 = targetByPerson.get(String(p1)) ?? baseTarget;
      const t2 = targetByPerson.get(String(p2)) ?? baseTarget;
      const d1 = t1 - h1;
      const d2 = t2 - h2;
      if (d1 !== d2) return d2 - d1;

      const pref1 = requestPreferScore(String(p1), day, shiftCode);
      const pref2 = requestPreferScore(String(p2), day, shiftCode);
      if (pref1 !== pref2) return pref2 - pref1;

      // avoidNextDay: sadece küçük bir penaltı (yumuşak)
      const prev1 = getPrevDayShiftForPerson(assignments, String(p1), day);
      const prev2 = getPrevDayShiftForPerson(assignments, String(p2), day);
      const avoidPenalty = (prevAssg) => {
        if (!prevAssg?.shiftCode) return 0;
        const prevDef = getShiftDef(prevAssg.shiftCode, shiftIndex);
        return prevDef?.avoidNextDay?.includes(shiftCode) ? 1 : 0;
      };
      const ap1 = avoidPenalty(prev1);
      const ap2 = avoidPenalty(prev2);
      if (ap1 !== ap2) return ap1 - ap2;

      // daha az toplam saat öne
      return h1 - h2;
    });
  };

  // DFS/backtracking yerleştirici — 2 PAS: (1) soft’a saygı, (2) soft’u yok say
  const tryAssign = (k) => {
    if (k >= slots.length) return true;

    const { day, roleLabel, shiftCode, hours: slotH } = slots[k];

    const eligAll = (eligibleByLabel?.[roleLabel] || [])
      .filter((pid) => !unavail.has(`${pid}|${day}`))
      .filter((pid) => !hasRequestAvoid(String(pid), day, shiftCode));

    // KN (Kesin Nöbet) önceliği — sadece aynı vardiya için zorunlu tut
    const knCandidates = [];
    for (const pid of eligAll) {
      const lv = getLeave(String(pid), day);
      if (lv?.code === "KN") {
        if (!lv.shiftCode || norm(lv.shiftCode) === norm(shiftCode)) {
          knCandidates.push(pid);
        }
      }
    }
    const baseElig = (knCandidates.length ? knCandidates : eligAll).filter(
      (pid) => !hasRequestAvoid(String(pid), day, shiftCode)
    );

    // 2 PAS mantığı
    const passes = [
      { ignoreSoft: false }, // pas-1: yumuşak istek/tercihlere saygı
      { ignoreSoft: true },  // pas-2: yumuşak istek/tercihleri yok say
    ];

    for (const { ignoreSoft } of passes) {
      // Adayları sırala
      const sorted = sortCandidates(baseElig, day, shiftCode);

      for (const pid of sorted) {
        const pidStr = String(pid);
        if (!personById.has(pidStr)) continue;
        if (hasRequestAvoid(pidStr, day, shiftCode)) continue;

        // LEAVE_RULES (sert/yumuşak ayrımı)
        const leave = getLeave(pidStr, day);
        if (leave) {
          const lr = leaveRules?.[leave.code];

          // AN: Ay sonu nöbeti → ayın 1'inde yazma (sert)
          if (lr?.specialCase === "noFirstDayOfMonthAfterPrevMonthLastNight") {
            if (day.endsWith("-01")) continue;
          }

          // KN: Bugün kesin yaz; shiftCode belirtilmişse, eşleşmeyen vardiyada yazma (sert)
          if (lr?.specialCase === "forceShiftToday") {
            if (leave.shiftCode && norm(leave.shiftCode) !== norm(shiftCode)) {
              continue;
            }
            // forceShiftToday, blocksShift'i bypass eder
          } else {
            // Sert engel
            if (lr?.blocksShift === true) {
              continue;
            }
            // Yumuşak engel (talep/boş gün isteği)
            if (lr?.blocksShiftSoft === true || lr?.soft === true) {
              if (!ignoreSoft) {
                // pas-1'de saygı duy
                continue;
              } else {
                // pas-2'de yok say ve override kaydet
                overrides.push({
                  day,
                  personId: pidStr,
                  reason: `Soft izin/talep (${leave.code}) yok sayıldı`,
                  shiftCode,
                  roleLabel,
                });
              }
            }
          }
        }

        // SERT kurallar
        const hardFail = violatesHard({ pidStr, day, roleLabel, shiftCode, slotH });
        if (hardFail) continue;

        // Deneyip yerleştir
        place(day, roleLabel, shiftCode, pidStr, slotH);
        if (tryAssign(k + 1)) return true;
        unplace(day, roleLabel, shiftCode, pidStr, slotH);
      }
      // pas-1'de kimse yoksa pas-2'ye geç; pas-2'de de yoksa geri
    }

    // Bu slot için kimse bulunamadı → geri dön
    return false;
  };

  const ok = tryAssign(0);
  return ok ? { assignments, hoursByPerson, overrides } : { assignments: [], hoursByPerson, overrides };
}
