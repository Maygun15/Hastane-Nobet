"use strict";

/**
 * Builds lightweight audit counters for composite processing.
 * This file is reporting-only.
 */
function buildCompositeAuditSummary({
  evaluations = [],
  decisions = [],
  observations = [],
} = {}) {
  const safeEvaluations = Array.isArray(evaluations) ? evaluations.filter(Boolean) : [];
  const safeDecisions = Array.isArray(decisions) ? decisions.filter(Boolean) : [];
  const safeObservations = Array.isArray(observations) ? observations.filter(Boolean) : [];

  return {
    evaluatedCount: safeEvaluations.length,
    eligibleCount: safeEvaluations.filter((item) => item.eligible === true).length,
    ineligibleCount: safeEvaluations.filter((item) => item.eligible === false).length,
    rejectedCount: safeDecisions.filter((item) => item.rejected === true).length,
    penaltyCount: safeDecisions.filter((item) => item.penaltyApplied === true).length,
    observationCount: safeObservations.length,
  };
}

module.exports = {
  buildCompositeAuditSummary,
};
