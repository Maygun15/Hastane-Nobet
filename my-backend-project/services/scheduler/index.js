// services/scheduler/index.js
const { runScheduler } = require("./engine");
const { resolveSchedulerAreas } = require("./personAreaProjection");
const RuleEngine = require("../ruleEngine");
const { buildRuntimeContext } = require("./contracts");

function projectSchedulerStaff(staff = []) {
  return (Array.isArray(staff) ? staff : []).map((person) => {
    const metaRaw = person?.meta && typeof person.meta === "object" ? person.meta : {};
    const {
      schedulerAreas,
      excludedLabels: schedulerExcludedAreas,
      hadAreaSource,
    } = resolveSchedulerAreas(person, metaRaw);

    const areas = hadAreaSource ? schedulerAreas : (person?.areas ?? metaRaw.areas);
    const meta = { ...metaRaw };

    if (hadAreaSource) meta.areas = areas;
    if (schedulerExcludedAreas.length > 0) meta.schedulerExcludedAreas = schedulerExcludedAreas;

    return {
      ...person,
      areas,
      meta,
    };
  });
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
  return buildRuntimeContext({
    staff: projectSchedulerStaff(staff),
    days,
    leavesByPerson,
    requestsByPerson,
    targetHours,
    targetShifts,
    rules,
    weights,
    debug,
    auditOptions,
  });
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
  const days = await getMonthlyShifts({ year, month });
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
