// services/scheduler/draftRoster.js
// Basit "taslak" planlayıcı (frontend rosterEngine mantığına yakın).

const NIGHT_DEFAULT = new Set(["N", "V1", "V2", "SV"]);

const U = (s) => (s || "").toString().trim().toLocaleUpperCase("tr-TR");
const stripDiacritics = (str = "") =>
  str
    .toString()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
const normalizeCode = (s) => stripDiacritics(U(s));
const canonName = (s = "") =>
  stripDiacritics(U(s)).replace(/\s+/g, " ").trim();
const arrFromAny = (v) => {
  if (!v && v !== 0) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === "string") return v.split(/[;,|/]/).map((x) => x.trim()).filter(Boolean);
  return [];
};

const pad2 = (n) => String(n).padStart(2, "0");
const monIndex = (wdSun0) => (wdSun0 + 6) % 7;

function areaKeywords(label) {
  const s = normalizeCode(label);
  const map = {
    "SERVİS SORUMLUSU": ["SERVİS SORUMLUSU", "SORUMLU"],
    "SÜPERVİZÖR": ["SÜPERVİZÖR", "SUPERVISOR", "SV"],
    "EKİP SORUMLUSU": ["EKİP SORUMLUSU", "SORUMLU"],
    "RESÜSİTASYON": ["RESÜSİTASYON"],
    "KIRMIZI VE SARI GÖREVLENDİRME": ["KIRMIZI", "SARI"],
    KIRMIZI: ["KIRMIZI"],
    SARI: ["SARI"],
    ÇOCUK: ["ÇOCUK"],
    YEŞİL: ["YEŞİL"],
    ECZANE: ["ECZANE"],
    "CERRAHİ MÜDAHELE": ["CERRAHİ MÜDAHELE", "CERRAHİ"],
    CERRAHİ: ["CERRAHİ"],
    AŞI: ["AŞI"],
    TRİAJ: ["TRİAJ"],
  };
  for (const k of Object.keys(map)) if (s.includes(normalizeCode(k))) return map[k].map(normalizeCode);
  return s ? [s.split(" ")[0]] : [];
}

function buildStaffIndex(staffRaw) {
  const out = [];
  for (const s of staffRaw || []) {
    const id = String(s?.id ?? s?._id ?? s?.pid ?? s?.tc ?? s?.code ?? "");
    const name = s?.name || s?.fullName || s?.displayName || s?.["AD SOYAD"];
    if (!id || !name) continue;

    const areas = new Set();
    [
      s.areas,
      s.workAreas,
      s.skills,
      s.tags,
      s?.meta?.areas,
      s?.meta?.workAreas,
      s?.meta?.skills,
      s?.meta?.tags,
    ].forEach((src) => arrFromAny(src).forEach((a) => areas.add(normalizeCode(a))));

    const shiftCodes = new Set();
    [
      s.shiftCodes,
      s.shifts,
      s.allowedShifts,
      s.vardiyaKodlari,
      s.vardiya,
      s.vardiyalar,
      s?.meta?.shiftCodes,
      s?.meta?.shifts,
    ].forEach((src) => arrFromAny(src).forEach((c) => shiftCodes.add(normalizeCode(c))));

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
  if (keys.length) {
    if (!person.areas?.size) return false;
    if (!keys.some((k) => person.areas.has(normalizeCode(k)))) return false;
  }
  if (row.shiftCode && person.shiftCodes?.size && !person.shiftCodes.has(normalizeCode(row.shiftCode))) return false;
  return true;
}

function buildRowNeedMatrix(rows, overrides, year, month0) {
  const dim = new Date(year, month0 + 1, 0).getDate();
  const byDay = {};
  for (const r of rows || []) {
    const base = Math.max(0, Number(r?.defaultCount || 0));
    const pat = Array.isArray(r?.pattern) && r.pattern.length === 7
      ? r.pattern.map((x) => Math.max(0, Number(x) || 0))
      : [base, base, base, base, base, base, base];
    const ovr = overrides?.[r.id] || {};
    for (let d = 1; d <= dim; d++) {
      const wd = new Date(year, month0, d).getDay();
      const pztIdx = monIndex(wd);
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

function parseDayNum(dateLike) {
  if (!dateLike) return null;
  if (typeof dateLike === "number" && Number.isFinite(dateLike)) return Math.trunc(dateLike);
  const s = String(dateLike);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return Number(s.slice(8, 10));
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
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

function normalizeSupervisorConfig(cfg = {}, name2id) {
  const resolveIdLike = (x) => {
    if (x == null) return null;
    const s = String(x);
    return name2id.get(canonName(s)) || s;
  };
  const toSet = (v) => {
    if (!v) return new Set();
    if (Array.isArray(v)) return new Set(v.map((n) => Number(n)));
    if (typeof v === "object") return new Set(Object.keys(v).map((k) => Number(k)));
    return new Set();
  };
  return {
    primaryId: resolveIdLike(cfg.primary) || null,
    assistants: (cfg.assistants || []).map(resolveIdLike).filter(Boolean).map(String),
    fallbackPool: (cfg.fallbackPool || []).map(resolveIdLike).filter(Boolean).map(String),
    weekdayOnly: cfg.weekdayOnly !== false,
    ensureAssistCount: Number(cfg.ensureAssistCount ?? 1) || 1,
    assistDays: toSet(cfg.assistDays),
    offDays: toSet(cfg.offDays),
  };
}

function buildLeaveIndex(leavesByPerson = {}, year, month) {
  const out = new Map();
  for (const [pid, dates] of Object.entries(leavesByPerson || {})) {
    const set = new Set();
    for (const d of dates || []) {
      const dayNum = parseDayNum(d);
      if (!dayNum) continue;
      set.add(dayNum);
    }
    if (set.size) out.set(String(pid), set);
  }
  return out;
}

function buildPinsMap(pins, rows) {
  const byDay = {};
  const rowByLabelShift = new Map();
  for (const r of rows || []) {
    const key = `${U(r.label || "")}::${U(r.shiftCode || "")}`;
    if (!rowByLabelShift.has(key)) rowByLabelShift.set(key, String(r.id));
  }
  for (const p of pins || []) {
    const dayNum = p.dayNum || parseDayNum(p.day);
    if (!dayNum) continue;
    const rowId =
      p.rowId ||
      rowByLabelShift.get(`${U(p.roleLabel || "")}::${U(p.shiftCode || "")}`);
    if (!rowId) continue;
    const pid = String(p.personId || "");
    if (!pid) continue;
    if (!byDay[dayNum]) byDay[dayNum] = {};
    if (!byDay[dayNum][rowId]) byDay[dayNum][rowId] = [];
    byDay[dayNum][rowId].push(pid);
  }
  return byDay;
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function buildAssignmentsFromNamed({
  year,
  month,
  rows,
  namedAssignments,
  idByCanon,
  shiftHoursById,
}) {
  const assignments = [];
  const rowById = new Map((rows || []).map((r) => [String(r.id), r]));
  for (const [dayStr, byRow] of Object.entries(namedAssignments || {})) {
    const d = Number(dayStr);
    if (!Number.isFinite(d) || d < 1 || d > 31) continue;
    const date = `${year}-${pad2(month)}-${pad2(d)}`;
    const weekday = new Date(year, month - 1, d).getDay();
    for (const [rowId, names] of Object.entries(byRow || {})) {
      const r = rowById.get(String(rowId));
      const hours = shiftHoursById?.get(String(rowId));
      for (const nm of names || []) {
        const pid = idByCanon.get(canonName(nm)) || null;
        assignments.push({
          date,
          weekday,
          shiftId: String(rowId),
          personId: pid,
          personName: nm,
          hours: Number.isFinite(hours) ? hours : undefined,
        });
      }
    }
  }
  return assignments;
}

function buildShiftHoursMap(rows, shiftOptions) {
  const out = new Map();
  const byCode = new Map();
  for (const s of shiftOptions || []) {
    const code = String(s.code || s.id || "").trim();
    if (!code) continue;
    if (Number.isFinite(Number(s.hours))) byCode.set(U(code), Number(s.hours));
  }
  for (const r of rows || []) {
    const code = U(r.shiftCode || "");
    if (byCode.has(code)) out.set(String(r.id), byCode.get(code));
  }
  return out;
}

function generateDraftRoster({
  year,
  month,
  rows = [],
  overrides = {},
  staff = [],
  leavesByPerson = {},
  pins = [],
  supervisorConfig = {},
  supervisorPool = [],
  leavePolicy = "hard",
  requireEligibility = true,
  nightCodes,
  shiftOptions = [],
}) {
  const month0 = month - 1;
  const rng = mulberry32(year * 100 + month);
  const NIGHT = new Set(nightCodes && nightCodes.length ? nightCodes.map(normalizeCode) : Array.from(NIGHT_DEFAULT));

  const staffIdx = buildStaffIndex(staff);
  const id2person = new Map(staffIdx.map((p) => [p.id, p]));
  const idByCanon = new Map(staffIdx.map((p) => [p.nameCanon, p.id]));
  const name2idCanon = new Map(staffIdx.map((p) => [p.nameCanon, p.id]));
  const leavesById = buildLeaveIndex(leavesByPerson, year, month);
  const isOnLeave = (person, d) => {
    if (leavePolicy === "ignore") return false;
    return leavesById.get(person.id)?.has(d);
  };

  const needByDay = buildRowNeedMatrix(rows, overrides, year, month0);
  const dim = new Date(year, month, 0).getDate();

  const pinsByDayRow = buildPinsMap(pins, rows);

  const supCfg = normalizeSupervisorConfig(supervisorConfig || {}, name2idCanon);
  let supPool = Array.isArray(supervisorPool) && supervisorPool.length
    ? supervisorPool.map((id) => id2person.get(String(id))).filter(Boolean)
    : deriveSupervisorCandidates(staffIdx);
  if (!supPool.length) supPool = staffIdx;
  const supUseCount = Object.fromEntries(staffIdx.map((p) => [p.id, 0]));

  const namedAssignments = {};
  const issues = [];

  for (let d = 1; d <= dim; d++) {
    namedAssignments[d] = {};
    const usedToday = new Set();
    const jsDay = new Date(year, month0, d).getDay();
    const isWeekend = jsDay === 0 || jsDay === 6;

    // Servis sorumlusu satırları
    for (const r of rows || []) {
      const labelU = U(r?.label || "");
      if (!labelU.includes("SERVİS SORUMLUSU")) continue;

      const need0 = needByDay[d]?.[r.id] || 0;
      let need = need0;

      if (supCfg.weekdayOnly && isWeekend) {
        namedAssignments[d][r.id] = [];
        continue;
      }
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
      const pinIds = (pinsByDayRow?.[d]?.[r.id]) || [];
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
        const p = id2person.get(String(supCfg.primaryId));
        if (p) addIfOk(p);
      }

      // assistants
      if (names.length < need) {
        for (const aid of supCfg.assistants || []) {
          const p = id2person.get(String(aid));
          if (!p) continue;
          if (addIfOk(p) && names.length >= need) break;
        }
      }

      // fallback pool
      if (names.length < need) {
        const poolIds = supCfg.fallbackPool.length
          ? supCfg.fallbackPool
          : supPool.map((pp) => pp.id);
        let candidates = poolIds
          .map((id) => id2person.get(String(id)))
          .filter(Boolean)
          .filter((p) => !usedToday.has(p.id))
          .filter((p) => isEligible(p, r, year, month0, d, requireEligibility))
          .filter((p) => (leavePolicy === "ignore" ? true : !isOnLeave(p, d)));

        candidates.sort(
          (a, b) => (supUseCount[a.id] - supUseCount[b.id]) || (rng() - 0.5)
        );
        for (const c of candidates) {
          if (addIfOk(c) && names.length >= need) break;
        }
      }

      if (names.length < need) {
        issues.push({
          date: `${year}-${pad2(month)}-${pad2(d)}`,
          shiftId: String(r.id),
          missing: need - names.length,
          reason: "NO_CANDIDATE",
        });
      }
      namedAssignments[d][r.id] = names;
    }

    // Diğer satırlar
    for (const r of rows || []) {
      const labelU = U(r?.label || "");
      if (labelU.includes("SERVİS SORUMLUSU")) continue;

      const need = needByDay[d]?.[r.id] || 0;
      if (need <= 0) {
        namedAssignments[d][r.id] = [];
        continue;
      }

      const chosen = [];

      // pins
      const pinIds = (pinsByDayRow?.[d]?.[r.id]) || [];
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
      let pool = staffIdx
        .filter((p) => !usedToday.has(p.id))
        .filter((p) => isEligible(p, r, year, month0, d, requireEligibility))
        .filter((p) => (leavePolicy === "ignore" ? true : !isOnLeave(p, d)));

      // gece üstüne gece yok
      const isNightToday = NIGHT.has(normalizeCode(r?.shiftCode || ""));
      if (isNightToday && d > 1) {
        const prev = namedAssignments[d - 1] || {};
        const prevNightCanon = new Set();
        for (const rr of rows || []) {
          if (!NIGHT.has(normalizeCode(rr?.shiftCode || ""))) continue;
          for (const nm of prev[rr.id] || []) prevNightCanon.add(canonName(nm));
        }
        pool = pool.filter((p) => !prevNightCanon.has(p.nameCanon));
      }

      while (chosen.length < need && pool.length) {
        const idx = Math.floor(rng() * pool.length);
        const person = pool.splice(idx, 1)[0];
        chosen.push(person.name);
        usedToday.add(person.id);
      }

      if (chosen.length < need) {
        issues.push({
          date: `${year}-${pad2(month)}-${pad2(d)}`,
          shiftId: String(r.id),
          missing: need - chosen.length,
          reason: "NO_CANDIDATE",
        });
      }
      namedAssignments[d][r.id] = chosen;
    }
  }

  const shiftHoursById = buildShiftHoursMap(rows, shiftOptions);
  const assignments = buildAssignmentsFromNamed({
    year,
    month,
    rows,
    namedAssignments,
    idByCanon,
    shiftHoursById,
  });

  return { assignments, issues };
}

module.exports = { generateDraftRoster };
