// services/scheduler/engine.js
const { isAvailable } = require("./constraints");
const { calculateScore } = require("./scoring");

const getISOWeekKey = (dateStr) => {
  if (!dateStr) return null;
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const day = d.getUTCDay() || 7; // 1..7 (Mon..Sun)
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
};

const normalizeCode = (s) =>
  (s || "")
    .toString()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase()
    .trim();

const getShiftKey = (shift) =>
  normalizeCode(shift?.id || shift?.code || shift?.label || shift?.name || "");

const daysBetween = (a, b) => {
  if (!a || !b) return null;
  const da = new Date(`${a}T00:00:00Z`);
  const db = new Date(`${b}T00:00:00Z`);
  return Math.round((db - da) / (24 * 60 * 60 * 1000));
};

function assign(person, day, shift, context) {
  if (!person || !day || !shift) return;
  const hours = Number(shift.hours || context.defaultShiftHours || 0);

  person.totalHours = Number(person.totalHours || 0) + (Number.isFinite(hours) ? hours : 0);
  if (!Array.isArray(person.assignedDays)) person.assignedDays = [];
  if (!person.assignedDays.includes(day.date)) person.assignedDays.push(day.date);

  const diff = daysBetween(person.lastAssignedDate, day.date);
  person.consecutiveDays = diff === 1 ? Number(person.consecutiveDays || 0) + 1 : 1;
  person.lastAssignedDate = day.date;

  const wk = getISOWeekKey(day.date);
  if (wk) {
    if (!person.weeklyCounts) person.weeklyCounts = {};
    person.weeklyCounts[wk] = Number(person.weeklyCounts[wk] || 0) + 1;
  }

  const wd = Number(day.weekday ?? -1);
  if (!person.weekdayCount) person.weekdayCount = {};
  if (wd >= 0 && wd <= 6) {
    person.weekdayCount[wd] = Number(person.weekdayCount[wd] || 0) + 1;
  }

  if (!person.pairHistory) person.pairHistory = {};
  if (!shift.assignedPersons) shift.assignedPersons = [];

  // Pair history: selected with already assigned in this shift
  for (const other of shift.assignedPersons) {
    if (!other?.id) continue;
    const key1 = `${person.id}-${other.id}`;
    const key2 = `${other.id}-${person.id}`;
    person.pairHistory[key1] = Number(person.pairHistory[key1] || 0) + 1;
    if (!other.pairHistory) other.pairHistory = {};
    other.pairHistory[key2] = Number(other.pairHistory[key2] || 0) + 1;
  }

  shift.assignedPersons.push({ id: person.id, name: person.name || "" });

  const taskKey = getShiftKey(shift);
  if (taskKey) {
    if (!person.taskCounts) person.taskCounts = {};
    person.taskCounts[taskKey] = Number(person.taskCounts[taskKey] || 0) + 1;
  }

  // last shift snapshot
  person.lastShift = {
    date: day.date,
    code: shift.code || shift.id || "",
    start: shift.start || null,
    end: shift.end || null,
    isNight: !!shift.isNight,
  };

  if (!context.assignments) context.assignments = [];
  context.assignments.push({
    date: day.date,
    weekday: day.weekday,
    shiftId: shift.id || shift.code || "",
    personId: person.id,
    personName: person.name || "",
    hours,
  });
}

function runScheduler(context) {
  if (!context || !Array.isArray(context.days) || !Array.isArray(context.staff)) return context;

  for (const day of context.days) {
    if (!day || !Array.isArray(day.shifts)) continue;
    for (const shift of day.shifts) {
      const need = Math.max(1, Number(shift.requiredCount || 1));
      if (!shift.assignedPersons) shift.assignedPersons = [];

      for (let i = 0; i < need; i++) {
        const candidates = context.staff.filter((p) => isAvailable(p, day, context, shift));
        if (!candidates.length) break;
        candidates.sort((a, b) =>
          calculateScore(a, day, shift, context) - calculateScore(b, day, shift, context)
        );
        const selected = candidates[0];
        assign(selected, day, shift, context);
      }

      if (shift.assignedPersons.length < need) {
        if (!context.issues) context.issues = [];
        context.issues.push({
          date: day.date,
          shiftId: shift.id || shift.code || "",
          missing: need - shift.assignedPersons.length,
          reason: "NO_CANDIDATE",
        });
      }
    }
  }

  return context;
}

module.exports = { runScheduler, assign };
