// services/scheduler/constraints.js

const parseTime = (s) => {
  if (!s) return null;
  const m = String(s).match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
};

const getISOWeekKey = (dateStr) => {
  if (!dateStr) return null;
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
};

const daysBetween = (a, b) => {
  if (!a || !b) return null;
  return Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);
};

const shiftIsNight = (shift) => {
  if (!shift) return false;
  if (shift.isNight) return true;
  return String(shift.code || shift.id || "").toUpperCase().includes("N");
};

const normalizeCode = (s) =>
  (s||"").toString().normalize("NFD").replace(/\p{Diacritic}/gu,"").toUpperCase().trim();

const normalizeArea = (s) =>
  (s||"").toString()
    .replace(/İ/g,"i").replace(/I/g,"i").replace(/ı/g,"i")
    .replace(/Ğ/g,"g").replace(/ğ/g,"g")
    .replace(/Ü/g,"u").replace(/ü/g,"u")
    .replace(/Ş/g,"s").replace(/ş/g,"s")
    .replace(/Ö/g,"o").replace(/ö/g,"o")
    .replace(/Ç/g,"c").replace(/ç/g,"c")
    .toLowerCase().trim();

const NOISE_WORDS = new Set(['alan','alani','gorev','gorevi','gorevlendirme','birim','birimi','unit','ve','veya','yada','ile']);

const splitAreaTokens = (s) => {
  const base = normalizeArea(s);
  if (!base) return [];
  return base.replace(/[\(\)\[\]\{\}]/g,' ').replace(/&|\+|\/|\\|,|;|-|_/g,' ')
    .split(/\s+/).map(t=>t.trim()).filter(t=>t&&t.length>1&&!NOISE_WORDS.has(t));
};

const getPersonAreas = (person) => {
  const raw = person?.meta?.areas||person?.meta?.duties||person?.areas||[];
  if (Array.isArray(raw)) return raw.map(normalizeArea).filter(Boolean);
  if (typeof raw==="string") return raw.split(",").map(normalizeArea).filter(Boolean);
  return [];
};

const getPersonShiftCodes = (person) => {
  const raw = person?.meta?.shiftCodes||person?.shiftCodes||person?.meta?.shifts||person?.shifts||[];
  if (Array.isArray(raw)) return raw.map(normalizeCode).filter(Boolean);
  if (typeof raw==="string") return raw.split(/[,;/-]/).map(normalizeCode).filter(Boolean);
  return [];
};

const getShiftArea = (shift) => normalizeArea(shift?.area||shift?.label||shift?.name||"");
const getShiftKey = (shift) => normalizeCode(shift?.id||shift?.code||shift?.label||shift?.name||"");

function areaMatches(personAreas, shiftArea) {
  if (!shiftArea) return true;
  if (personAreas.includes(shiftArea)) return true;
  const shiftTokens = splitAreaTokens(shiftArea);
  if (shiftTokens.length === 0) return true;
  for (const personArea of personAreas) {
    const personTokens = splitAreaTokens(personArea);
    const matchCount = shiftTokens.filter(t=>personTokens.includes(t)).length;
    if (matchCount > 0 && matchCount >= Math.ceil(shiftTokens.length/2)) return true;
    if (personArea.includes(shiftArea)||shiftArea.includes(personArea)) return true;
  }
  return false;
}

function isAvailable(person, day, context, shift) {
  if (!person||!day) return false;
  const rules = context?.rules||{};
  const leaves = context?.leavesByPerson||{};
  const dayKey = day.date;
  if (!dayKey) return false;
  const logBlock = context?.debug?.logBlocks
    ? (r) => console.log("[SCHED-BLOCK]",r,{pid:person?.id,name:person?.name,date:dayKey,shift:shift?.code||"",area:shift?.label||""})
    : null;

  if (context?.ruleEngine && shift) {
    const allow = context.ruleEngine.checkPersonEligibility(person, shift, dayKey, context);
    if (!allow?.eligible) { if(logBlock)logBlock(allow.reason||"RULE_ENGINE"); return false; }
  }

  if (shift) {
    const areas = getPersonAreas(person);
    const shiftArea = getShiftArea(shift);
    if (areas.length > 0 && shiftArea) {
      if (!areaMatches(areas,shiftArea)) { if(logBlock)logBlock("AREA_NOT_ALLOWED"); return false; }
    }
  }

  if (shift) {
    const codes = getPersonShiftCodes(person);
    const shiftCode = normalizeCode(shift.code||shift.id||"");
    if (shiftCode&&codes.length&&!codes.includes(shiftCode)) { if(logBlock)logBlock("SHIFT_CODE_NOT_ALLOWED"); return false; }
  }

  if (rules.ONE_SHIFT_PER_DAY&&Array.isArray(person.assignedDays)&&person.assignedDays.includes(dayKey)) { if(logBlock)logBlock("ONE_SHIFT_PER_DAY"); return false; }

  if (rules.LEAVE_BLOCK) {
    const lv = leaves[person.id];
    if (lv&&(lv instanceof Set?lv.has(dayKey):Array.isArray(lv)&&lv.includes(dayKey))) { if(logBlock)logBlock("LEAVE_BLOCK"); return false; }
  }

  if (rules.MAX_CONSECUTIVE_DAYS) {
    const max = Number(rules.MAX_CONSECUTIVE_DAYS);
    if (Number.isFinite(max)&&max>0) {
      const diff = daysBetween(person.lastAssignedDate,dayKey);
      const nextCons = diff===1?(Number(person.consecutiveDays||0)+1):1;
      if (nextCons>max) { if(logBlock)logBlock("MAX_CONSECUTIVE_DAYS"); return false; }
    }
  }

  if (rules.NIGHT_NEXT_DAY_OFF&&person.lastShift&&shiftIsNight(person.lastShift)) {
    if (daysBetween(person.lastShift.date,dayKey)===1) { if(logBlock)logBlock("NIGHT_NEXT_DAY_OFF"); return false; }
  }

  if (rules.MIN_REST_HOURS&&person.lastShift) {
    const minRest = Number(rules.MIN_REST_HOURS);
    if (Number.isFinite(minRest)&&minRest>0) {
      const prev = person.lastShift;
      const prevStart=parseTime(prev.start),prevEndRaw=parseTime(prev.end),currStart=parseTime(shift?.start);
      let prevEnd=prevEndRaw;
      if (prevStart!=null&&prevEnd!=null&&prevEnd<=prevStart) prevEnd+=1440;
      if (prevEnd!=null&&currStart!=null) {
        const restHours=(new Date(`${dayKey}T00:00:00Z`).getTime()+currStart*60000-new Date(`${prev.date}T00:00:00Z`).getTime()-prevEnd*60000)/3600000;
        if (restHours<minRest) { if(logBlock)logBlock("MIN_REST_HOURS"); return false; }
      } else {
        const diff=daysBetween(prev.date,dayKey);
        if ((diff===0&&minRest>0)||(diff===1&&minRest>24)) { if(logBlock)logBlock("MIN_REST_HOURS"); return false; }
      }
    }
  }

  if (rules.MAX_SHIFTS_PER_WEEK) {
    const max=Number(rules.MAX_SHIFTS_PER_WEEK);
    if (Number.isFinite(max)&&max>0) {
      const wk=getISOWeekKey(dayKey);
      if (wk&&Number(person.weeklyCounts?.[wk]||0)>=max) { if(logBlock)logBlock("MAX_SHIFTS_PER_WEEK"); return false; }
    }
  }

  if (rules.MAX_TASK_PER_PERSON&&shift) {
    const max=Number(rules.MAX_TASK_PER_PERSON);
    if (Number.isFinite(max)&&max>0) {
      const key=getShiftKey(shift);
      if (key&&Number(person.taskCounts?.[key]||0)>=max) { if(logBlock)logBlock("MAX_TASK_PER_PERSON"); return false; }
    }
  }

  return true;
}

module.exports = { isAvailable, areaMatches, normalizeArea, splitAreaTokens };
