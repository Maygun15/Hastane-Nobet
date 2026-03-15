"use strict";

const REASON_CODES = require("./reasonCodes");
const {
  resolveTaskPlaceDefinition,
  isEligibleForCompositeTaskPlace,
  TASK_PLACE_KINDS,
} = require("./taskPlaceTaxonomy");

const COMPOSITE_WORK_AREA_ELIGIBILITY_SHADOW_CODE = "COMPOSITE_WORK_AREA_ELIGIBILITY_SHADOW";
const COMPOSITE_ACTIVATION_STRATEGIES = Object.freeze({
  SHADOW_ONLY: "shadow_only",
  SOFT_PENALTY: "soft_penalty",
  HARD_REJECT: "hard_reject",
});

/**
 * Shadow-only composite work area evaluation.
 * This never changes scheduler selection; it only produces an observation.
 */
function evaluateCompositeTaskPlaceShadow({
  person = null,
  day = null,
  shift = null,
  section = null,
  serviceId = null,
} = {}) {
  const context = buildCompositeEvaluationContext({ person, day, shift, section, serviceId });
  if (!context) {
    return null;
  }

  if (!context.eligibleWorkAreasAnyOf.length) {
    return buildObservation({
      personId: context.personId,
      definition: context.definition,
      day,
      shift,
      serviceId,
      triggered: false,
      wouldReject: false,
      message: "Composite work area definition has no eligible work areas. Shadow check skipped.",
      reason: REASON_CODES.COMPOSITE_WORK_AREA_CONFIG_MISSING,
    });
  }

  if (context.eligible) {
    return buildObservation({
      personId: context.personId,
      definition: context.definition,
      day,
      shift,
      serviceId,
      triggered: false,
      wouldReject: false,
      message: "Person is shadow-eligible for composite work area.",
      reason: null,
    });
  }

  return buildObservation({
    personId: context.personId,
    definition: context.definition,
    day,
    shift,
    serviceId,
    triggered: true,
    wouldReject: true,
    message: "Person is not eligible for composite work area.",
    reason: REASON_CODES.COMPOSITE_WORK_AREA_NOT_ELIGIBLE,
  });
}

function evaluateCompositeTaskPlacePolicy({
  person = null,
  day = null,
  shift = null,
  section = null,
  serviceId = null,
  options = null,
} = {}) {
  const strategy = resolveCompositeActivationStrategy(options);
  const observation = evaluateCompositeTaskPlaceShadow({ person, day, shift, section, serviceId });

  if (!observation) {
    return null;
  }

  const wouldReject = observation.wouldReject === true;
  const base = {
    strategy,
    personId: observation.personId || null,
    targetLabel: observation.targetLabel || null,
    taskPlaceKind: observation.taskPlaceKind || TASK_PLACE_KINDS.UNKNOWN,
    eligibleWorkAreasAnyOf: Array.isArray(observation.eligibleWorkAreasAnyOf)
      ? [...observation.eligibleWorkAreasAnyOf]
      : [],
    eligible: !wouldReject,
    rejected: false,
    penaltyApplied: false,
    penaltyReason: null,
    reason: observation.reason || null,
    message: observation.message || null,
    observation,
  };

  if (!wouldReject) {
    return base;
  }

  if (strategy === COMPOSITE_ACTIVATION_STRATEGIES.HARD_REJECT) {
    return {
      ...base,
      rejected: true,
    };
  }

  if (strategy === COMPOSITE_ACTIVATION_STRATEGIES.SOFT_PENALTY) {
    return {
      ...base,
      penaltyApplied: true,
      penaltyReason: observation.reason || REASON_CODES.COMPOSITE_WORK_AREA_NOT_ELIGIBLE,
    };
  }

  return base;
}

function resolveCompositeActivationStrategy(options = null) {
  const raw = normalizeValue(options?.compositeActivationStrategy);
  if (raw === COMPOSITE_ACTIVATION_STRATEGIES.SOFT_PENALTY) {
    return COMPOSITE_ACTIVATION_STRATEGIES.SOFT_PENALTY;
  }
  if (raw === COMPOSITE_ACTIVATION_STRATEGIES.HARD_REJECT) {
    return COMPOSITE_ACTIVATION_STRATEGIES.HARD_REJECT;
  }
  return COMPOSITE_ACTIVATION_STRATEGIES.SHADOW_ONLY;
}

function buildCompositeEvaluationContext({
  person = null,
  day = null,
  shift = null,
  section = null,
  serviceId = null,
} = {}) {
  const personId = normalizeValue(person?.id ?? person?._id ?? person?.personId);
  const targetLabel = resolveCompositeTargetLabel({ section, shift, day });

  if (!targetLabel) {
    return null;
  }

  const definition = resolveTaskPlaceDefinition(targetLabel);
  if (definition.kind !== TASK_PLACE_KINDS.COMPOSITE_WORK_AREA) {
    return null;
  }

  const eligibleWorkAreasAnyOf = Array.isArray(definition.eligibleWorkAreasAnyOf)
    ? definition.eligibleWorkAreasAnyOf.filter(Boolean)
    : [];

  return {
    personId,
    targetLabel,
    definition,
    serviceId: normalizeValue(serviceId ?? shift?.serviceId),
    eligibleWorkAreasAnyOf,
    eligible: eligibleWorkAreasAnyOf.length
      ? isEligibleForCompositeTaskPlace(person, definition)
      : false,
  };
}

function buildObservation({
  personId = null,
  definition = null,
  day = null,
  shift = null,
  serviceId = null,
  triggered = false,
  wouldReject = false,
  message = "",
  reason = null,
} = {}) {
  return {
    ruleCode: COMPOSITE_WORK_AREA_ELIGIBILITY_SHADOW_CODE,
    personId,
    taskPlaceKind: definition?.kind || TASK_PLACE_KINDS.UNKNOWN,
    targetLabel: definition?.label || null,
    triggered: Boolean(triggered),
    wouldReject: Boolean(wouldReject),
    message: message || "Composite work area shadow evaluation completed.",
    reason,
    severity: "hard",
    phase: "eligibility",
    enabled: false,
    rolloutStage: "shadow",
    shadowMode: true,
    eligibleWorkAreasAnyOf: Array.isArray(definition?.eligibleWorkAreasAnyOf)
      ? [...definition.eligibleWorkAreasAnyOf]
      : [],
    targetSummary: {
      date: normalizeValue(day?.date),
      shiftCode: normalizeValue(shift?.code ?? shift?.id),
      serviceId: normalizeValue(serviceId ?? shift?.serviceId),
      section: definition?.label || null,
      targetLabel: definition?.label || null,
      eligibleWorkAreasAnyOf: Array.isArray(definition?.eligibleWorkAreasAnyOf)
        ? [...definition.eligibleWorkAreasAnyOf]
        : [],
    },
  };
}

function resolveCompositeTargetLabel({ section = null, shift = null, day = null } = {}) {
  return normalizeDisplayValue(
    section ??
      shift?.targetLabel ??
      shift?.targetSection ??
      shift?.section ??
      shift?.area ??
      day?.targetLabel ??
      day?.section
  );
}

function normalizeDisplayValue(value) {
  if (value == null) return null;
  const normalized = String(value).replace(/\s+/g, " ").trim();
  return normalized || null;
}

function normalizeValue(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

module.exports = {
  COMPOSITE_ACTIVATION_STRATEGIES,
  COMPOSITE_WORK_AREA_ELIGIBILITY_SHADOW_CODE,
  evaluateCompositeTaskPlacePolicy,
  evaluateCompositeTaskPlaceShadow,
  resolveCompositeActivationStrategy,
};
