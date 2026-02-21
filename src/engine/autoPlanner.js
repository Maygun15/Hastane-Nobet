/* src/engine/autoPlanner.js
   Otomatik Çalışma Çizelgesi üretir.
   - People, Toplu İzin, Çalışma Alanları, Çalışma Saatleri, İzin Türleri, Nöbet Kuralları, İstekler
   - Greedy, saat-dengeli, basit kısıt kontrollü yerleştirici
*/

const pad2 = (n) => String(n).padStart(2, "0");
const ymKey = (y, m1_12) => `${y}-${pad2(m1_12)}`;
const upTR = (s) => (s ?? "").toString().trim().toLocaleUpperCase("tr");
const norm = (s) => (s ?? "").toString().trim();

// ---- LocalStorage helpers
const safeJSONParse = (s, fb) => { try { return JSON.parse(s); } catch { return fb; } };
const lsGet = (key, fb) => safeJSONParse(localStorage.getItem(key), fb);
const lsSet = (key, val) => localStorage.setItem(key, JSON.stringify(val));

// ---- Anahtarlar (her iki isim de destekli: V2 ve eski)
const DEFAULT_KEYS = {
  people       : "peopleV2",        // fallback: people
  people_fallback: "people",
  leaves       : "leavesV2",        // fallback: leaves
  leaves_fallback: "leaves",
  workAreas    : "workAreasV2",     // fallback: workAreas
  workAreas_fallback: "workAreas",
  workingHours : "workingHoursV2",  // fallback: workingHours
  workingHours_fallback: "workingHours",
  leaveTypes   : "leaveTypesV2",    // fallback: leaveTypes
  leaveTypes_fallback: "leaveTypes",
  rules        : "rulesV2",         // fallback: rules
  rules_fallback: "rules",
  requests     : "requestsV1",      // fallback: requests
  requests_fallback: "requests",
  scheduleTarget: "scheduleRowsV2",
};

// ---- Yardımcılar
function buildMonthDays(year, month1_12) {
  const last = new Date(year, month1_12, 0).getDate();
  const arr = [];
  for (let d = 1; d <= last; d++) {
    const date = new Date(year, month1_12 - 1, d);
    arr.push({ y: year, m: month1_12, d, dow: date.getDay() }); // 0=Sun
  }
  return arr;
}

function daysDiff(ymd1, ymd2) {
  const a = new Date(ymd1 + "T00:00:00");
  const b = new Date(ymd2 + "T00:00:00");
  return (b - a) / (1000 * 60 * 60 * 24);
}

function hoursBetweenShifts(prevShiftCode, nextShiftCode) {
  // Basit kural: Gece (N) sonrası min 24 saat
  if (prevShiftCode === "N") return 24;
  return 0;
}

// ---- Readers
function readPeople(keys) {
  const k1 = keys.people, k2 = keys.people_fallback;
  const arr = lsGet(k1, lsGet(k2, []));
  return Array.isArray(arr) ? arr.filter(x => x && x.id && x.name) : [];
}

function readAllLeaves(year, month1_12, keys) {
  // leaves: { [personId]: { "YYYY-MM": { [day]: code | {code,...} } } }
  const k1 = keys.leaves, k2 = keys.leaves_fallback;
  const map = lsGet(k1, lsGet(k2, {}));
  const ym = ymKey(year, month1_12);
  return map && typeof map === "object" ? { ym, map } : { ym, map: {} };
}

function readWorkAreas(keys) {
  const k1 = keys.workAreas, k2 = keys.workAreas_fallback;
  const arr = lsGet(k1, lsGet(k2, []));
  return Array.isArray(arr) ? arr : [];
}

function readWorkingHours(keys) {
  const k1 = keys.workingHours, k2 = keys.workingHours_fallback;
  const obj = lsGet(k1, lsGet(k2, {}));
  const shiftHours = obj?.shiftHours || { M: 8, G: 8, E: 8, N: 16, OFF: 0 };
  return {
    shiftHours,
    weeklyHourCap: Number(obj?.weeklyHourCap) || 80,
    restAfterNightHours: Number(obj?.restAfterNightHours) || 24,
  };
}

function readLeaveTypes(keys) {
  const k1 = keys.leaveTypes, k2 = keys.leaveTypes_fallback;
  const arr = lsGet(k1, lsGet(k2, []));
  const byCode = new Map();
  for (const lt of (Array.isArray(arr) ? arr : [])) {
    if (lt?.code) byCode.set(upTR(lt.code), lt);
  }
  return byCode;
}

function readRules(keys) {
  const k1 = keys.rules, k2 = keys.rules_fallback;
  const obj = lsGet(k1, lsGet(k2, {}));
  return obj && typeof obj === "object" ? obj : {};
}

function readRequests(keys) {
  const k1 = keys.requests, k2 = keys.requests_fallback;
  const obj = lsGet(k1, lsGet(k2, {}));
  return obj && typeof obj === "object" ? obj : {};
}

function indexLeavesByDay({ people, allLeaves, year, month1_12 }) {
  const ym = ymKey(year, month1_12);
  const byPerson = new Map(); // personId -> Map(dateKey -> code)
  for (const p of people) byPerson.set(p.id, new Map());

  const src = allLeaves?.map || {};
  for (const pid of Object.keys(src)) {
    const per = src[pid];
    const month = per?.[ym] || {};
    for (const dStr of Object.keys(month)) {
      const code = typeof month[dStr] === "object" ? month[dStr]?.code : month[dStr];
      const dateKey = `${year}-${pad2(month1_12)}-${pad2(Number(dStr))}`;
      if (!byPerson.has(pid)) byPerson.set(pid, new Map());
      byPerson.get(pid).set(dateKey, upTR(code));
    }
  }
  return byPerson;
}

// ---- Feasibility + scoring
function canWork({ person, dateKey, shiftCode, lastAssignment, leavesByDay, leaveTypes, rules, workingHours, personHours }) {
  // 1) İzinli mi?
  const lv = leavesByDay?.get(person.id)?.get(dateKey);
  if (lv) return false;

  // 2) Aynı gün iki vardiya yok
  if (lastAssignment?.get(person.id)?.get(dateKey)) return false;

  // 3) Gece dinlenmesi (basit)
  const prev = lastAssignment?.get(person.id)?.get("_lastShift");
  if (prev) {
    const neededRest = hoursBetweenShifts(prev, shiftCode);
    if (neededRest >= 24) {
      const prevDate = lastAssignment.get(person.id).get("_lastDate");
      if (prevDate && Math.abs(daysDiff(prevDate, dateKey)) < 1) return false;
    }
  }

  // 4) Haftalık saat üst sınırı (yaklaşık)
  const nextHours = (personHours.get(person.id) || 0) + (workingHours.shiftHours?.[shiftCode] || 0);
  if (nextHours > (workingHours.weeklyHourCap || 80)) return false;

  // TODO: rules.maxConsecutiveNights, roleMix, serviceCaps, weekend bans...
  return true;
}

function scoreCandidate({ person, dateKey, shiftCode, requests, personHours }) {
  let score = 0;
  const wantSet  = requests?.want?.[dateKey];
  const avoidSet = requests?.avoid?.[dateKey];
  if (Array.isArray(wantSet) ? wantSet.includes(person.id) : wantSet?.has?.(person.id)) score += 10;
  if (Array.isArray(avoidSet) ? avoidSet.includes(person.id) : avoidSet?.has?.(person.id)) score -= 10;

  const pref = requests?.preferShift?.[person.id]?.[dateKey];
  if (pref && upTR(pref) === upTR(shiftCode)) score += 5;

  // Saat dengesi (az saatli öne)
  const h = personHours.get(person.id) || 0;
  score += Math.max(0, 1000 - h);
  return score;
}

// ---- Core engine
function engineAssign({ year, month1_12, people, workAreas, workingHours, leavesByDay, leaveTypes, rules, requests }) {
  const days = buildMonthDays(year, month1_12);
  const result = []; // {date, serviceId, shiftCode, personId, note?}

  const personHours = new Map();
  const lastAssignment = new Map();
  for (const p of people) personHours.set(p.id, 0);

  for (const day of days) {
    const dateKey = `${day.y}-${pad2(day.m)}-${pad2(day.d)}`;

    for (const area of (Array.isArray(workAreas) ? workAreas : [])) {
      const roleNeed = Array.isArray(area.shifts) ? area.shifts : [];
      for (const slot of roleNeed) {
        const { code: shiftCode, need = 0, role } = slot || {};
        for (let k = 0; k < Number(need || 0); k++) {

          // Aday havuzu (rol/servis eşleşmesi)
          const candidates = people.filter(pp => (
            (!role || upTR(pp.role) === upTR(role)) &&
            (!area.role || upTR(pp.role) === upTR(area.role)) &&
            (!area.serviceId || upTR(pp.serviceId) === upTR(area.serviceId))
          ));

          const feasible = candidates.filter(pp => canWork({
            person: pp, dateKey, shiftCode, lastAssignment, leavesByDay, leaveTypes, rules, workingHours, personHours,
          }));

          if (feasible.length === 0) {
            result.push({ date: dateKey, serviceId: area.id, shiftCode, personId: null, note: "BOŞ" });
            continue;
          }

          feasible.sort((a, b) =>
            scoreCandidate({ person:a, dateKey, shiftCode, requests, personHours }) -
            scoreCandidate({ person:b, dateKey, shiftCode, requests, personHours })
          ).reverse();

          const chosen = feasible[0];
          result.push({ date: dateKey, serviceId: area.id, shiftCode, personId: chosen.id });

          const addH = workingHours.shiftHours?.[shiftCode] || 0;
          personHours.set(chosen.id, (personHours.get(chosen.id) || 0) + addH);
          if (!lastAssignment.has(chosen.id)) lastAssignment.set(chosen.id, new Map());
          lastAssignment.get(chosen.id).set(dateKey, true);
          lastAssignment.get(chosen.id).set("_lastShift", shiftCode);
          lastAssignment.get(chosen.id).set("_lastDate", dateKey);
        }
      }
    }
  }

  return { rows: result, personHours: Object.fromEntries(personHours.entries()) };
}

// ---- Orchestrator
export function generateAutoSchedule({ year, month1_12, writeToLS = true, keys = {} } = {}) {
  if (!Number.isFinite(year) || !Number.isFinite(month1_12)) throw new Error("year/month zorunlu");

  const K = { ...DEFAULT_KEYS, ...(keys || {}) };

  const people       = readPeople(K);
  const allLeaves    = readAllLeaves(year, month1_12, K);
  const workAreas    = readWorkAreas(K);
  const workingHours = readWorkingHours(K);
  const leaveTypes   = readLeaveTypes(K);
  const rules        = readRules(K);
  const requests     = readRequests(K);

  const leavesByDay = indexLeavesByDay({ people, allLeaves, year, month1_12 });

  const { rows, personHours } = engineAssign({
    year, month1_12, people, workAreas, workingHours, leavesByDay, leaveTypes, rules, requests,
  });

  const payload = { year, month: month1_12, rows, meta: { personHours, createdAt: Date.now() } };
  if (writeToLS) lsSet(K.scheduleTarget, payload);
  return payload;
}

const defaultExport = { generateAutoSchedule };
export default defaultExport;
