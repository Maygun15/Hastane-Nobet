"use strict";

const {
  evaluateCandidateShadow,
  listShadowRuleCodes,
  evaluateCompositeTaskPlaceShadow,
} = require("../candidateBuilder");

/**
 * Creates an in-memory shadow audit container for a scheduler run.
 */
function createShadowAuditCollector({ ruleCodes = null } = {}) {
  return {
    enabled: true,
    ruleCodes: normalizeRuleCodes(ruleCodes),
    observations: [],
    errors: [],
    summary: null,
  };
}

/**
 * Evaluates shadow-only rules for a slot candidate pool and returns normalized observations.
 */
function collectShadowObservations({
  staff = [],
  day = null,
  shift = null,
  section = null,
  serviceId = null,
  schedulerContext = null,
  assignmentState = null,
  ruleCodes = null,
  options = null,
  timestamp = null,
} = {}) {
  const safeStaff = Array.isArray(staff) ? staff.filter(Boolean) : [];
  const activeRuleCodes = normalizeRuleCodes(ruleCodes);
  const observationTimestamp = normalizeTimestamp(timestamp);

  if (!safeStaff.length || !activeRuleCodes.length) {
    return [];
  }

  const observations = [];

  for (const person of safeStaff) {
    for (const ruleCode of activeRuleCodes) {
      const shadowResult = evaluateCandidateShadow({
        person,
        day,
        shift,
        section,
        serviceId,
        schedulerContext,
        assignmentState,
        ruleCodes: [ruleCode],
        options,
      });

      for (const observation of shadowResult.observations || []) {
        observations.push(
          normalizeObservation({
            observation,
            day,
            shift,
            section,
            serviceId,
            timestamp: observationTimestamp,
          })
        );
      }

      if (ruleCode === activeRuleCodes[activeRuleCodes.length - 1] && options?.enableCompositeTaskPlaceShadow !== false) {
        const compositeObservation = evaluateCompositeTaskPlaceShadow({
          person,
          day,
          shift,
          section,
          serviceId,
        });

        if (compositeObservation) {
          observations.push(
            normalizeObservation({
              observation: compositeObservation,
              day,
              shift,
              section,
              serviceId,
              timestamp: observationTimestamp,
            })
          );
        }
      }
    }
  }

  return observations;
}

function appendShadowObservations(collector, observations = []) {
  if (!collector || !Array.isArray(collector.observations)) return collector;
  if (!Array.isArray(observations) || !observations.length) return collector;

  collector.observations.push(...observations);
  return collector;
}

function recordShadowCollectionError(collector, error, meta = null) {
  if (!collector || !Array.isArray(collector.errors)) return collector;

  collector.errors.push({
    timestamp: normalizeTimestamp(),
    message: error?.message || String(error || "Unknown shadow audit error"),
    meta: meta && typeof meta === "object" ? meta : {},
  });

  return collector;
}

function normalizeObservation({
  observation = null,
  day = null,
  shift = null,
  section = null,
  serviceId = null,
  timestamp = null,
} = {}) {
  const targetSummary = observation?.targetSummary && typeof observation.targetSummary === "object"
    ? observation.targetSummary
    : {};

  return {
    timestamp: normalizeTimestamp(timestamp),
    ruleCode: observation?.ruleCode || null,
    personId: normalizeValue(observation?.personId),
    serviceId: normalizeValue(targetSummary.serviceId ?? serviceId ?? shift?.serviceId),
    section: normalizeValue(targetSummary.section ?? targetSummary.targetSection ?? section ?? shift?.section ?? shift?.area),
    date: normalizeValue(targetSummary.date ?? day?.date),
    shiftCode: normalizeValue(targetSummary.shiftCode ?? shift?.code ?? shift?.id),
    triggered: Boolean(observation?.triggered),
    wouldReject: Boolean(observation?.wouldReject),
    reasonCode: normalizeValue(observation?.reason),
    message: observation?.message || null,
    rolloutStage: normalizeValue(observation?.rolloutStage),
    severity: normalizeValue(observation?.severity),
    taskPlaceKind: normalizeValue(observation?.taskPlaceKind),
    targetLabel: normalizeValue(observation?.targetLabel ?? targetSummary.targetLabel),
    requiredRoles: normalizeList(targetSummary.requiredRoles),
    targetSection: normalizeValue(targetSummary.targetSection),
    eligibleWorkAreasAnyOf: normalizeList(
      observation?.eligibleWorkAreasAnyOf ?? targetSummary.eligibleWorkAreasAnyOf
    ),
  };
}

function normalizeRuleCodes(ruleCodes) {
  const input = Array.isArray(ruleCodes) && ruleCodes.length ? ruleCodes : listShadowRuleCodes();
  const out = [];
  const seen = new Set();

  for (const item of input) {
    const code = normalizeValue(item);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    out.push(code);
  }

  return out;
}

function normalizeList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeValue(item)).filter(Boolean);
  }

  const one = normalizeValue(value);
  return one ? [one] : [];
}

function normalizeTimestamp(value = null) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }

  return new Date().toISOString();
}

function normalizeValue(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

module.exports = {
  createShadowAuditCollector,
  collectShadowObservations,
  appendShadowObservations,
  recordShadowCollectionError,
};
