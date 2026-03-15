"use strict";

const CONSTANTS = require("../utils/compositeConstants");

/**
 * Applies score adjustment only when policy explicitly asks for a penalty.
 * This file does not evaluate eligibility.
 */
function applyCompositePenalty(baseScore = 0, policyDecision = null) {
  const safeBaseScore = Number.isFinite(Number(baseScore)) ? Number(baseScore) : 0;
  const safeDecision = policyDecision && typeof policyDecision === "object" ? policyDecision : {};
  const shouldApplyPenalty =
    safeDecision.action === CONSTANTS.COMPOSITE_POLICY_ACTIONS.PENALTY &&
    safeDecision.penaltyApplied === true;
  const scorePenalty = shouldApplyPenalty
    ? Number(safeDecision.scorePenalty ?? CONSTANTS.DEFAULT_COMPOSITE_SCORE_PENALTY)
    : 0;

  return {
    baseScore: safeBaseScore,
    adjustedScore: safeBaseScore + scorePenalty,
    delta: scorePenalty,
    penaltyApplied: shouldApplyPenalty,
    reasonCode: shouldApplyPenalty ? safeDecision.penaltyReason || safeDecision.reasonCode || null : null,
    meta: {
      source: "v3_composite_scoring",
    },
  };
}

module.exports = {
  applyCompositePenalty,
};
