"use strict";

const { normalizeStaff } = require("./staff");
const { normalizeRules, normalizeWeights } = require("./rules");
const { normalizeDays } = require("./days");

function normalizeRecordMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
}

function normalizeAuditOptions(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
}

function normalizeDebug(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
}

function buildRuntimeContext({
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
  return {
    staff: normalizeStaff(staff),
    days: normalizeDays(days),
    leavesByPerson: normalizeRecordMap(leavesByPerson),
    requestsByPerson: normalizeRecordMap(requestsByPerson),
    targetHours: Number.isFinite(Number(targetHours)) ? Number(targetHours) : 0,
    targetShifts: Number.isFinite(Number(targetShifts)) ? Number(targetShifts) : 0,
    rules: normalizeRules(rules),
    weights: normalizeWeights(weights),
    randomize: true,
    debug: normalizeDebug(debug),
    auditOptions: normalizeAuditOptions(auditOptions),
    assignments: [],
    issues: [],
  };
}

module.exports = {
  buildRuntimeContext,
};
