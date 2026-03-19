// services/scheduler/index.js
const { runScheduler } = require("./engine");
const { resolveSchedulerAreas } = require("./personAreaProjection");
const RuleEngine = require("../ruleEngine");

function resolvePersonField(person, meta, fieldName, metaFieldNames = []) {
  if (person?.[fieldName] != null) return person[fieldName];

  for (const metaFieldName of metaFieldNames) {
    if (meta?.[metaFieldName] != null) return meta[metaFieldName];
  }

  return null;
}

function buildContext({
  staff,
  days,
  leavesByPerson = {},
  requestsByPerson = {},
  targetHours = 0,
  targetShifts = 0,
  rules = {},
  weights = {},
  debug = {},
  auditOptions = {},
} = {}) {
  const staffRuntime = (staff || []).map((p) => {
    const metaRaw = p?.meta && typeof p.meta === "object" ? p.meta : {};
    const {
      schedulerAreas,
      excludedLabels: schedulerExcludedAreas,
      hadAreaSource,
    } = resolveSchedulerAreas(p, metaRaw);
    const active = resolvePersonField(p, metaRaw, "active", ["active"]);
    const isActive = resolvePersonField(p, metaRaw, "isActive", ["isActive"]);
    const status = resolvePersonField(p, metaRaw, "status", ["status"]);
    const serviceId = resolvePersonField(p, metaRaw, "serviceId", ["serviceId"]);
    const service = resolvePersonField(p, metaRaw, "service", ["service"]);
    const role = resolvePersonField(p, metaRaw, "role", ["role", "unvan"]);
    const roles = resolvePersonField(p, metaRaw, "roles", ["roles"]);
    const title = resolvePersonField(p, metaRaw, "title", ["title"]);
    const stats = resolvePersonField(p, metaRaw, "stats", ["stats"]);
    const skills = resolvePersonField(p, metaRaw, "skills", ["skills"]);
    const experience = resolvePersonField(p, metaRaw, "experience", ["experience"]);
    const experienceYears = resolvePersonField(p, metaRaw, "experienceYears", ["experienceYears"]);
    const seniority = resolvePersonField(p, metaRaw, "seniority", ["seniority"]);
    const areas = hadAreaSource ? schedulerAreas : (p?.areas ?? metaRaw.areas);
    const shiftCodes = p?.shiftCodes ?? metaRaw.shiftCodes;
    const meta = { ...metaRaw };
    if (hadAreaSource) meta.areas = areas;
    if (schedulerExcludedAreas.length > 0) meta.schedulerExcludedAreas = schedulerExcludedAreas;
    if (shiftCodes != null && meta.shiftCodes == null) meta.shiftCodes = shiftCodes;
    if (active != null && meta.active == null) meta.active = active;
    if (isActive != null && meta.isActive == null) meta.isActive = isActive;
    if (status != null && meta.status == null) meta.status = status;
    if (serviceId != null && meta.serviceId == null) meta.serviceId = serviceId;
    if (service != null && meta.service == null) meta.service = service;
    if (role != null && meta.role == null) meta.role = role;
    if (roles != null && meta.roles == null) meta.roles = roles;
    if (title != null && meta.title == null) meta.title = title;
    if (stats != null && meta.stats == null) meta.stats = stats;
    if (skills != null && meta.skills == null) meta.skills = skills;
    if (experience != null && meta.experience == null) meta.experience = experience;
    if (experienceYears != null && meta.experienceYears == null) meta.experienceYears = experienceYears;
    if (seniority != null && meta.seniority == null) meta.seniority = seniority;

    return {
      id: String(p.id || p._id || p.personId || ""),
      name: p.name || p.fullName || p.displayName || "",
      active,
      isActive,
      status,
      serviceId,
      service,
      role,
      roles,
      title,
      stats,
      skills,
      experience,
      experienceYears,
      seniority,
      meta,
      areas,
      shiftCodes,
      totalHours: 0,
      totalShifts: 0,
      weekdayCount: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
      pairHistory: {},
      assignedDays: [],
      weeklyCounts: {},
      taskCounts: {},
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
    targetShifts,
    rules,
    weights,
    randomize: true,
    debug,
    auditOptions: auditOptions && typeof auditOptions === "object" ? auditOptions : {},
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
  ruleEngineDoc,
  rules,
  weights,
  targetHours,
  targetShifts,
  debug,
  auditOptions,
} = {}) {
  if (!getActiveStaff || !getMonthlyShifts) {
    throw new Error("generateMonthlyPlan: getActiveStaff ve getMonthlyShifts zorunlu");
  }

  const staff = await getActiveStaff({ year, month });
  const days = await getMonthlyShifts({ year, month }); // [{date, weekday, shifts:[{id, hours, requiredCount}]}]
  const leavesByPerson = (await (getLeaves?.({ year, month }) || {})) || {};
  const requestsByPerson = (await (getRequests?.({ year, month }) || {})) || {};

  const ctxTarget = Number.isFinite(targetHours) ? targetHours : 0;
  const ctxTargetShifts = Number.isFinite(targetShifts) ? targetShifts : 0;
  const context = buildContext({
    staff,
    days,
    leavesByPerson,
    requestsByPerson,
    targetHours: ctxTarget,
    targetShifts: ctxTargetShifts,
    rules,
    weights,
    debug: debug || {},
    auditOptions,
  });
  if (ruleEngineDoc) {
    const engine = new RuleEngine(ruleEngineDoc);
    context.ruleEngine = engine;
  }
  return runScheduler(context);
}

function schedulerOrchestratorPlaceholder(_input = {}) {
  return {
    status: "placeholder",
    message: "Modular scheduler orchestrator is not wired yet.",
  };
}

module.exports = {
  buildContext,
  generateMonthlyPlan,
  schedulerOrchestratorPlaceholder,
};
