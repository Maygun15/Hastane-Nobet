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
  const staffRuntime = (staff || []).map((p) => {
    const metaRaw = p?.meta && typeof p.meta === "object" ? p.meta : {};
    const areas = p?.areas ?? metaRaw.areas;
    const shiftCodes = p?.shiftCodes ?? metaRaw.shiftCodes;
    const meta = { ...metaRaw };
    if (areas != null && meta.areas == null) meta.areas = areas;
    if (shiftCodes != null && meta.shiftCodes == null) meta.shiftCodes = shiftCodes;
    if (!meta.role && p?.role) meta.role = p.role;

    return {
      id: String(p.id || p._id || p.personId || ""),
      name: p.name || p.fullName || p.displayName || "",
      meta,
      areas,
      shiftCodes,
      totalHours: 0,
      weekdayCount: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
      pairHistory: {},
      assignedDays: [],
      consecutiveDays: 0,
      lastAssignedDate: null,
      lastShift: null,
    };
  });

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
