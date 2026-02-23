const DutyRule = require('../models/DutyRule');
const GeneratedSchedule = require('../models/GeneratedSchedule');
const MonthlySchedule = require('../models/MonthlySchedule');
const Person = require('../models/Person');
const { generateMonthlyPlan } = require('./scheduler');

const DEFAULT_RULES = {
  ONE_SHIFT_PER_DAY: true,
  LEAVE_BLOCK: true,
  MAX_CONSECUTIVE_DAYS: 6,
  MIN_REST_HOURS: 12,
  NIGHT_NEXT_DAY_OFF: false,
};

const DEFAULT_WEIGHTS = {
  hourBalance: 2,
  weekdayBalance: 3,
  pairPenalty: 5,
  requestBonus: -5,
};

const pad2 = (n) => String(n).padStart(2, '0');
const monIndex = (wdSun0) => (wdSun0 + 6) % 7; // 0=Mon

function buildShiftMetaMap(data) {
  const map = new Map();
  const src = Array.isArray(data?.shiftOptions) ? data.shiftOptions : [];
  for (const s of src) {
    const code = String(s.code || s.id || '').trim();
    if (!code) continue;
    map.set(code, {
      hours: Number(s.hours || 0) || undefined,
      start: s.start || null,
      end: s.end || null,
      isNight: !!s.isNight,
    });
  }
  return map;
}

function buildDaysFromScheduleData({ year, month, data }) {
  const defs = Array.isArray(data?.defs)
    ? data.defs
    : Array.isArray(data?.rows)
    ? data.rows
    : [];
  if (!defs.length) return null;

  const shiftMeta = buildShiftMetaMap(data);

  const isDailyDefs = defs.some(
    (d) => d && (d.date || d.day) && Array.isArray(d.shifts)
  );

  if (isDailyDefs) {
    const last = new Date(year, month, 0).getDate();
    const byDate = new Map();
    for (const def of defs) {
      if (!def || !Array.isArray(def.shifts)) continue;
      let y = year;
      let m = month;
      let d = null;
      if (def.date) {
        const parts = String(def.date).split("-");
        if (parts.length === 3) {
          y = Number(parts[0]);
          m = Number(parts[1]);
          d = Number(parts[2]);
        }
      } else if (def.day) {
        d = Number(def.day);
      }
      if (!d || y !== year || m !== month) continue;

      const key = `${year}-${pad2(month)}-${pad2(d)}`;
      const arr = byDate.get(key) || [];
      for (const sh of def.shifts) {
        if (!sh) continue;
        const code = String(sh.code || sh.shiftCode || sh.id || sh.label || sh.name || "").trim();
        const area = String(sh.area || sh.label || def.label || def.area || def.name || "").trim();
        const need = Math.max(
          0,
          Number(sh.requiredCount ?? sh.count ?? sh.need ?? sh.required ?? sh.qty ?? 0) || 0
        );
        if (!code || need <= 0) continue;
        const meta = shiftMeta.get(code) || {};
        arr.push({
          id: String(sh.id || code),
          code,
          area,
          requiredCount: need,
          hours: meta.hours,
          start: meta.start,
          end: meta.end,
          isNight: meta.isNight || false,
        });
      }
      byDate.set(key, arr);
    }

    const days = [];
    for (let d = 1; d <= last; d++) {
      const dt = new Date(year, month - 1, d);
      const wd = dt.getDay();
      const date = `${year}-${pad2(month)}-${pad2(d)}`;
      days.push({
        date,
        weekday: wd,
        shifts: byDate.get(date) || [],
      });
    }
    return days;
  }

  const overrides = data?.overrides && typeof data.overrides === 'object' ? data.overrides : {};

  const last = new Date(year, month, 0).getDate();
  const days = [];
  for (let d = 1; d <= last; d++) {
    const dt = new Date(year, month - 1, d);
    const wd = dt.getDay(); // 0=Sun
    const patIdx = monIndex(wd);
    const shifts = [];

    for (const def of defs) {
      const rowId = String(def?.id ?? def?.rowId ?? '');
      const shiftCode = def?.shiftCode || def?.label || def?.code || '';
      const area = String(def?.label || def?.area || def?.name || '').trim();
      if (!rowId) continue;

      let v = overrides?.[rowId]?.[d];
      if (v == null) {
        const pat = Array.isArray(def.pattern) ? def.pattern : Array(7).fill(def.defaultCount || 0);
        v = pat[patIdx] ?? def.defaultCount ?? 0;
      }

      if (def.weekendOff && (wd === 0 || wd === 6)) v = 0;
      const need = Math.max(0, Number(v) || 0);
      if (need <= 0) continue;

      const meta = shiftMeta.get(String(shiftCode)) || {};
      shifts.push({
        id: rowId,
        code: shiftCode,
        area,
        requiredCount: need,
        hours: meta.hours,
        start: meta.start,
        end: meta.end,
        isNight: meta.isNight || false,
      });
    }

    days.push({
      date: `${year}-${pad2(month)}-${pad2(d)}`,
      weekday: wd,
      shifts,
    });
  }

  return days;
}

async function fetchDutyRules({ sectionId, serviceId = '', role = '' }) {
  const doc = await DutyRule.findOne({ sectionId, serviceId, role }).lean();
  const rules = { ...DEFAULT_RULES, ...(doc?.rules || {}) };
  const weights = { ...DEFAULT_WEIGHTS, ...(doc?.weights || {}) };
  return { doc, rules, weights };
}

function normalizeRoleStr(s) {
  return (s || "")
    .toString()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function roleTokens(role) {
  const r = normalizeRoleStr(role);
  if (!r) return [];
  if (r.includes("nurse") || r.includes("hemsire") || r.includes("hemşire")) {
    return ["nurse", "hemsire", "hemşire", "ebe", "att", "saglik", "sağlık"];
  }
  if (r.includes("doctor") || r.includes("doktor") || r.includes("hekim")) {
    return ["doctor", "doktor", "hekim", "tabip"];
  }
  return [r];
}

async function buildStaff({ serviceId = '', role = '' } = {}) {
  const query = {};
  if (serviceId) query.serviceId = serviceId;
  const list = await Person.find(query).lean();
  if (!role) return { staff: list, debug: { rawCount: list.length, filteredCount: list.length, usedFallback: false, roleTokens: [] } };

  const tokens = roleTokens(role);
  const filtered = list.filter((p) => {
    const metaRole = normalizeRoleStr(p?.meta?.role || p?.meta?.unvan || p?.meta?.title || p?.role || p?.title || "");
    if (!metaRole) return true;
    return tokens.some((t) => metaRole.includes(t));
  });

  if (filtered.length === 0 && list.length) {
    return { staff: list, debug: { rawCount: list.length, filteredCount: 0, usedFallback: true, roleTokens: tokens } };
  }

  return { staff: filtered, debug: { rawCount: list.length, filteredCount: filtered.length, usedFallback: false, roleTokens: tokens } };
}

async function generateSchedule({ sectionId, serviceId = '', role = '', year, month, dryRun = false, userId, payload = {} }) {
  const query = { sectionId, year, month };
  if (serviceId) query.serviceId = serviceId;
  if (role) query.role = role;
  const scheduleDoc = await MonthlySchedule.findOne(query).lean();
  const days =
    Array.isArray(payload.days) && payload.days.length
      ? payload.days
      : scheduleDoc
      ? buildDaysFromScheduleData({ year, month, data: scheduleDoc.data || {} })
      : null;

  if (!days || !days.length) {
    throw new Error('Vardiya şablonu bulunamadı (MonthlySchedule.data.defs bekleniyor).');
  }

  const staffPack = Array.isArray(payload.staff) && payload.staff.length
    ? { staff: payload.staff, debug: { rawCount: payload.staff.length, filteredCount: payload.staff.length, usedFallback: false, roleTokens: [] } }
    : await buildStaff({ serviceId, role });
  const staff = staffPack.staff;

  const leavesByPerson = payload.leavesByPerson || {};
  const requestsByPerson = payload.requestsByPerson || {};
  const targetHours = Number(payload.targetHours || 0);

  const { rules, weights } = await fetchDutyRules({ sectionId, serviceId, role });

  const context = await generateMonthlyPlan({
    year,
    month,
    getActiveStaff: async () => staff,
    getMonthlyShifts: async () => days,
    getLeaves: async () => leavesByPerson,
    getRequests: async () => requestsByPerson,
    rules,
    weights,
    targetHours,
    debug: {
      logBlocks: payload?.debug?.logBlocks || process.env.SCHEDULER_DEBUG === '1',
    },
  });

  const shiftCount = days.reduce((sum, d) => sum + (d.shifts?.length || 0), 0);
  const requiredSlots = days.reduce(
    (sum, d) => sum + (d.shifts || []).reduce((s, sh) => s + (Number(sh.requiredCount || 0) || 0), 0),
    0
  );

  const data = {
    assignments: context.assignments || [],
    issues: context.issues || [],
    days: days.length,
    debug: {
      staff: staffPack.debug,
      shiftCount,
      requiredSlots,
    },
  };

  if (dryRun) {
    return { data, rules, weights, sourceScheduleId: scheduleDoc?._id || null };
  }

  const doc = await GeneratedSchedule.create({
    sectionId,
    serviceId,
    role,
    year,
    month,
    sourceScheduleId: scheduleDoc?._id || null,
    data,
    meta: { rules, weights },
    createdBy: userId || null,
    updatedBy: userId || null,
  });

  return { data, rules, weights, generatedId: String(doc._id) };
}

module.exports = {
  generateSchedule,
  fetchDutyRules,
  DEFAULT_RULES,
  DEFAULT_WEIGHTS,
};
