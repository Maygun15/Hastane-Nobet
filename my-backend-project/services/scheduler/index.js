// services/scheduler/index.js
const { runScheduler } = require("./engine");
const RuleEngine = require("../ruleEngine");
const { buildRuntimeContext } = require("./contracts");

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
    staff,
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
