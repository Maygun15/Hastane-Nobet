"use strict";

/**
 * Produces a simple impact report shape for future V3 comparisons.
 * This file does not decide policy and does not score.
 */
function buildCompositeImpactReport({
  evaluations = [],
  decisions = [],
} = {}) {
  const safeEvaluations = Array.isArray(evaluations) ? evaluations.filter(Boolean) : [];
  const safeDecisions = Array.isArray(decisions) ? decisions.filter(Boolean) : [];

  return {
    totals: {
      evaluatedCount: safeEvaluations.length,
      decisionCount: safeDecisions.length,
      rejectedCount: safeDecisions.filter((item) => item.rejected === true).length,
      penaltyCount: safeDecisions.filter((item) => item.penaltyApplied === true).length,
    },
    decisions: safeDecisions.map((item) => ({
      mode: item.mode || null,
      action: item.action || null,
      rejected: item.rejected === true,
      penaltyApplied: item.penaltyApplied === true,
      reasonCode: item.reasonCode || null,
    })),
  };
}

module.exports = {
  buildCompositeImpactReport,
};
