// services/scheduler/index.js
const { runScheduler } = require("./engine");

function buildContext({
  staff,
  days,
  leavesByPerson = {},
  requestsByPerson = {},
  targetHours = 0,
  rules = {},
  weights = {},
  debug = {},
} = {}) {
  const staffRuntime = (staff || []).map((p) => ({
    id: String(p.id || p._id || p.personId || ""),
    name: p.name || p.fullName || p.displayName || "",
    totalHours: 0,
    weekdayCount: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
    pairHistory: {},
    assignedDays: [],
    consecutiveDays: 0,
    lastAssignedDate: null,
    lastShift: null,
  }));

  return {
    staff: staffRuntime,
    days: Array.isArray(days) ? days : [],
    leavesByPerson,
    requestsByPerson,
    targetHours,
    rules,
    weights,
    randomize: true,
    debug,
    assignments: [],
    issues: [],
  };
}

async function generateMonthlyPlan({
  year,
  month,
  getActiveStaff,
  getMonthlyShifts,
  getLeaves,
  getRequests,
  rules,
  weights,
  targetHours,
  debug,
} = {}) {
  if (!getActiveStaff || !getMonthlyShifts) {
    throw new Error("generateMonthlyPlan: getActiveStaff ve getMonthlyShifts zorunlu");
  }

  const staff = await getActiveStaff({ year, month });
  const days = await getMonthlyShifts({ year, month }); // [{date, weekday, shifts:[{id, hours, requiredCount}]}]
  const leavesByPerson = (await (getLeaves?.({ year, month }) || {})) || {};
  const requestsByPerson = (await (getRequests?.({ year, month }) || {})) || {};

  const ctxTarget = Number.isFinite(targetHours) ? targetHours : 0;
  const context = buildContext({
    staff,
    days,
    leavesByPerson,
    requestsByPerson,
    targetHours: ctxTarget,
    rules,
    weights,
    debug: debug || {},
  });
  return runScheduler(context);
}

module.exports = {
  buildContext,
  generateMonthlyPlan,
};
