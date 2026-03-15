"use strict";

const {
  COMPOSITE_MODES,
  resolveCompositeMode,
} = require("./compositeModes");
const CONSTANTS = require("../utils/compositeConstants");

/**
 * Translates evaluation output into a policy decision.
 * This file does not evaluate eligibility and does not score directly.
 */
function decideCompositePolicy({
  evaluation = null,
  config = null,
  options = null,
} = {}) {
  const safeEvaluation = evaluation && typeof evaluation === "object" ? evaluation : {};
  const mode = resolveCompositeMode(
    options?.compositeMode ??
      options?.compositeActivationStrategy ??
      config?.mode ??
      config?.defaultMode
  );
  const eligible = safeEvaluation.eligible;

  if (eligible !== false) {
    return {
      mode,
      action: CONSTANTS.COMPOSITE_POLICY_ACTIONS.NONE,
      rejected: false,
      penaltyApplied: false,
      reasonCode: safeEvaluation.reasonCode || null,
      meta: {
        source: "v3_composite_policy",
      },
    };
  }

  if (mode === COMPOSITE_MODES.HARD_REJECT) {
    return {
      mode,
      action: CONSTANTS.COMPOSITE_POLICY_ACTIONS.REJECT,
      rejected: true,
      penaltyApplied: false,
      reasonCode: safeEvaluation.reasonCode || null,
      meta: {
        source: "v3_composite_policy",
      },
    };
  }

  if (mode === COMPOSITE_MODES.SOFT_PENALTY) {
    return {
      mode,
      action: CONSTANTS.COMPOSITE_POLICY_ACTIONS.PENALTY,
      rejected: false,
      penaltyApplied: true,
      penaltyReason: safeEvaluation.reasonCode || null,
      scorePenalty: Number(config?.scorePenalty ?? CONSTANTS.DEFAULT_COMPOSITE_SCORE_PENALTY),
      reasonCode: safeEvaluation.reasonCode || null,
      meta: {
        source: "v3_composite_policy",
      },
    };
  }

  return {
    mode,
    action: CONSTANTS.COMPOSITE_POLICY_ACTIONS.NONE,
    rejected: false,
    penaltyApplied: false,
    reasonCode: safeEvaluation.reasonCode || null,
    meta: {
      source: "v3_composite_policy",
    },
  };
}

module.exports = {
  decideCompositePolicy,
};
