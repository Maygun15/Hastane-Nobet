"use strict";

const CONSTANTS = require("../utils/compositeConstants");

/**
 * Converts a normalized evaluation result into an audit-friendly observation.
 * This stays read-only and does not make policy decisions.
 */
function buildCompositeObservation({
  evaluation = null,
  serviceId = null,
  section = null,
  date = null,
  shiftCode = null,
} = {}) {
  const safeEvaluation = evaluation && typeof evaluation === "object" ? evaluation : {};

  return {
    observationCode: CONSTANTS.COMPOSITE_OBSERVATION_CODE,
    personId: safeEvaluation.personId || null,
    serviceId: normalizeValue(serviceId),
    section: normalizeValue(section),
    date: normalizeValue(date),
    shiftCode: normalizeValue(shiftCode),
    taskPlaceLabel: safeEvaluation.taskPlaceLabel || null,
    taskPlaceKind: safeEvaluation.taskPlaceKind || null,
    eligible: safeEvaluation.eligible,
    reasonCode: safeEvaluation.reasonCode || null,
    requiredWorkAreasAnyOf: Array.isArray(safeEvaluation.requiredWorkAreasAnyOf)
      ? [...safeEvaluation.requiredWorkAreasAnyOf]
      : [],
    matchedWorkAreas: Array.isArray(safeEvaluation.matchedWorkAreas)
      ? [...safeEvaluation.matchedWorkAreas]
      : [],
    meta: safeEvaluation.meta && typeof safeEvaluation.meta === "object"
      ? { ...safeEvaluation.meta }
      : {},
  };
}

function normalizeValue(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

module.exports = {
  buildCompositeObservation,
};
