// src/lib/runPlannerOnce.js
import * as XLSX from "xlsx";
import { buildMonthDays, fmtYmd, shiftDurationHours } from "../utils/date.js";
import { DEFAULT_RULES, solveHourBalanced } from "./solver.js";
import { leavesToUnavailable } from "./leaves.js";
import { collectRequestsByPerson } from "./requestParser.js";

/* Yardımcılar: (PlanTab’dekilerin birebir kopyası, bağımsız çalışsın diye) */
const norm = (s = "") => s.toString().trim().replace(/\s+/g, " ").toUpperCase();
const normTR = (s = "") => s.toString().trim().replace(/\s+/g, " ").toLocaleUpperCase("tr-TR");
const SPLIT_RE = /[,/;|]+/;
const matchesRequestBucket = (bucket, shiftCode) => {
  if (!bucket) return false;
  if (bucket.all) return true;
  const shifts = bucket.shifts;
  if (!shiftCode) return Boolean(shifts?.size);
  const normShift = norm(shiftCode);
  return typeof shifts?.has === "function" ? shifts.has(normShift) : false;
};
const hasRequestAvoid = (requestAvoidById, requestAvoidByCanon, canonById, pid, day, shiftCode) => {
  if (!(requestAvoidById instanceof Map) && !(requestAvoidByCanon instanceof Map)) return false;
  const key = `${String(pid)}|${day}`;
  if (requestAvoidById instanceof Map) {
    const bucket = requestAvoidById.get(key);
    if (matchesRequestBucket(bucket, shiftCode)) return true;
  }
  if (requestAvoidByCanon instanceof Map && canonById instanceof Map) {
    const variants = canonById.get(String(pid));
    if (variants && typeof variants[Symbol.iterator] === "function") {
      for (const variant of variants) {
        const bucket = requestAvoidByCanon.get(`${variant}|${day}`);
        if (matchesRequestBucket(bucket, shiftCode)) return true;
      }
    }
  }
  return false;
};
const stripDiacritics = (str = "") =>
  str
    .toString()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
const canonName = (s = "") =>
  stripDiacritics(s || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleUpperCase("tr-TR");
const buildCanonVariants = (raw) => {
  const source = (raw ?? "").toString();
  const variants = new Set();
  const collect = (val) => {
    const cn = canonName(val);
    if (cn) variants.add(cn);
  };
  collect(source);
  const separators = ["—", "-", "|", "/", "(", ")"];
  const queue = [source];
  for (const text of queue) {
    for (const sep of separators) {
      if (!text.includes(sep)) continue;
      const parts = text.split(sep);
      parts.forEach((p) => {
        const piece = p.trim();
        if (piece && !queue.includes(piece)) queue.push(piece);
      });
    }
  }
  queue.forEach(collect);
  return Array.from(variants);
};

const registerCanon = (map, raw, idStr, canonById) => {
  for (const variant of buildCanonVariants(raw)) {
    if (!variant) continue;
    if (!map.has(variant)) map.set(variant, new Set());
    map.get(variant).add(idStr);
    if (canonById) {
      if (!canonById.has(idStr)) canonById.set(idStr, new Set());
      canonById.get(idStr).add(variant);
    }
  }
};
const pickPersonName = (person) => {
  const alternatives = [
    person?.fullName,
    person?.name,
    person?.displayName,
    person?.personName,
    [person?.firstName, person?.lastName].filter(Boolean).join(" "),
    person?.["Ad Soyad"],
    person?.["AD SOYAD"],
    person?.["ad soyad"],
  ];
  for (const cand of alternatives) {
    if (!cand) continue;
    const str = String(cand).trim();
    if (str) return str;
  }
  return "";
};

/* === GÜNLÜK LİMİT === */
function enforceDailyCap(assignments, cap = 1) {
  const limit = Math.max(1, Number(cap) || 1);
  if (!Array.isArray(assignments) || !assignments.length) return { assignments: [], removed: [] };
  const byDay = new Map();
  assignments.forEach((a, i) => {
    a.__i = i;
    const dm = byDay.get(a.day) || new Map();
    const k = String(a.personId);
    const arr = dm.get(k) || [];
    arr.push(a);
    dm.set(k, arr);
    byDay.set(a.day, dm);
  });
  const keep = new Set(assignments.map((_,i)=>i));
  const removed = [];
  for (const [, dm] of byDay) {
    for (const [, arr] of dm) {
      if (arr.length > limit) {
        arr.sort((x,y)=>x.__i - y.__i).slice(limit).forEach(ex => {
          keep.delete(ex.__i);
          removed.push({ ...ex });
        });
      }
    }
  }
  const filtered = assignments.filter((a,i)=>keep.has(i)).map(({__i, ...r})=>r);
  return { assignments: filtered, removed };
}

/* === Dinlenme / ertesi gün yasağı === */
const timeToMin = (hhmm="00:00") => {
  const [h,m] = (hhmm||"0:0").split(":").map(x=>parseInt(x||"0",10));
  return (h%24)*60 + (m%60);
};
const intervalsForShiftOnDay = (def) => {
  if (!def) return [];
  const s=timeToMin(def.start), e=timeToMin(def.end);
  if (Number.isNaN(s)||Number.isNaN(e)) return [];
  if (e===s) return [[0,1440]];
  if (e>s) return [[s,e]];
  return [[s,1440]];
};
const intervalsOverlap = (a1,a2,b1,b2) => Math.max(a1,b1) < Math.min(a2,b2);

const prevOf = (ymd) => {
  const [y,m,d]=ymd.split("-").map(Number); const dt=new Date(y,m-1,d);
  dt.setDate(dt.getDate()-1); return fmtYmd(dt);
};
const nextOf = (ymd) => {
  const [y,m,d]=ymd.split("-").map(Number); const dt=new Date(y,m-1,d);
  dt.setDate(dt.getDate()+1); return fmtYmd(dt);
};
const includesCode = (arr, code) => (arr||[]).some(c=>norm(c)===norm(code));

const forbidsNextDay = (shiftCode, shiftIndex) => {
  const def = shiftIndex?.[norm(shiftCode)];
  const is24h = def && timeToMin(def.start) === timeToMin(def.end);
  if ((def?.restAfterHours||0) >= 24) return true;
  if (is24h) return true;
  const codeN = norm(shiftCode);
  if (codeN==="N" || codeN==="V2") return true;
  return false;
};

function enforceNextDayRest(assignments, shiftIndex) {
  if (!Array.isArray(assignments) || !assignments.length) return { assignments: [], removed: [] };
  const ban = new Set();
  for (const a of assignments) {
    if (forbidsNextDay(a.shiftCode, shiftIndex)) ban.add(`${a.personId}|${nextOf(a.day)}`);
  }
  const kept=[], removed=[];
  for (const a of assignments) {
    const banned = ban.has(`${a.personId}|${a.day}`);
    if (banned) removed.push({ ...a }); else kept.push(a);
  }
  return { assignments: kept, removed };
}

/* Sonradan onarım (cap sonrası açık slotları doldur) */
function repairAfterCap({
  assignments, taskLines, year, month, daysInMonth, staff,
  eligibleByLabel, unavailableSet, requestAvoid, requestAvoidCanon, canonById,
  rules, hoursOfShiftCode, shiftIndex,
}) {
  const needByKey = new Map();
  for (let d=1; d<=daysInMonth; d++) {
    const day = fmtYmd(new Date(year, month, d));
    for (const tl of taskLines) {
      const need = Number.isFinite(tl?.counts?.[d]) ? tl.counts[d] : (tl.defaultCount||0);
      if (need>0) needByKey.set(`${day}|${tl.label}|${tl.shiftCode}`, need);
    }
  }
  const haveByKey = new Map();
  for (const a of assignments) {
    const k = `${a.day}|${a.roleLabel}|${a.shiftCode}`;
    haveByKey.set(k, (haveByKey.get(k)||0)+1);
  }
  const hoursByPerson = new Map();
  for (const a of assignments) {
    hoursByPerson.set(a.personId, (hoursByPerson.get(a.personId)||0)+(hoursOfShiftCode(a.shiftCode)||0));
  }
  const dayPersonCount = new Map();
  for (const a of assignments) {
    const k = `${a.day}|${a.personId}`;
    dayPersonCount.set(k, (dayPersonCount.get(k)||0)+1);
  }
  const isNight = (label) => norm(label)==="GECE";
  const days = Array.from(new Set([...needByKey.keys()].map(k=>k.split("|")[0]))).sort();

  for (const day of days) {
    for (const tl of taskLines) {
      const key = `${day}|${tl.label}|${tl.shiftCode}`;
      const need = needByKey.get(key)||0;
      let have = haveByKey.get(key)||0;
      if (have>=need) continue;

      const slotH = hoursOfShiftCode(tl.shiftCode)||0;
      const eligList = (eligibleByLabel?.[tl.label]||[])
        .filter(pid => !unavailableSet.has(`${pid}|${day}`))
        .filter(pid => !hasRequestAvoid(requestAvoid, requestAvoidCanon, canonById, pid, day, tl.shiftCode));

      const target = Math.max(0, rules?.targetMonthlyHours || 168);
      const sorted = [...eligList].sort((p1,p2)=>{
        const d1 = target - (hoursByPerson.get(String(p1))||0);
        const d2 = target - (hoursByPerson.get(String(p2))||0);
        return d2 - d1;
      });

      for (const pidRaw of sorted) {
        if (have>=need) break;
        const pid = String(pidRaw);

        const dayKey = `${day}|${pid}`;
        const dayCount = dayPersonCount.get(dayKey)||0;
        if (dayCount >= (rules?.maxPerDayPerPerson ?? 1)) continue;

        const hasSameLineAlready = assignments.some(
          a => a.day===day && a.personId===pid && a.roleLabel===tl.label && a.shiftCode===tl.shiftCode
        );
        if (hasSameLineAlready) continue;

        const defNew = shiftIndex?.[norm(tl.shiftCode)];
        const newIntervals = intervalsForShiftOnDay(defNew);
        const overlaps = assignments.some(a=>{
          if (a.day!==day || String(a.personId)!==pid) return false;
          const defOld = shiftIndex?.[norm(a.shiftCode)];
          const oldIntervals = intervalsForShiftOnDay(defOld);
          for (const [ns,ne] of newIntervals) for (const [os,oe] of oldIntervals) {
            if (intervalsOverlap(ns,ne,os,oe)) return true;
          }
          return false;
        });
        if (overlaps) continue;

        const prevYmd = prevOf(day);
        const yesterdays = assignments.filter(a=>a.personId===pid && a.day===prevYmd);
        let blocked=false;
        for (const pa of yesterdays) {
          const pDef = shiftIndex?.[norm(pa.shiftCode)];
          if (forbidsNextDay(pa.shiftCode, shiftIndex)) { blocked=true; break; }
          if (Array.isArray(pDef?.nextDayAllowed)) {
            if (!includesCode(pDef.nextDayAllowed, tl.shiftCode)) { blocked=true; break; }
          }
        }
        if (blocked) continue;

        if (isNight(tl.label) && (rules?.maxConsecutiveNights ?? 2) >= 0) {
          const daysSorted = [...days].sort();
          const idx = daysSorted.indexOf(day);
          let consec = 1;
          for (let i=idx-1; i>=0; i--) {
            const dPrev = daysSorted[i];
            const hadPrevNight = assignments.some(a=>String(a.personId)===pid && a.day===dPrev && isNight(a.roleLabel));
            if (hadPrevNight) consec++; else break;
          }
          if (consec > (rules?.maxConsecutiveNights ?? 2)) continue;
        }

        assignments.push({ day, roleLabel: tl.label, shiftCode: tl.shiftCode, personId: pid, hours: slotH });
        have++; haveByKey.set(key, have);
        dayPersonCount.set(dayKey, dayCount+1);
        hoursByPerson.set(pid, (hoursByPerson.get(pid)||0)+slotH);
      }
    }
  }
  return assignments;
}

function recomputeHoursByPerson(assignments, hoursOfShiftCode) {
  const map=new Map();
  for (const a of assignments||[]) {
    const id=String(a.personId);
    const h=hoursOfShiftCode(a.shiftCode)||0;
    map.set(id,(map.get(id)||0)+h);
  }
  return map;
}

/* === Dışa aktar yardımcıları === */
const dayNameTR = (y,m,d) => ["Paz","Pzt","Sal","Çar","Per","Cum","Cmt"][new Date(y,m,d).getDay()] || "";

/** Planner artık dışarıdan veri alır (localStorage okuma yok). */
export async function runPlannerOnce({
  year: yearParam,
  month: monthParam,
  activeServiceId,
  activeRole,
  nurses,
  doctors,
  workingHours: workingHoursParam,
  personLeaves: personLeavesParam,
  taskLines: taskLinesParam,
  dpRules: dpRulesParam,
}) {
  const now = new Date();
  const yearVal = Number.isFinite(Number(yearParam)) ? Number(yearParam) : now.getFullYear();
  const monthNumRaw = Number.isFinite(Number(monthParam)) ? Number(monthParam) : now.getMonth();
  const monthVal = Math.min(11, Math.max(0, Math.trunc(monthNumRaw)));

  const year = yearVal;
  const month0 = monthVal;
  const month = month0;

  const { daysInMonth } = buildMonthDays(year, month0);
  const days = Array.from({ length: daysInMonth }, (_, i) => fmtYmd(new Date(year, month0, i + 1)));

  const roleKey = norm(activeRole || "NURSE");
  const staffAll = roleKey === "DOCTOR" ? (doctors || []) : (nurses || []);
  const workingHours = Array.isArray(workingHoursParam) ? workingHoursParam : [];
  const personLeaves = personLeavesParam && typeof personLeavesParam === "object" ? personLeavesParam : {};
  const taskLines = Array.isArray(taskLinesParam) ? taskLinesParam : [];
  const dpRules = dpRulesParam || DEFAULT_RULES;
  const staff = (staffAll||[]).filter(p => !activeServiceId || p.service===activeServiceId);

  if (!activeServiceId) throw new Error("Önce bir servis seçin.");
  if (!workingHours?.length) throw new Error("Önce Çalışma Saatleri tanımlayın.");
  if (!taskLines?.length) throw new Error("Önce en az bir Görev Satırı ekleyin.");
  if (!staff?.length) throw new Error("Seçilen rol için personel bulunamadı.");

  const month1 = month + 1;
  const staffById = new Map();
  const staffByCanon = new Map();
  const canonById = new Map();
  (staff || []).forEach((person) => {
    if (!person) return;
    const idStr = String(person.id);
    staffById.set(idStr, person);
    const name = pickPersonName(person);
    registerCanon(staffByCanon, name, idStr, canonById);
    registerCanon(staffByCanon, person?.fullName, idStr, canonById);
    registerCanon(staffByCanon, person?.displayName, idStr, canonById);
    registerCanon(staffByCanon, person?.personName, idStr, canonById);
    registerCanon(staffByCanon, person?.code, idStr, canonById);
    registerCanon(staffByCanon, person?.kod, idStr, canonById);
    registerCanon(staffByCanon, person?.personCode, idStr, canonById);
  });

  const requestAvoid = new Map();
  const requestPrefer = new Map();
  const requestAvoidCanon = new Map();
  const requestPreferCanon = new Map();
  const requestSummary = { avoid: [], prefer: [] };
  const seenAvoidSummary = new Set();
  const seenPreferSummary = new Set();
  const ensureAvoidBucket = (store, key) => {
    if (!store.has(key)) store.set(key, { all: false, shifts: new Set() });
    return store.get(key);
  };
  const ensurePreferBucket = (store, key) => {
    if (!store.has(key)) store.set(key, { all: 0, shifts: new Map() });
    return store.get(key);
  };
  const addAvoidForKey = (store, key, shiftNorm) => {
    const bucket = ensureAvoidBucket(store, key);
    if (!shiftNorm) bucket.all = true;
    else bucket.shifts.add(shiftNorm);
  };
  const addPreferForKey = (store, key, shiftNorm, weight = 1) => {
    const bucket = ensurePreferBucket(store, key);
    if (!shiftNorm) bucket.all = (bucket.all || 0) + weight;
    else bucket.shifts.set(shiftNorm, (bucket.shifts.get(shiftNorm) || 0) + weight);
  };
  const addAvoid = ({ pid, day, shiftNorm, meta }) => {
    addAvoidForKey(requestAvoid, `${pid}|${day}`, shiftNorm);
    const summaryKey = `${pid}|${day}|${shiftNorm || "*"}`;
    if (!seenAvoidSummary.has(summaryKey)) {
      requestSummary.avoid.push({
        personId: pid,
        day,
        shiftCode: meta?.shiftRaw ?? null,
        shiftCodeNorm: shiftNorm || null,
        canon: meta?.canon || null,
        personName: meta?.personName || pickPersonName(staffById.get(pid)) || null,
      });
      seenAvoidSummary.add(summaryKey);
    }
  };
  const addPrefer = ({ pid, day, shiftNorm, meta, weight = 1 }) => {
    addPreferForKey(requestPrefer, `${pid}|${day}`, shiftNorm, weight);
    const summaryKey = `${pid}|${day}|${shiftNorm || "*"}`;
    if (!seenPreferSummary.has(summaryKey)) {
      requestSummary.prefer.push({
        personId: pid,
        day,
        shiftCode: meta?.shiftRaw ?? null,
        shiftCodeNorm: shiftNorm || null,
        canon: meta?.canon || null,
        personName: meta?.personName || pickPersonName(staffById.get(pid)) || null,
        weight,
      });
      seenPreferSummary.add(summaryKey);
    }
  };

  try {
    const { byPerson: requestBuckets } = collectRequestsByPerson({
      year,
      month1,
      strictMonth: true,
    });
    Object.entries(requestBuckets || {}).forEach(([canonKey, bucket]) => {
      if (!bucket) return;
      const candidateIds = new Set();
      const primaryId = bucket.personId ? String(bucket.personId) : null;
      if (primaryId && staffById.has(primaryId)) candidateIds.add(primaryId);
      const variants = buildCanonVariants(canonKey);
      for (const variant of variants) {
        const linked = staffByCanon.get(variant);
        if (linked) for (const pid of linked) candidateIds.add(pid);
      }

      const ensureCanonOnly = (intent, day, shiftNorm, meta, variants, weight = 1) => {
        if (!meta?.canon) return;
        const summaryKey = `${meta.canon}|${day}|${shiftNorm || "*"}|${intent}`;
        const targets = (variants || [])
          .filter((v) => v && v.length >= 3)
          .filter((v) => /\s/.test(v) || v.length >= 6);
        if (!targets.length) targets.push(meta.canon);
        for (const canonKeyStr of targets) {
          if (intent === "avoid") {
            addAvoidForKey(requestAvoidCanon, `${canonKeyStr}|${day}`, shiftNorm);
          } else {
            addPreferForKey(requestPreferCanon, `${canonKeyStr}|${day}`, shiftNorm, weight);
          }
        }
        if (intent === "avoid") {
          if (!seenAvoidSummary.has(summaryKey)) {
            requestSummary.avoid.push({
              personId: null,
              day,
              shiftCode: meta?.shiftRaw ?? null,
              shiftCodeNorm: shiftNorm || null,
              canon: meta.canon,
              personName: meta?.personName || null,
            });
            seenAvoidSummary.add(summaryKey);
          }
        } else if (!seenPreferSummary.has(summaryKey)) {
          requestSummary.prefer.push({
            personId: null,
            day,
            shiftCode: meta?.shiftRaw ?? null,
            shiftCodeNorm: shiftNorm || null,
            canon: meta.canon,
            personName: meta?.personName || null,
            weight,
          });
          seenPreferSummary.add(summaryKey);
        }
      };

      if (!candidateIds.size) {
        for (const [idStr, person] of staffById.entries()) {
          const personCanon = canonName(pickPersonName(person));
          if (!personCanon || !canonKey) continue;
          if (
            personCanon === canonKey ||
            canonKey.startsWith(personCanon) ||
            personCanon.startsWith(canonKey)
          ) {
            candidateIds.add(idStr);
          }
        }
      }
      if (!candidateIds.size) {
        // aday bulunamadıysa yalnızca kanonik eşleşme ile kayıt altında tut
        const metaBase = { canon: canonKey, personName: bucket.personName, shiftRaw: "" };
        const emit = (seg, intent) => {
          if (!seg) return;
          const segYear = Number(seg.year) || year;
          const segMonth = Number(seg.month) || month1;
          if (segYear !== year || segMonth !== month1) return;
          const startRaw = Number(seg.startDay);
          const endRaw = Number(seg.endDay);
          const startDay = Math.min(
            Math.max(1, Number.isFinite(startRaw) ? startRaw : 1),
            daysInMonth
          );
          const endDay = Math.min(
            Math.max(startDay, Number.isFinite(endRaw) ? endRaw : startDay),
            daysInMonth
          );
          const shiftRaw = seg.shift ? String(seg.shift).trim() : "";
          let shiftNorm = shiftRaw ? norm(shiftRaw) : null;
          const isDayOff = !shiftNorm || shiftNorm === "OFF";
          if (isDayOff) shiftNorm = null;
          for (let dayNum = startDay; dayNum <= endDay; dayNum++) {
            const dt = new Date(segYear, month, dayNum);
            if (dt.getMonth() !== month) continue;
            const ymd = fmtYmd(dt);
            ensureCanonOnly(intent, ymd, shiftNorm, { ...metaBase, shiftRaw }, variants, 1);
          }
        };
        (bucket.avoid || []).forEach((seg) => emit(seg, "avoid"));
        (bucket.prefer || []).forEach((seg) => emit(seg, "prefer"));
        return;
      }

      const handleSegment = (seg, intent) => {
        if (!seg) return;
        const segYear = Number(seg.year) || year;
        const segMonth = Number(seg.month) || month1;
        if (segYear !== year || segMonth !== month1) return;
        const startRaw = Number(seg.startDay);
        const endRaw = Number(seg.endDay);
        const startDay = Math.min(
          Math.max(1, Number.isFinite(startRaw) ? startRaw : 1),
          daysInMonth
        );
        const endDay = Math.min(
          Math.max(startDay, Number.isFinite(endRaw) ? endRaw : startDay),
          daysInMonth
        );
        const shiftRaw = seg.shift ? String(seg.shift).trim() : "";
        let shiftNorm = shiftRaw ? norm(shiftRaw) : null;
        const isDayOff = !shiftNorm || shiftNorm === "OFF";
        if (isDayOff) shiftNorm = null;
        for (let dayNum = startDay; dayNum <= endDay; dayNum++) {
          const dt = new Date(segYear, month, dayNum);
          if (dt.getMonth() !== month) continue;
          const ymd = fmtYmd(dt);
          for (const pid of candidateIds) {
          if (intent === "avoid") {
            addAvoid({
              pid,
              day: ymd,
              shiftNorm,
              meta: { canon: canonKey, personName: bucket.personName, shiftRaw },
            });
          } else {
            addPrefer({
              pid,
              day: ymd,
              shiftNorm,
              meta: { canon: canonKey, personName: bucket.personName, shiftRaw },
              weight: 1,
            });
          }
        }
        ensureCanonOnly(
          intent,
          ymd,
          shiftNorm,
          { canon: canonKey, personName: bucket.personName, shiftRaw },
          variants,
          1
        );
        }
      };

      (bucket.avoid || []).forEach((seg) => handleSegment(seg, "avoid"));
      (bucket.prefer || []).forEach((seg) => handleSegment(seg, "prefer"));
    });
  } catch (err) {
    console.warn("requestBoxV1 okunamadı:", err);
  }

  const codeIndex = Object.create(null);
  (workingHours||[]).forEach(w => { codeIndex[norm(w.code)] = w; });
  const hoursOfShiftCode = (code) => {
    const def = codeIndex[norm(code)];
    return def ? shiftDurationHours(def.start, def.end) : 0;
  };

  // uygunluk (Görev adı -> kişiler)
  const byNorm = {};
  (staff||[]).forEach(n=>{
    let arr=[]; if (Array.isArray(n.areas)) arr=n.areas; else if (typeof n.areas==="string") arr=n.areas.split(SPLIT_RE);
    arr.forEach(raw=>{
      const a=(raw||"").toString().trim(); if (!a) return;
      const k=normTR(a); if (!byNorm[k]) byNorm[k]=new Set(); byNorm[k].add(String(n.id));
    });
  });
  const eligibleByLabel = {};
  (taskLines||[]).forEach(tl => { eligibleByLabel[tl.label] = Array.from(byNorm[normTR(tl.label)]||[]); });

  const taskLinesWithHours = (taskLines||[]).map(tl => ({ ...tl, hours: hoursOfShiftCode(tl.shiftCode) }));

  const unavailable = leavesToUnavailable({
    year, month, nurses: staff, personLeaves
  });

  // kişi-bazlı izin düzleştirme (hedef etkisi için)
  const mkey = `${year}-${String(month+1).padStart(2,"0")}`;
  const dpLeaves = [];
  const pushOne = (pid, ymd, v) => {
    if (!v) return;
    if (typeof v === "string") dpLeaves.push({ personId:String(pid), day:ymd, code:v });
    else if (Array.isArray(v)) v.forEach(t=>pushOne(pid, ymd, t));
    else if (typeof v === "object") {
      const code = v.code || v.type || v.kind;
      if (code) dpLeaves.push({ personId:String(pid), day:ymd, code, shiftCode:v.shiftCode||v.shift||undefined });
    }
  };
  for (const p of staff||[]) {
    const monthly = (personLeaves?.[p.id]||{})[mkey] || {};
    for (let d=1; d<=daysInMonth; d++) {
      const ymd = fmtYmd(new Date(year, month, d));
      const raw = monthly[ymd] ?? monthly[String(d)];
      if (raw) pushOne(p.id, ymd, raw);
    }
  }

  const res = solveHourBalanced({
    days,
    taskLines: taskLinesWithHours,
    people: (staff||[]).map(n=>({ id:String(n.id), name:n.name })),
    unavailable,
    hardRules: dpRules,
    eligibleByLabel,
    shiftIndex: codeIndex,
    leaves: dpLeaves,
    requestMatrix: {
      avoid: requestAvoid,
      prefer: requestPrefer,
      avoidCanon: requestAvoidCanon,
      preferCanon: requestPreferCanon,
      canonById,
    },
  });
  if (!res) throw new Error("Uygun çözüm bulunamadı. Görev satırlarını/alan uygunluklarını kontrol edin.");

  // Dinlenme → Cap → Repair
  const rest = enforceNextDayRest(res.assignments, codeIndex);
  const cap  = enforceDailyCap(rest.assignments, dpRules?.maxPerDayPerPerson ?? DEFAULT_RULES.maxPerDayPerPerson ?? 1);
  const unavailableSet = new Set((unavailable||[]).map(([pid,day])=>`${pid}|${day}`));
  const repaired = repairAfterCap({
    assignments:[...cap.assignments],
    taskLines: taskLinesWithHours,
    year, month, daysInMonth, staff,
    eligibleByLabel, unavailableSet, requestAvoid, requestAvoidCanon, canonById,
    rules: dpRules, hoursOfShiftCode, shiftIndex: codeIndex,
  });
  const removedByRequest = [];
  const keptAfterRequest = [];
  for (const a of repaired) {
    if (hasRequestAvoid(requestAvoid, requestAvoidCanon, canonById, a.personId, a.day, a.shiftCode)) {
      removedByRequest.push({ ...a });
    } else {
      keptAfterRequest.push(a);
    }
  }

  const finalAssignments = removedByRequest.length
    ? repairAfterCap({
        assignments: [...keptAfterRequest],
        taskLines: taskLinesWithHours,
        year,
        month,
        daysInMonth,
        staff,
        eligibleByLabel,
        unavailableSet,
        requestAvoid,
        requestAvoidCanon,
        canonById,
        rules: dpRules,
        hoursOfShiftCode,
        shiftIndex: codeIndex,
      })
    : keptAfterRequest;

  const hoursByPerson = recomputeHoursByPerson(finalAssignments, hoursOfShiftCode);

  const assignmentsByKey = new Map();
  for (const a of finalAssignments) {
    const key = `${String(a.personId)}|${a.day}`;
    if (!assignmentsByKey.has(key)) assignmentsByKey.set(key, []);
    assignmentsByKey.get(key).push(a);
  }
  const gatherAssignmentsForCanon = (canonStr, day) => {
    if (!canonStr) return [];
    const variants = buildCanonVariants(canonStr)
      .filter((v) => v && (/\s/.test(v) || v.length >= 6));
    if (!variants.length) variants.push(canonStr);
    const collected = [];
    const seenKeys = new Set();
    for (const variant of variants) {
      const ids = staffByCanon.get(variant);
      if (!ids) continue;
      for (const pid of ids) {
        const key = `${pid}|${day}`;
        if (seenKeys.has(key)) continue;
        const arr = assignmentsByKey.get(key);
        if (arr && arr.length) {
          collected.push(...arr);
          seenKeys.add(key);
        }
      }
    }
    return collected;
  };

  let avoidViolations = 0;
  for (const item of requestSummary.avoid) {
    const assigned = item?.personId
      ? assignmentsByKey.get(`${item.personId}|${item.day}`) || []
      : gatherAssignmentsForCanon(item?.canon, item?.day);
    const violated = item.shiftCodeNorm
      ? assigned.some((asg) => norm(asg.shiftCode) === item.shiftCodeNorm)
      : assigned.length > 0;
    item.violated = Boolean(violated);
    if (violated) avoidViolations += 1;
  }

  let preferMet = 0;
  for (const item of requestSummary.prefer) {
    const assigned = item?.personId
      ? assignmentsByKey.get(`${item.personId}|${item.day}`) || []
      : gatherAssignmentsForCanon(item?.canon, item?.day);
    const met = item.shiftCodeNorm
      ? assigned.some((asg) => norm(asg.shiftCode) === item.shiftCodeNorm)
      : assigned.length > 0;
    item.met = Boolean(met);
    if (met) preferMet += 1;
  }

  const requestStats = {
    avoidTotal: requestSummary.avoid.length,
    avoidSatisfied: requestSummary.avoid.length - avoidViolations,
    avoidViolated: avoidViolations,
    preferTotal: requestSummary.prefer.length,
    preferMet,
    preferUnmet: requestSummary.prefer.length - preferMet,
    removedAssignmentsDueToRequests: removedByRequest.length,
  };
  const requestSummaryPayload = {
    ...requestSummary,
    removedAssignments: removedByRequest,
    stats: requestStats,
  };

  const dpResult = {
    assignments: finalAssignments,
    hoursByPerson,
    overrides: res.overrides || [],
    removedByRest: rest.removed || [],
    removedByCap: cap.removed || [],
    removedByRequest,
    baseTarget: res.baseTarget,
    targetByPerson: res.targetByPerson,
    requestSummary: requestSummaryPayload,
  };

  return { year, month, role: activeRole, serviceId: activeServiceId, dpResult, taskLines, workingHours };
}

/** Üst bardan Excel’e aktar (parametre ile) */
export function exportExcelFrom(dpCtx, taskLinesParam = [], workingHoursParam = []) {
  const ctx = dpCtx;
  if (!ctx?.result) throw new Error("Önce liste oluşturun.");
  const { year, month } = ctx;
  const dpResult = ctx.result;
  const taskLines =
    (Array.isArray(taskLinesParam) && taskLinesParam.length ? taskLinesParam : null) ||
    (Array.isArray(ctx?.taskLines) ? ctx.taskLines : []);
  const workingHours =
    (Array.isArray(workingHoursParam) && workingHoursParam.length ? workingHoursParam : null) ||
    (Array.isArray(ctx?.workingHours) ? ctx.workingHours : []);

  const days = buildMonthDays(year, month).daysInMonth;
  const D = Array.from({length:days},(_,i)=>i+1);

  const codeIndex = Object.create(null);
  (workingHours||[]).forEach(w => { codeIndex[norm(w.code)] = w; });
  const hoursOfShiftCode = (code) => {
    const def = codeIndex[norm(code)];
    return def ? shiftDurationHours(def.start, def.end) : 0;
  };

  const needForDay = (tl,d) => Number.isFinite(tl?.counts?.[d]) ? tl.counts[d] : (tl.defaultCount||0);
  const maxNeedForLine = (tl) => {
    let m=0; for (let d=1; d<=days; d++) m=Math.max(m, needForDay(tl,d)); return m||1;
  };

  const perDay = (tl) => {
    const map={};
    for (let d=1; d<=days; d++) {
      const ymd = fmtYmd(new Date(year, month, d));
      map[d] = (dpResult.assignments||[])
        .filter(a=> a.day===ymd && a.roleLabel===tl.label && norm(a.shiftCode)===norm(tl.shiftCode))
        .map(a=>a.personId);
    }
    return map;
  };

  const headerCiz = ["GÖREV SATIRI", ...D.map(d => `${String(d).padStart(2,"0")} (${dayNameTR(year,month,d)})`)];
  const rows=[];
  (taskLines||[]).forEach(tl=>{
    const def = (workingHours||[]).find(w=>norm(w.code)===norm(tl.shiftCode));
    const head = def ? `${tl.label} (${def.code} ${def.start}–${def.end})` : `${tl.label} (${tl.shiftCode})`;
    const slots = maxNeedForLine(tl);
    const pd = perDay(tl);
    for (let s=0; s<slots; s++) {
      const row=[slots>1 ? `${head} — #${s+1}` : head];
      D.forEach(d=>{
        const need = needForDay(tl,d);
        const cell = s<need ? (pd[d]?.[s] || "") : "";
        row.push(cell);
      });
      rows.push(row);
    }
  });

  const ws1 = XLSX.utils.aoa_to_sheet([headerCiz, ...rows]);

  // Saat özeti basit: only counts by personId (isim yerine id)
  const hoursByPerson = dpResult.hoursByPerson;
  const ws2 = XLSX.utils.aoa_to_sheet([
    ["Kişi ID", "Çalışılan Saat"],
    ...Array.from(hoursByPerson.entries()).map(([pid,h])=>[pid,h]),
  ]);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws1, "Cizelge");
  XLSX.utils.book_append_sheet(wb, ws2, "Saat_Ozeti");
  XLSX.writeFile(wb, `nobet_cizelgesi_${year}-${String(month+1).padStart(2,"0")}.xlsx`);
}
