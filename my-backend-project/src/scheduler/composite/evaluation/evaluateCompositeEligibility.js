"use strict";

const {
  resolveTaskPlaceDefinition,
  isEligibleForCompositeTaskPlace,
  normalizeTaskPlaceKey,
} = require("../../../../services/scheduler/candidateBuilder/taskPlaceTaxonomy");
const REASON_CODES = require("../utils/compositeReasonCodes");

/**
 * Evaluates composite task-place eligibility only.
 * This file does not reject candidates and does not apply score penalties.
 */
function evaluateCompositeEligibility({
  person = null,
  compositeTask = null,
  taskPlaceLabel = null,
  taskPlaceDefinition = null,
  options = null,
} = {}) {
  const resolvedLabel = normalizeValue(
    taskPlaceLabel ??
      compositeTask?.targetLabel ??
      compositeTask?.label ??
      compositeTask?.section ??
      compositeTask?.area
  );
  const definition = taskPlaceDefinition || resolveTaskPlaceDefinition(resolvedLabel);
  const personId = normalizeValue(person?.id ?? person?._id ?? person?.personId);
  const requiredWorkAreasAnyOf = Array.isArray(definition?.eligibleWorkAreasAnyOf)
    ? definition.eligibleWorkAreasAnyOf.filter(Boolean)
    : [];
  const candidateWorkAreas = extractCandidateWorkAreas(person);
  const matchedWorkAreas = requiredWorkAreasAnyOf.filter((workArea) =>
    candidateWorkAreas.includes(normalizeTaskPlaceKey(workArea))
  );
  const isCompositeTask = definition?.kind === "COMPOSITE_WORK_AREA";
  const eligible = isCompositeTask && requiredWorkAreasAnyOf.length
    ? isEligibleForCompositeTaskPlace(person, definition)
    : false;

  if (!isCompositeTask) {
    return {
      personId,
      taskPlaceLabel: resolvedLabel,
      taskPlaceKind: definition?.kind || "UNKNOWN",
      eligible: null,
      requiredWorkAreasAnyOf,
      candidateWorkAreas,
      matchedWorkAreas,
      reasonCode: REASON_CODES.COMPOSITE_TASK_PLACE_NOT_COMPOSITE,
      meta: {
        skipped: true,
        source: "v3_composite_evaluation",
        options: normalizeOptions(options),
      },
    };
  }

  if (!requiredWorkAreasAnyOf.length) {
    return {
      personId,
      taskPlaceLabel: definition?.label || resolvedLabel,
      taskPlaceKind: definition?.kind || "COMPOSITE_WORK_AREA",
      eligible: false,
      requiredWorkAreasAnyOf,
      candidateWorkAreas,
      matchedWorkAreas,
      reasonCode: REASON_CODES.COMPOSITE_NO_REQUIRED_AREA_MATCH,
      meta: {
        source: "v3_composite_evaluation",
        options: normalizeOptions(options),
      },
    };
  }

  return {
    personId,
    taskPlaceLabel: definition?.label || resolvedLabel,
    taskPlaceKind: definition?.kind || "COMPOSITE_WORK_AREA",
    eligible,
    requiredWorkAreasAnyOf,
    candidateWorkAreas,
    matchedWorkAreas,
    reasonCode: eligible ? null : REASON_CODES.COMPOSITE_WORK_AREA_NOT_ELIGIBLE,
    meta: {
      source: "v3_composite_evaluation",
      options: normalizeOptions(options),
    },
  };
}

function extractCandidateWorkAreas(person) {
  const raw =
    person?.workAreas ??
    person?.workArea ??
    person?.areas ??
    person?.area ??
    person?.sections ??
    person?.section ??
    person?.meta?.workAreas ??
    person?.meta?.workArea ??
    person?.meta?.areas ??
    person?.meta?.area ??
    person?.meta?.sections ??
    person?.meta?.section;

  const values = normalizeTaskPlaceList(raw);
  return Array.from(new Set(values));
}

function normalizeTaskPlaceList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeTaskPlaceKey(item)).filter(Boolean);
  }

  if (typeof value === "string" && value.includes(",")) {
    return value
      .split(",")
      .map((item) => normalizeTaskPlaceKey(item))
      .filter(Boolean);
  }

  const one = normalizeTaskPlaceKey(value);
  return one ? [one] : [];
}

function normalizeOptions(options) {
  return options && typeof options === "object" ? { ...options } : {};
}

function normalizeValue(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

module.exports = {
  evaluateCompositeEligibility,
};
